# CANNIBAL

![Protocol Concept Idea](https://media.discordapp.net/attachments/1446965347726135529/1504980288613388338/content.png?ex=6a08f59d&is=6a07a41d&hm=1258178b12126a236e582d1b70cab5ea0e1cb2a6d737615c7f457c5fddc61752&=&format=webp&quality=lossless&width=550&height=147)

Cannibal CLI scripts for buying a token with SOL and burning the received tokens.

Your private key stays on your machine.

## Install

```bash
cd scripts
npm init -y
npm i @solana/web3.js @solana/spl-token bs58
```

## Configure

Use a private RPC provider. Public Solana RPC is slow and rate-limited.

```bash
export CANNIBAL_SECRET="<base58 private key>"
export SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
```

`CANNIBAL_SECRET` should be the base58 private key exported from Phantom.

## Recommended: atomic buy and burn

`cannibal-fast.mjs` performs the Jupiter swap and SPL burn in one transaction.

```bash
node cannibal-fast.mjs <MINT> <SOL_AMOUNT> [SLIPPAGE_BPS] [PRIORITY_MICROLAMPORTS]
```

Example:

```bash
node cannibal-fast.mjs 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr 0.05 200 200000
```

Arguments:

- `MINT` — token mint address
- `SOL_AMOUNT` — amount of SOL to spend
- `SLIPPAGE_BPS` — optional, defaults to `200`
- `PRIORITY_MICROLAMPORTS` — optional, defaults to `200000`

## Fallback: two-transaction buy and burn

Use this if the atomic route cannot fit into one transaction.

```bash
node cannibal-buy-burn.mjs <MINT> <SOL_AMOUNT> [SLIPPAGE_BPS]
```

## Notes

- Use a private RPC such as Helius or Triton.
- Increase slippage for thin or newly launched tokens.
- Increase priority fee during network congestion.
- Test with a small amount first.
- Never share your private key.
