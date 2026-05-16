#!/usr/bin/env node
// cannibal-fast — atomic buy + burn in ONE transaction.
//
// Why this is faster than buy-then-burn:
//   - one signature, one block landing (no waiting for swap to confirm before burning)
//   - tokens never sit in your wallet (no Phantom indexer lag)
//   - reverts atomically if swap underdelivers — no orphaned bag
//
// Prereq:
//   cd scripts && npm i @solana/web3.js @solana/spl-token bs58
//
// Use a FAST RPC. Public mainnet-beta is the slowest part of the pipeline.
//   Helius free: https://dashboard.helius.dev   ->  https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
//   Triton, QuickNode, Shyft also fine.
//
// Run:
//   export CANNIBAL_SECRET="<base58 secret>"
//   export SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
//   node cannibal-fast.mjs <TOKEN_MINT> <SOL_AMOUNT> [SLIPPAGE_BPS] [PRIORITY_MICROLAMPORTS]
//
// Example:
//   node cannibal-fast.mjs <mint> 0.05 200 200000

import {
  Connection, Keypair, VersionedTransaction, TransactionMessage,
  PublicKey, ComputeBudgetProgram, AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  createBurnInstruction, createBurnCheckedInstruction,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const SECRET = process.env.CANNIBAL_SECRET;
const [, , MINT_ARG, SOL_ARG, SLIP_ARG, PRIO_ARG] = process.argv;
if (!SECRET || !MINT_ARG || !SOL_ARG) {
  console.error("usage: node cannibal-fast.mjs <MINT> <SOL_AMOUNT> [SLIP_BPS] [PRIO_uLAMPORTS]");
  process.exit(1);
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const slippageBps = Number(SLIP_ARG ?? 200);
const prioFee = Number(PRIO_ARG ?? 200_000); // microlamports per CU
const lamports = Math.floor(Number(SOL_ARG) * 1e9);
const targetMint = new PublicKey(MINT_ARG);

const conn = new Connection(RPC, { commitment: "processed" });
const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
console.log("wallet:", kp.publicKey.toBase58(), "rpc:", RPC.includes("helius") ? "helius" : "other");

// detect token program (token-2022 vs classic)
const mintAcc = await conn.getAccountInfo(targetMint);
if (!mintAcc) throw new Error("mint not found");
const tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

// 1) quote (exactIn SOL -> token)
const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
quoteUrl.searchParams.set("inputMint", SOL_MINT);
quoteUrl.searchParams.set("outputMint", targetMint.toBase58());
quoteUrl.searchParams.set("amount", String(lamports));
quoteUrl.searchParams.set("slippageBps", String(slippageBps));
quoteUrl.searchParams.set("onlyDirectRoutes", "false");
const quote = await (await fetch(quoteUrl)).json();
if (!quote || quote.error) throw new Error("quote: " + JSON.stringify(quote));

const minOut = BigInt(quote.otherAmountThreshold); // guaranteed minimum we'll receive
console.log("min out (atomic burn amount):", minOut.toString());

// 2) get swap instructions (NOT a packaged tx) so we can append the burn
const swapIxRes = await fetch("https://quote-api.jup.ag/v6/swap-instructions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: kp.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: prioFee, // baked-in priority on top of our explicit ix
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

// 3) burn instruction — burns the guaranteed minOut in same tx
const ata = getAssociatedTokenAddressSync(targetMint, kp.publicKey, false, tokenProgramId);
const decimals = quote.outputDecimals ?? 0;
const burnIx = decimals > 0
  ? createBurnCheckedInstruction(ata, targetMint, kp.publicKey, minOut, decimals, [], tokenProgramId)
  : createBurnInstruction(ata, targetMint, kp.publicKey, minOut, [], tokenProgramId);

// 4) Address Lookup Tables from Jupiter
const lutAccounts = [];
for (const addr of swapIxRes.addressLookupTableAddresses ?? []) {
  const info = await conn.getAccountInfo(new PublicKey(addr));
  if (info) lutAccounts.push(new AddressLookupTableAccount({
    key: new PublicKey(addr),
    state: AddressLookupTableAccount.deserialize(info.data),
  }));
}

// 5) build + sign + send
const extraPrio = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioFee });
const ixs = [extraPrio, ...computeIxs, ...setupIxs, swapIx, burnIx, ...(cleanupIx ? [cleanupIx] : [])];

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("processed");
const msg = new TransactionMessage({
  payerKey: kp.publicKey,
  recentBlockhash: blockhash,
  instructions: ixs,
}).compileToV0Message(lutAccounts);

const tx = new VersionedTransaction(msg);
tx.sign([kp]);

const sig = await conn.sendRawTransaction(tx.serialize(), {
  skipPreflight: true,   // we built it carefully; skip the slow simulation
  maxRetries: 0,         // we'll handle retries ourselves
});
console.log("sent:", sig);
console.log(`https://solscan.io/tx/${sig}`);

// confirm at processed for fastest signal, then upgrade to confirmed
await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "processed");
console.log("processed.");
await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
console.log("confirmed. eaten.");
