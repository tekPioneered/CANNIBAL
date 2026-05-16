#!/usr/bin/env node
// cannibal-volume — auto buy+burn driven by DexScreener 24h volume.
//
// Rule: every $5,000 of new 24h volume accrued since last buy → buy+burn.
// Polls every 10 minutes. State persists to .cannibal-volume-state.json
// next to this script so restarts don't double-fire or miss buckets.
//
// Prereq (from scripts/):
//   npm i @solana/web3.js @solana/spl-token bs58
//
// Reads from .env (same as cannibal-fast.mjs / cannibal-burn.mjs):
//   PRIVATE_KEY=<base58 secret>
//   RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
//
// Run:
//   node cannibal-volume.mjs
//
// Tunables via env:
//   BUCKET_USD      (default 5000) — $ of new 24h volume per trigger
//   BUY_USD         (default 25)    — $ size of each buy
//   POLL_MS         (default 600000) — 10 minutes
//   SLIPPAGE_BPS    (default 300)
//   PRIO_ULAMPORTS  (default 200000)

import "dotenv/config";
import {
  Connection, Keypair, VersionedTransaction, TransactionMessage,
  PublicKey, ComputeBudgetProgram, AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  createBurnInstruction, createBurnCheckedInstruction,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, ".cannibal-volume-state.json");
dns.setDefaultResultOrder?.("ipv4first");

const CANNIBAL_MINT = "J45BdF9VoGqheQD8MBCJede6bnVVtGURz1KaNLNepump";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// Never buy these — own token, SOL/wrapped, stables, common LSTs.
const BLACKLIST = new Set([
  CANNIBAL_MINT,
  SOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // jitoSOL
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",  // bSOL
]);

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const SECRET = process.env.PRIVATE_KEY;
if (!SECRET) { console.error("Missing PRIVATE_KEY in .env"); process.exit(1); }

