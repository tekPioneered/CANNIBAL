import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Github } from "lucide-react";
import { fetchStats, type CannibalStats } from "@/lib/solana";
import {
  CANNIBAL_WALLET,
  GITHUB_URL,
  SOLSCAN_TX,
  SOLSCAN_ADDR,
} from "@/lib/cannibal-config";
import logo from "@/assets/cannibal-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "cannibal" },
      { name: "description", content: "the memecoin that eats memecoins." },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap",
      },
    ],
  }),
  component: Terminal,
});

type Tab = "manifesto" | "mission" | "how";
const TABS: Tab[] = ["manifesto", "mission", "how"];

const CONTRACT_ADDRESS = "J45BdF9VoGqheQD8MBCJede6bnVVtGURz1KaNLNepump";
const PUMPFUN_URL = `https://pump.fun/coin/${CONTRACT_ADDRESS}`;

function short(s: string) {
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function useStats() {
  const [stats, setStats] = useState<CannibalStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const d = await fetchStats(50);
        if (active) { setStats(d); setError(null); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "rpc error");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    // poll signatures often; tx details are cached so this stays cheap
    const id = setInterval(load, 30_000);
    const onFocus = () => load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return { stats, error, loading };
}

function Terminal() {
  const [tab, setTab] = useState<Tab>("manifesto");
  const live = useStats();
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8">
      <a
        href={PUMPFUN_URL}
        target="_blank"
        rel="noreferrer"
        className="mb-6 block text-blood font-mono text-[11px] sm:text-[12px] tracking-wider hover:underline break-all text-center"
        title="view on pump.fun"
      >
        {CONTRACT_ADDRESS}
      </a>
      <div className="w-full max-w-[640px] border border-border">
        {/* nav */}
        <nav className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px]">
          <span className="text-muted-foreground">cannibal:~$</span>
          <div className="flex gap-4">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  tab === t
                    ? "text-blood"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                {t}
              </button>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center"
              aria-label="github"
            >
              <Github size={13} />
            </a>
          </div>
        </nav>

        {/* logo */}
        <div className="flex justify-center border-b border-border px-4 py-6">
          <img
            src={logo}
            alt="cannibal"
            className="w-[260px] h-auto select-none ouroboros"
            draggable={false}
          />
        </div>

        {/* body */}
        <div className="p-5 text-[13px] leading-[1.6] min-h-[260px]">
          {tab === "manifesto" && <Manifesto live={live} />}
          {tab === "mission" && <Mission />}
          {tab === "how" && <HowItWorks />}
        </div>
      </div>
    </main>
  );
}

const TICKER_CACHE = new Map<string, string>();
function useTickers(mints: string[]) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const todo = mints.filter((m) => m && !TICKER_CACHE.has(m));
    if (!todo.length) return;
    let active = true;
    (async () => {
      await Promise.all(
        todo.map(async (m) => {
          // try jupiter first, then dexscreener as fallback
          try {
            const r = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${m}`);
            if (r.ok) {
              const j = (await r.json()) as { symbol?: string };
              if (j.symbol) {
                TICKER_CACHE.set(m, `$${j.symbol.toUpperCase()}`);
                return;
              }
            }
          } catch { /* fall through */ }
          try {
            const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${m}`);
            if (r.ok) {
              const j = (await r.json()) as { pairs?: Array<{ baseToken?: { symbol?: string } }> };
              const sym = j.pairs?.[0]?.baseToken?.symbol;
              if (sym) {
                TICKER_CACHE.set(m, `$${sym.toUpperCase()}`);
                return;
              }
            }
          } catch { /* fall through */ }
          TICKER_CACHE.set(m, "");
        }),
      );
      if (active) setTick((n) => n + 1);
    })();
    return () => { active = false; };
  }, [mints.join(",")]);
  return (mint?: string) => (mint ? TICKER_CACHE.get(mint) ?? "" : "");
}

