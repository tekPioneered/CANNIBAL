#!/usr/bin/env node
// cannibal-volume — auto buy+burn driven by DexScreener 24h volume.
//
// Rule: every $10,000 of new 24h volume accrued since last buy → $25 buy+burn.
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
//   BUCKET_USD      (default 10000) — $ of new 24h volume per trigger
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, ".cannibal-volume-state.json");

const CANNIBAL_MINT = "J45BdF9VoGqheQD8MBCJede6bnVVtGURz1KaNLNepump";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const SECRET = process.env.PRIVATE_KEY;
if (!SECRET) { console.error("Missing PRIVATE_KEY in .env"); process.exit(1); }

const BUCKET_USD = Number(process.env.BUCKET_USD ?? 10_000);
const BUY_USD = Number(process.env.BUY_USD ?? 25);
const POLL_MS = Number(process.env.POLL_MS ?? 10 * 60 * 1000);
const SLIP = Number(process.env.SLIPPAGE_BPS ?? 300);
const PRIO = Number(process.env.PRIO_ULAMPORTS ?? 200_000);

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

async function getPair() {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CANNIBAL_MINT}`);
  const j = await r.json();
  const pairs = (j.pairs ?? []).filter(p => p.chainId === "solana");
  if (!pairs.length) throw new Error("no solana pairs from dexscreener");
  // pick highest liquidity
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return pairs[0];
}

async function getSolUsd() {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`);
  const j = await r.json();
  const pairs = (j.pairs ?? []).filter(p => p.chainId === "solana" && p.quoteToken?.symbol === "USDC");
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const price = Number(pairs[0]?.priceUsd);
  if (!price || !isFinite(price)) throw new Error("could not price SOL");
  return price;
}

async function buyAndBurn(solAmount) {
  const lamports = Math.floor(solAmount * 1e9);
  const targetMint = new PublicKey(CANNIBAL_MINT);

  const mintAcc = await conn.getAccountInfo(targetMint);
  if (!mintAcc) throw new Error("mint not found");
  const tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
  quoteUrl.searchParams.set("inputMint", SOL_MINT);
  quoteUrl.searchParams.set("outputMint", targetMint.toBase58());
  quoteUrl.searchParams.set("amount", String(lamports));
  quoteUrl.searchParams.set("slippageBps", String(SLIP));
  const quote = await (await fetch(quoteUrl)).json();
  if (!quote || quote.error) throw new Error("quote: " + JSON.stringify(quote));

  const minOut = BigInt(quote.otherAmountThreshold);

  const swapIxRes = await fetch("https://quote-api.jup.ag/v6/swap-instructions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: PRIO,
    }),
  }).then(r => r.json());
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

  const extraPrio = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIO });
  const ixs = [extraPrio, ...computeIxs, ...setupIxs, swapIx, burnIx, ...(cleanupIx ? [cleanupIx] : [])];

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
    console.log(`[${ts}] 24h vol=$${vol24.toLocaleString()} | +$${delta.toLocaleString()} since last trigger | buckets=${buckets}`);

    if (buckets < 1) {
      state.lastVolume24h = vol24;
      saveState(state);
      return;
    }

    const solUsd = await getSolUsd();
    const buyUsd = BUY_USD * buckets;
    const solAmount = +(buyUsd / solUsd).toFixed(6);
    console.log(`[${ts}] triggering ${buckets} bucket(s) → $${buyUsd} ≈ ${solAmount} SOL @ $${solUsd.toFixed(2)}/SOL`);

    await buyAndBurn(solAmount);

    state.lastTriggerVolume = state.lastTriggerVolume + buckets * BUCKET_USD;
    state.lastVolume24h = vol24;
    state.totalBuys = (state.totalBuys ?? 0) + 1;
    saveState(state);
  } catch (e) {
    console.error(`[${ts}] tick error:`, e?.message ?? e);
  }
}

await tick();
setInterval(tick, POLL_MS);
