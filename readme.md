# Cannibal Token Autonomous Burn Agent

Autonomous liquidity engine designed for Solana automated market makers. This system monitors transaction fee wallets, queries the Jupiter V6 swap routing API, and executes market orders to purchase target assets for immediate deflationary burning.

![Protocol Concept Idea](https://chatgpt.com/backend-api/estuary/content?id=file_000000001aa871f48a46808b8c24e5be&ts=494134&p=fs&cid=1&sig=bcd42f9355d1c146415c7b36f66beb5d654a7e847c88bdcf12b9f44d49b7a5ce&v=0)

## Project Structure

* package.json - Project manifest and package dependencies
* .env.example - Template for network configurations and cryptographic credentials
* src/index.ts - Core initialization script and main daemon execution loops
* src/services/jupiter.ts - API client integration layer for Jupiter liquidity routers

## Installation

1. Clone this repository to your local system environment.
2. Initialize environment settings:
   ```bash
   cp .env.example .env
   ```
3. Install the required Node.js package dependencies:
   ```bash
   npm install
   ```

## Development

To spin up the execution script locally in a development container or shell:
```bash
npm run dev
```
