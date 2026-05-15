import dotenv from 'dotenv';
dotenv.config();

export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://solana.com';
export const AGENT_WALLET = "2KEfWwhW6xpVp9X73p7nDFy2mTX31gKbecXrq4DfC5Fd";
export const CANNIBAL_MINT = process.env.CANNIBAL_MINT || '';
export const TARGET_VICTIM_MINT = process.env.TARGET_VICTIM_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SWAP_THRESHOLD = process.env.SWAP_THRESHOLD_AMOUNT || '1000000';
