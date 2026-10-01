import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { builderConfig } from "@/lib/builder-config";
export function SiteHeader({ studio = false }: { studio?: boolean }) {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/">
        <BrandMark />
        <span>
          {builderConfig.name === "Open Overskill" ? (
            <>open<span className="wordmark-light">overskill</span></>
          ) : builderConfig.name}
          <sup>pilot</sup>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/guide">Quickstart</Link>
        <a href={builderConfig.docsUrl} target="_blank" rel="noreferrer">
          API docs <ArrowUpRight size={13} />
        </a>
        <Link href={studio ? "/" : "/workspace"} className="nav-cta">
          {studio ? "Overview" : "Try the builder"}
        </Link>
      </nav>
    </header>
  );
}
