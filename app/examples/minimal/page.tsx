import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { MinimalBuilder } from "@/components/examples/MinimalBuilder";

export const metadata = { title: "Minimal builder example" };

export default function MinimalBuilderPage() {
  return (
    <>
      <SiteHeader />
      <main className="home-main" style={{ maxWidth: 880, paddingTop: 56, paddingBottom: 80 }}>
        <header style={{ marginBottom: 32 }}>
          <div className="eyebrow">COMPONENT EXAMPLE</div>
          <h1 style={{ fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 500, letterSpacing: "-1.4px", lineHeight: 1.15, margin: "16px 0" }}>
            A smaller builder. The same flow.
          </h1>
          <p className="guide-lead">
            Prompt, conversation and preview, composed with useBuilder. A working
            example you can bring into your own interface.
          </p>
          <Link className="text-link" href="/guide#components">
            <ArrowLeft size={15} /> Back to the component guide
          </Link>
        </header>
        <MinimalBuilder />
      </main>
    </>
  );
}