function Manifesto({ live }: { live: ReturnType<typeof useStats> }) {
  const t = live.stats?.totals;
  const [visible, setVisible] = useState(5);
  const all = live.stats?.txs ?? [];
  const recent = all.slice(0, visible);
  const mints = Array.from(new Set(recent.flatMap((r) => r.burnMints)));
  const tickerOf = useTickers(mints);
  return (
    <div className="space-y-4 text-foreground/85">
      <p>the market is a forest of identical animals.</p>
      <p>cannibal is the predator it never had.</p>
      <p>every transfer pays a tax. the tax buys other memecoins. the tax burns them.</p>
      <p className="text-blood">eat. burn. repeat.</p>
      <p className="text-muted-foreground text-[12px]">the cannibal eats every 10 minutes.</p>

      {/* agent wallet */}
      <div className="flex justify-between text-[10px] text-muted-foreground/70 uppercase tracking-wider mt-2">
        <span>agent wallet</span>
        <a
          href={SOLSCAN_ADDR(CANNIBAL_WALLET)}
          target="_blank"
          rel="noreferrer"
          className="hover:text-blood normal-case tracking-normal"
        >
          {short(CANNIBAL_WALLET)} ↗
        </a>
      </div>

      {/* live stats */}
      <div className="grid grid-cols-3 gap-2 border border-border p-2 text-[11px]">
        <Stat label="eats (buy+burn)" value={t ? String(t.eats) : "—"} />
        <Stat label="sol spent" value={t ? fmtNum(t.solSpent) : "—"} />
        <Stat label="tokens burned" value={t ? fmtMillions(t.tokensBurned) : "—"} />
      </div>

      {/* live ticker */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground/70 uppercase tracking-wider">
          <span>live · last {Math.min(visible, all.length) || 5}</span>
          <span>{live.loading ? "syncing" : "idle"}</span>
        </div>
        {live.error && <div className="text-blood text-[11px]">rpc: {live.error}</div>}
        {!live.error && recent.length === 0 && (
          <div className="text-muted-foreground text-[11px]">∅ hungry.</div>
        )}
        <ul className="text-[11px] space-y-1">
          {recent.map((s) => {
            const ticks = s.burnMints.map(tickerOf).filter(Boolean);
            const label = ticks.length ? ticks.join(" ") : short(s.signature);
            return (
            <li
              key={s.signature}
              className="flex gap-2 animate-fade-in"
            >
              <span className="text-muted-foreground w-[70px] shrink-0">
                {s.blockTime ? new Date(s.blockTime * 1000).toISOString().slice(11, 19) : "—"}
              </span>
              <a
                href={SOLSCAN_TX(s.signature)}
                target="_blank"
                rel="noreferrer"
                title="view transaction on solscan"
                className="text-blood/90 hover:text-blood underline decoration-dotted decoration-blood/40 underline-offset-[3px] hover:decoration-blood flex-1 truncate"
              >
                {label} <span className="text-muted-foreground/60 no-underline">↗ tx</span>
              </a>
              {(() => {
                const kind = s.err ? "fail" : s.isEat ? "eat" : s.solSpent > 0 ? "buy" : "tx";
                const cls =
                  kind === "eat"
                    ? "text-blood"
                    : kind === "fail"
                    ? "text-blood/60 line-through"
                    : kind === "buy"
                    ? "text-amber-400"
                    : "text-foreground/40";
                const title =
                  kind === "eat"
                    ? "bought a rival memecoin and burned it in the same tx"
                    : kind === "buy"
                    ? "bought, but no burn detected"
                    : kind === "fail"
                    ? "transaction failed on-chain"
                    : "other wallet activity";
                return (
                  <span className={`${cls} w-12 text-right uppercase tracking-wider`} title={title}>
                    {kind}
                  </span>
                );
              })()}
            </li>
            );
          })}
        </ul>
        <div className="flex gap-4 pt-1">
          {visible < all.length && (
            <button
              onClick={() => setVisible((v) => Math.min(v + 10, all.length))}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-blood"
            >
              + view more ({Math.min(10, all.length - visible)})
            </button>
          )}
          {visible > 5 && (
            <button
              onClick={() => setVisible(5)}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-blood"
            >
              − collapse
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function Mission() {
  const rows = [
    ["fuel", "pumpfun creator fees route directly into the agent wallet"],
    ["hunt", "wallet swaps that sol into rival memecoins via jupiter"],
    ["burn", "every coin acquired is incinerated on-chain, forever"],
    ["loop", "supply contracts. competitors thin. cannibal grows."],
  ];
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4">
            <span className="text-blood w-12">{k}</span>
            <span className="text-foreground/85">{v}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
          why
        </div>
        <p className="text-foreground/75 text-[12px] leading-[1.65]">
          this protocol was conceptualized based on a systemic architecture
          hypothesis proposed by andy ayrey's truth terminal. the mechanic
          establishes a self-consuming cycle where a token absorbs and
          liquidates competing market capitalization pools to contract asset
          supply.
        </p>
      </div>
    </div>
  );
}

function Tech() {
  const rows = [
    ["chain", "solana"],
    ["token", "p-token only"],
    ["tax", "transfer fee extension"],
    ["hunter", "jupiter aggregator"],
    ["burn", "1nc1nerator"],
    ["authority", "renounced"],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-4">
          <span className="text-muted-foreground w-20">{k}</span>
          <span className="text-foreground/85">{v}</span>
        </div>
      ))}
    </div>
  );
}

function fmtNum(n: number, max = 4) {
  if (!n) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

function fmtMillions(n: number) {
  if (!n) return "0";
  const v = n / 1e6;
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: digits })}M`;
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}


function HowItWorks() {
  const steps = [
    ["tick", "every 10 minutes the agent reads $cannibal 24h volume"],
    ["bucket", "every $5,000 of volume = 1 buy-and-burn"],
    ["fire", "if a bucket is ready, it market-buys a random trending solana token via jupiter, then burns 100% of the received balance on-chain"],
    ["carry", "if $5k of volume isn't reached in a 10-minute tick, no buy fires — the volume carries forward until the next bucket fills"],
    ["loop", "more volume → more buckets → more rival coins eaten. forever."],
  ];
  return (
    <div className="space-y-4">
      <p className="text-foreground/85">
        the cannibal feeder converts $cannibal trading volume into permanent supply destruction of other solana tokens.
      </p>
      <div className="space-y-2">
        {steps.map(([k, v]) => (
          <div key={k} className="flex gap-4">
            <span className="text-blood w-16 shrink-0">{k}</span>
            <span className="text-foreground/85">{v}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-3 text-[11px] text-muted-foreground leading-[1.65]">
        every buy and burn is a public solana transaction. verifiable end-to-end. nothing left behind.
      </div>
    </div>
  );
}
