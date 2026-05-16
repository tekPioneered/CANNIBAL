// Cannibal — tracking config
// Wallet that performs the cannibalize-and-burn operations.
export const CANNIBAL_WALLET = "2KEfWwhW6xpVp9X73p7nDFy2mTX31gKbecXrq4DfC5Fd";

// Track from this moment forward. Anything before this Unix timestamp is ignored.
// Reset: 2026-05-16T01:15:00Z — stats start fresh from here.
export const TRACKING_START_UNIX = 1778894100;

// Public CORS-enabled Solana RPC (api.mainnet-beta.solana.com blocks browser requests with 403)
export const SOLANA_RPC = "https://solana-rpc.publicnode.com";
export const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}`;
export const SOLSCAN_ADDR = (addr: string) => `https://solscan.io/account/${addr}`;
export const GITHUB_URL = "https://github.com/tekPioneered/cannibal";
