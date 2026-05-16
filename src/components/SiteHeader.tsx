import { Github } from "lucide-react";
import { GITHUB_URL } from "@/lib/cannibal-config";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="tick" />
          <span className="font-stencil text-sm tracking-[0.4em] text-blood">CANNIBAL</span>
        </div>
        <nav className="flex items-center gap-6 text-xs uppercase tracking-[0.25em] text-muted-foreground">
          <a href="#manifesto" className="hover:text-foreground">Manifesto</a>
          <a href="#mission" className="hover:text-foreground">Mission</a>
          <a href="#tech" className="hover:text-foreground">Tech</a>
          <a href="#ledger" className="hover:text-foreground">Ledger</a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="text-muted-foreground hover:text-blood transition-colors"
          >
            <Github className="size-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}
