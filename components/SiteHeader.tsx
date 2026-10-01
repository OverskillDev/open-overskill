import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark, BrandName } from "./BrandMark";
import { builderConfig } from "@/lib/builder-config";
export function SiteHeader({ studio = false }: { studio?: boolean }) {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/" aria-label={`${builderConfig.name} home`}>
        <BrandMark />
        <span>
          <BrandName lightClassName="wordmark-light" />
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
