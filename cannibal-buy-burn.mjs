#!/usr/bin/env node
// cannibal — buy a token with SOL via Jupiter, then burn 100% of it.
//
// Usage:
//   1) cd scripts && npm i @solana/web3.js @solana/spl-token bs58
//   2) export CANNIBAL_SECRET="<base58 secret key of 2KEf...C5Fd>"
//   3) node cannibal-buy-burn.mjs <TOKEN_MINT> <SOL_AMOUNT> [SLIPPAGE_BPS]
//
// Example:
//   node cannibal-buy-burn.mjs So11111111111111111111111111111111111111112 0.05 100
//
// Notes:
//   - SOL_AMOUNT is in SOL (e.g. 0.05). Script handles lamports.
//   - SLIPPAGE_BPS default 100 (1%). Use 300-500 for low-liq memecoins.
//   - The wallet must hold SOL for the swap + ~0.002 SOL for fees.

import {
  Connection, Keypair, VersionedTransaction, PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress, createBurnInstruction, getAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const SECRET = process.env.CANNIBAL_SECRET;
const [, , MINT_ARG, SOL_ARG, SLIP_ARG] = process.argv;

if (!SECRET) { console.error("missing CANNIBAL_SECRET env var"); process.exit(1); }
if (!MINT_ARG || !SOL_ARG) {
  console.error("usage: node cannibal-buy-burn.mjs <MINT> <SOL_AMOUNT> [SLIPPAGE_BPS]");
  process.exit(1);
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const slippageBps = Number(SLIP_ARG ?? 100);
const lamports = Math.floor(Number(SOL_ARG) * 1e9);
const targetMint = new PublicKey(MINT_ARG);

const conn = new Connection(RPC, "confirmed");
const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
console.log("wallet:", kp.publicKey.toBase58());

// 1) quote
const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
quoteUrl.searchParams.set("inputMint", SOL_MINT);
quoteUrl.searchParams.set("outputMint", targetMint.toBase58());
quoteUrl.searchParams.set("amount", String(lamports));
quoteUrl.searchParams.set("slippageBps", String(slippageBps));
const quote = await (await fetch(quoteUrl)).json();
if (!quote || quote.error) throw new Error("quote failed: " + JSON.stringify(quote));
console.log("expected out:", quote.outAmount, "raw units");

// 2) swap tx
const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: kp.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  }),
}).then(r => r.json());
if (!swapRes.swapTransaction) throw new Error("swap build failed: " + JSON.stringify(swapRes));

const tx = VersionedTransaction.deserialize(Buffer.from(swapRes.swapTransaction, "base64"));
tx.sign([kp]);
const buySig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
console.log("buy sent:", buySig);
await conn.confirmTransaction(buySig, "confirmed");
console.log("buy confirmed.");

// 3) read ATA balance, burn it all
const ata = await getAssociatedTokenAddress(targetMint, kp.publicKey);
const acc = await getAccount(conn, ata);
const amount = acc.amount; // bigint
if (amount === 0n) { console.log("nothing to burn."); process.exit(0); }
console.log("burning:", amount.toString());

const burnIx = createBurnInstruction(ata, targetMint, kp.publicKey, amount);
const { blockhash } = await conn.getLatestBlockhash("confirmed");
const msg = new (await import("@solana/web3.js")).TransactionMessage({
  payerKey: kp.publicKey,
  recentBlockhash: blockhash,
  instructions: [burnIx],
}).compileToV0Message();
const burnTx = new VersionedTransaction(msg);
burnTx.sign([kp]);
const burnSig = await conn.sendRawTransaction(burnTx.serialize(), { maxRetries: 3 });
await conn.confirmTransaction(burnSig, "confirmed");
console.log("burned. sig:", burnSig);
console.log(`https://solscan.io/tx/${burnSig}`);
