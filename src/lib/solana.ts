import { CANNIBAL_WALLET, SOLANA_RPC, TRACKING_START_UNIX } from "./cannibal-config";

export type CannibalSignature = {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: unknown;
};

export type CannibalTx = CannibalSignature & {
  solSpent: number;        // SOL (positive = wallet paid out)
  tokensBurned: number;    // ui-amount of tokens burned in this tx (sum across mints)
  burnMints: string[];     // mints that were burned
  isEat: boolean;          // true if this tx contains a burn instruction from our wallet
};

export type CannibalStats = {
  txs: CannibalTx[];
  totals: {
    solSpent: number;
    tokensBurned: number;
    eats: number;
    txCount: number;
  };
};

type RpcSig = {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: unknown;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

export async function fetchSignatures(limit = 50): Promise<CannibalSignature[]> {
  const sigs = await rpc<RpcSig[]>("getSignaturesForAddress", [
    CANNIBAL_WALLET,
    { limit },
  ]);
  return sigs
    .filter((s) => s.blockTime != null && s.blockTime >= TRACKING_START_UNIX)
    .map((s) => ({
      signature: s.signature,
      blockTime: s.blockTime,
      slot: s.slot,
      err: s.err,
    }));
}

// Fetch every signature since TRACKING_START_UNIX via pagination.
export async function fetchAllSignatures(pageSize = 1000): Promise<CannibalSignature[]> {
  const out: CannibalSignature[] = [];
  let before: string | undefined;
  // hard safety cap to avoid runaway loops
  for (let i = 0; i < 50; i++) {
    const params: Record<string, unknown> = { limit: pageSize };
    if (before) params.before = before;
    const page = await rpc<RpcSig[]>("getSignaturesForAddress", [CANNIBAL_WALLET, params]);
    if (!page.length) break;
    let reachedStart = false;
    for (const s of page) {
      if (s.blockTime != null && s.blockTime < TRACKING_START_UNIX) {
        reachedStart = true;
        continue;
      }
      out.push({
        signature: s.signature,
        blockTime: s.blockTime,
        slot: s.slot,
        err: s.err,
      });
    }
    if (reachedStart || page.length < pageSize) break;
    before = page[page.length - 1].signature;
  }
  return out;
}

// Per-tx cache so polling doesn't hammer the RPC.
const txCache = new Map<string, CannibalTx>();

type ParsedInstr = {
  program?: string;
  programId?: string;
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
  };
};

type ParsedTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
    uiAmountString?: string;
  };
};

type ParsedTxResult = {
  blockTime: number | null;
  slot: number;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: ParsedTokenBalance[];
    postTokenBalances?: ParsedTokenBalance[];
    innerInstructions?: Array<{ index: number; instructions: ParsedInstr[] }>;
  } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean } | string>;
      instructions: ParsedInstr[];
    };
  };
};

function burnDecimals(
  tx: ParsedTxResult,
  info: Record<string, unknown>,
  keys: ParsedTxResult["transaction"]["message"]["accountKeys"],
): number {
  const account = info.account as string | undefined;
  const mint = info.mint as string | undefined;
  const balances = [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])];
  const match = balances.find((b) => {
    const tokenAccount = getKeyAt(keys, b.accountIndex);
    return (account ? tokenAccount === account : true) && (mint ? b.mint === mint : true);
  }) ?? balances.find((b) => (mint ? b.mint === mint : false));
  return match?.uiTokenAmount?.decimals ?? 0;
}

function getKeyAt(
  keys: ParsedTxResult["transaction"]["message"]["accountKeys"],
  i: number,
): string {
  const k = keys[i];
  return typeof k === "string" ? k : k.pubkey;
}

async function fetchTx(sig: CannibalSignature): Promise<CannibalTx> {
  const cached = txCache.get(sig.signature);
  if (cached) return cached;

  const tx = await rpc<ParsedTxResult | null>("getTransaction", [
    sig.signature,
    { maxSupportedTransactionVersion: 0, encoding: "jsonParsed", commitment: "confirmed" },
  ]);

  let solSpent = 0;
  let tokensBurned = 0;
  const burnMints: string[] = [];

  if (tx && tx.meta) {
    // SOL delta on the wallet account (account index of CANNIBAL_WALLET)
    const keys = tx.transaction.message.accountKeys;
    const idx = keys.findIndex((k) => getKeyAt([k], 0) === CANNIBAL_WALLET);
    if (idx >= 0) {
      const pre = tx.meta.preBalances[idx] ?? 0;
      const post = tx.meta.postBalances[idx] ?? 0;
      const lamportsDelta = pre - post; // positive = paid out
      if (lamportsDelta > 0) solSpent = lamportsDelta / 1e9;
    }

    // Walk all instructions (top-level + inner) for spl-token burns
    const all: ParsedInstr[] = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions ?? []).flatMap((group) => group.instructions),
    ];
    for (const ix of all) {
      const t = ix.parsed?.type;
      if (!t) continue;
      if (t === "burn" || t === "burnChecked") {
        const info = ix.parsed?.info ?? {};
        const mint = (info.mint as string) ?? "";
        const amountStr =
          (info.tokenAmount as { uiAmount?: number; amount?: string; decimals?: number })?.amount ??
          (info.amount as string | undefined);
        const decimals =
          (info.tokenAmount as { decimals?: number })?.decimals ??
          (info.decimals as number | undefined) ??
          burnDecimals(tx, info, keys);
        const ui =
          (info.tokenAmount as { uiAmount?: number })?.uiAmount ??
          (amountStr ? Number(amountStr) / Math.pow(10, decimals) : 0);
        if (ui && Number.isFinite(ui)) tokensBurned += ui;
        if (mint) burnMints.push(mint);
      }
    }
  }

  const out: CannibalTx = {
    ...sig,
    solSpent,
    tokensBurned,
    burnMints,
    isEat: burnMints.length > 0,
  };
  txCache.set(sig.signature, out);
  return out;
}

export async function fetchStats(limit = 50): Promise<CannibalStats> {
  // Pull every signature since tracking start (paginated, cached per-tx).
  const allSigs = await fetchAllSignatures();
  // Sort newest first for display.
  allSigs.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

  const txs: CannibalTx[] = [];
  for (const s of allSigs) {
    try {
      txs.push(await fetchTx(s));
    } catch {
      txs.push({ ...s, solSpent: 0, tokensBurned: 0, burnMints: [], isEat: false });
    }
  }
  const totals = txs.reduce(
    (acc, t) => {
      acc.solSpent += t.solSpent;
      acc.tokensBurned += t.tokensBurned;
      if (t.isEat) acc.eats += 1;
      acc.txCount += 1;
      return acc;
    },
    { solSpent: 0, tokensBurned: 0, eats: 0, txCount: 0 },
  );
  // `limit` retained for backwards-compat; we still return all but caller can slice for display.
  void limit;
  return { txs, totals };
}