const BUCKET_USD = Number(process.env.BUCKET_USD ?? 5_000);
const BUY_USD = Number(process.env.BUY_USD ?? 25);
const POLL_MS = Number(process.env.POLL_MS ?? 10 * 60 * 1000);
const MAX_BUCKETS_PER_TICK = Number(process.env.MAX_BUCKETS_PER_TICK ?? 1);
const SLIP = Number(process.env.SLIPPAGE_BPS ?? 300);
const PRIO = Number(process.env.PRIO_ULAMPORTS ?? 200_000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 20_000);
const JUPITER_API = (process.env.JUPITER_API || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");

const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
const conn = new Connection(RPC, { commitment: "processed" });
console.log("wallet:", kp.publicKey.toBase58());
console.log(`rule: $${BUY_USD} buy+burn per $${BUCKET_USD.toLocaleString()} of 24h volume, poll every ${POLL_MS/1000}s`);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
  catch { return { lastVolume24h: null, lastTriggerVolume: null, totalBuys: 0 }; }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

async function fetchJsonRetry(url, opts = {}, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      if (!r.ok) throw new Error(`http ${r.status}: ${await r.text().catch(() => "")}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i === tries - 1) break;
      const wait = 1000 * Math.pow(2, i); // 1s, 2s, 4s, 8s, 16s
      console.log(`  · fetch retry ${i + 1}/${tries} after ${wait}ms (${e?.message ?? e})`);
      await new Promise(res => setTimeout(res, wait));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr;
}

async function getPair() {
  const j = await fetchJsonRetry(`https://api.dexscreener.com/latest/dex/tokens/${CANNIBAL_MINT}`);
  const pairs = (j.pairs ?? []).filter(p => p.chainId === "solana");
  if (!pairs.length) throw new Error("no solana pairs from dexscreener");
  // pick highest liquidity
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return pairs[0];
}

async function getSolUsd() {
  const j = await fetchJsonRetry(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`);
  const pairs = (j.pairs ?? []).filter(p => p.chainId === "solana" && p.quoteToken?.symbol === "USDC");
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const price = Number(pairs[0]?.priceUsd);
  if (!price || !isFinite(price)) throw new Error("could not price SOL");
  return price;
}

async function pickTrendingMint() {
  // DexScreener token-boosts ≈ trending. Filter to Solana, exclude blacklist,
  // require decent liquidity + recent volume on at least one pair.
  const boosts = await fetchJsonRetry("https://api.dexscreener.com/token-boosts/top/v1");
  const solBoosts = (Array.isArray(boosts) ? boosts : [])
    .filter(b => b.chainId === "solana" && !BLACKLIST.has(b.tokenAddress));
  if (!solBoosts.length) throw new Error("no trending solana tokens from dexscreener");

  // Shuffle so we don't keep hitting the same #1 every tick.
  for (let i = solBoosts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [solBoosts[i], solBoosts[j]] = [solBoosts[j], solBoosts[i]];
  }

  for (const b of solBoosts.slice(0, 15)) {
    try {
      const j = await fetchJsonRetry(`https://api.dexscreener.com/latest/dex/tokens/${b.tokenAddress}`);
      const pairs = (j.pairs ?? []).filter(p => p.chainId === "solana");
      if (!pairs.length) continue;
      pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const top = pairs[0];
      const liq = Number(top.liquidity?.usd ?? 0);
      const vol24 = Number(top.volume?.h24 ?? 0);
      if (liq < 20_000 || vol24 < 10_000) continue;
      return { mint: b.tokenAddress, symbol: top.baseToken?.symbol ?? "?", liq, vol24 };
    } catch {
      continue;
    }
  }
  throw new Error("no trending token passed liquidity filter");
}

async function buyAndBurn(solAmount, mintStr) {
  const lamports = Math.floor(solAmount * 1e9);
  const targetMint = new PublicKey(mintStr);

  const mintAcc = await conn.getAccountInfo(targetMint);
  if (!mintAcc) throw new Error("mint not found");
  const tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const quoteUrl = new URL(`${JUPITER_API}/quote`);
  quoteUrl.searchParams.set("inputMint", SOL_MINT);
  quoteUrl.searchParams.set("outputMint", targetMint.toBase58());
  quoteUrl.searchParams.set("amount", String(lamports));
  quoteUrl.searchParams.set("slippageBps", String(SLIP));
  const quote = await fetchJsonRetry(quoteUrl.toString());
  if (!quote || quote.error) throw new Error("quote: " + JSON.stringify(quote));

  const minOut = BigInt(quote.otherAmountThreshold);

  const swapIxRes = await fetchJsonRetry(`${JUPITER_API}/swap-instructions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: PRIO,
    }),
  });
  if (swapIxRes.error) throw new Error("swap-ix: " + JSON.stringify(swapIxRes));

  const deser = (ix) => ({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map(a => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, "base64"),
  });
  const setupIxs = (swapIxRes.setupInstructions ?? []).map(deser);
  const swapIx = deser(swapIxRes.swapInstruction);
  const cleanupIx = swapIxRes.cleanupInstruction ? deser(swapIxRes.cleanupInstruction) : null;
  const computeIxs = (swapIxRes.computeBudgetInstructions ?? []).map(deser);

  const ata = getAssociatedTokenAddressSync(targetMint, kp.publicKey, false, tokenProgramId);
  const decimals = quote.outputDecimals ?? 0;
  const burnIx = decimals > 0
    ? createBurnCheckedInstruction(ata, targetMint, kp.publicKey, minOut, decimals, [], tokenProgramId)
    : createBurnInstruction(ata, targetMint, kp.publicKey, minOut, [], tokenProgramId);

  const lutAccounts = [];
  for (const addr of swapIxRes.addressLookupTableAddresses ?? []) {
    const info = await conn.getAccountInfo(new PublicKey(addr));
    if (info) lutAccounts.push(new AddressLookupTableAccount({
      key: new PublicKey(addr),
      state: AddressLookupTableAccount.deserialize(info.data),
    }));
  }

  // Jupiter's computeBudgetInstructions already include SetComputeUnitPrice — don't duplicate.
  const ixs = [...computeIxs, ...setupIxs, swapIx, burnIx, ...(cleanupIx ? [cleanupIx] : [])];

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("processed");
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(lutAccounts);

  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);

  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0 });
  console.log("  sent:", sig, `https://solscan.io/tx/${sig}`);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log("  confirmed. eaten.");
  return sig;
}

async function tick() {
  const ts = new Date().toISOString();
  try {
    const pair = await getPair();
    const vol24 = Number(pair.volume?.h24 ?? 0);
    const state = loadState();

    if (state.lastTriggerVolume == null) {
      // first run — set baseline, do nothing
      state.lastVolume24h = vol24;
      state.lastTriggerVolume = vol24;
      saveState(state);
      console.log(`[${ts}] baseline set. 24h vol=$${vol24.toLocaleString()}`);
      return;
    }

    // delta vs the last trigger. Note: 24h vol is a rolling window so it can
    // shrink too. If it shrinks, advance the baseline to the new lower number
    // so we measure new growth from there (avoids a huge artificial bucket
    // when old volume rolls off then new volume arrives).
    let delta = vol24 - state.lastTriggerVolume;
    if (delta < 0) {
      state.lastTriggerVolume = vol24;
      state.lastVolume24h = vol24;
      saveState(state);
      console.log(`[${ts}] 24h vol decreased to $${vol24.toLocaleString()} — baseline reset, no buy`);
      return;
    }

    const buckets = Math.floor(delta / BUCKET_USD);
    const toNextBucket = BUCKET_USD - (delta % BUCKET_USD);
    const pct = ((delta % BUCKET_USD) / BUCKET_USD * 100).toFixed(1);
    console.log(`[${ts}] 24h vol=$${vol24.toLocaleString()} | +$${delta.toLocaleString()} since last trigger | next buy in $${toNextBucket.toLocaleString()} more vol (${pct}% of bucket) | buckets ready=${buckets}`);

    if (buckets < 1) {
      state.lastVolume24h = vol24;
      saveState(state);
      lastVol = vol24;
      return;
    }

    const bucketsToFire = Math.min(buckets, MAX_BUCKETS_PER_TICK);
    const solUsd = await getSolUsd();
    const buyUsd = BUY_USD * bucketsToFire;
    const solAmount = +(buyUsd / solUsd).toFixed(6);

    const target = await pickTrendingMint();
    console.log(`[${ts}] firing ${bucketsToFire}/${buckets} bucket(s) → $${buyUsd} ≈ ${solAmount} SOL @ $${solUsd.toFixed(2)}/SOL → eating $${target.symbol} (${target.mint})`);

    await buyAndBurn(solAmount, target.mint);

    state.lastTriggerVolume = state.lastTriggerVolume + bucketsToFire * BUCKET_USD;
    state.lastVolume24h = vol24;
    state.totalBuys = (state.totalBuys ?? 0) + 1;
    saveState(state);
  } catch (e) {
    console.error(`[${ts}] tick error:`, e?.message ?? e);
  }
}

let lastVol = null;
let nextPollAt = Date.now() + POLL_MS;

await tick();
nextPollAt = Date.now() + POLL_MS;

setInterval(async () => {
  await tick();
  nextPollAt = Date.now() + POLL_MS;
}, POLL_MS);

// heartbeat every 30s so you can see it's alive + countdown to next poll
setInterval(() => {
  const secs = Math.max(0, Math.round((nextPollAt - Date.now()) / 1000));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  console.log(`  · alive · next scan in ${mins}m ${rem}s`);
}, 30_000);
