import { Github } from "lucide-react";
import { CANNIBAL_WALLET, GITHUB_URL, SOLSCAN_ADDR } from "@/lib/cannibal-config";

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-24">
      <div className="mx-auto max-w-5xl px-6 py-8 grid gap-4 md:grid-cols-3 text-xs text-muted-foreground">
        <div>
          <div className="uppercase tracking-[0.3em] text-foreground/80 mb-2">Wallet</div>
          <a
            href={SOLSCAN_ADDR(CANNIBAL_WALLET)}
            target="_blank"
            rel="noreferrer"
            className="break-all hover:text-blood"
          >
            {CANNIBAL_WALLET}
          </a>
        </div>
        <div>
          <div className="uppercase tracking-[0.3em] text-foreground/80 mb-2">Chain</div>
          <p>Solana mainnet-beta</p>
        </div>
        <div className="md:text-right">
          <div className="uppercase tracking-[0.3em] text-foreground/80 mb-2">Source</div>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 hover:text-blood"
          >
            <Github className="size-3.5" /> tekPioneered
          </a>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-4 text-[10px] uppercase tracking-[0.4em] text-muted-foreground/60 flex justify-between">
          <span>$CANNIBAL // 2026</span>
          <span>eat. burn. repeat.</span>
        </div>
      </div>
    </footer>
  );
}
