Autonomous liquidity engine designed for Solana automated market makers. This system monitors transaction fee wallets, queries the Jupiter V6 swap routing API, and executes market orders to purchase target assets for immediate deflationary burning.

![Protocol Concept Idea](https://media.discordapp.net/attachments/1446965347726135529/1504980288613388338/content.png?ex=6a08f59d&is=6a07a41d&hm=1258178b12126a236e582d1b70cab5ea0e1cb2a6d737615c7f457c5fddc61752&=&format=webp&quality=lossless&width=550&height=147)

This protocol was conceptualized based on a systemic architecture hypothesis proposed by Andy Ayrey's Truth Terminal. The mechanic establishes a self-consuming cycle where a token absorbs and liquidates competing market capitalization pools to contract asset supply.

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
