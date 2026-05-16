import { useEffect, useState } from "react";
import { fetchSignatures, type CannibalSignature } from "@/lib/solana";
import { SOLSCAN_TX, TRACKING_START_UNIX } from "@/lib/cannibal-config";

function fmtTime(t: number | null) {
  if (!t) return "—";
  const d = new Date(t * 1000);
  return d.toISOString().replace("T", " ").replace(/\..+/, "Z");
}

function shortSig(s: string) {
  return `${s.slice(0, 8)}…${s.slice(-8)}`;
}

export function TransactionLedger() {
  const [sigs, setSigs] = useState<CannibalSignature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await fetchSignatures(100);
        if (active) {
          setSigs(data);
          setError(null);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "RPC error");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="border border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className={`tick ${loading ? "pulse-blood" : ""}`} />
          <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Live Ledger
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          since {fmtTime(TRACKING_START_UNIX)}
        </span>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-blood border-b border-border">
          rpc unreachable — {error}. retrying.
        </div>
      )}

      {sigs && sigs.length === 0 && !error && (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          no transactions yet. the wallet is hungry.
        </div>
      )}

      <ul className="divide-y divide-border">
        {sigs?.map((s) => (
          <li key={s.signature} className="grid grid-cols-12 gap-3 px-4 py-3 text-xs hover:bg-secondary/50">
            <span className="col-span-3 text-muted-foreground">{fmtTime(s.blockTime)}</span>
            <span className="col-span-2 text-muted-foreground">slot {s.slot}</span>
            <a
              href={SOLSCAN_TX(s.signature)}
              target="_blank"
              rel="noreferrer"
              className="col-span-5 text-foreground hover:text-blood underline-offset-4 hover:underline truncate"
            >
              {shortSig(s.signature)}
            </a>
            <span className={`col-span-2 text-right ${s.err ? "text-blood" : "text-foreground/70"}`}>
              {s.err ? "FAILED" : "CONFIRMED"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
