"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Globe2,
  Monitor,
  Smartphone,
} from "lucide-react";

// Reject script/data/protocol-relative URLs before creating a link or frame.
export function safePreviewUrl(value?: string | null): string | null {
  if (!value) return null;
  if (/^\/[^/\\]/.test(value) && !value.includes("\\")) return value;
  try {
    const u = new URL(value);
    return !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function PreviewPanel({
  url,
  publishedUrl,
  busy,
  demo,
}: {
  url?: string | null;
  publishedUrl?: string | null;
  busy: boolean;
  demo: boolean;
}) {
  const [mobile, setMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const safe = safePreviewUrl(url);
  const published = safePreviewUrl(publishedUrl);
  async function copyEmbed() {
    if (!published) return;
    try {
      const absolute = new URL(published, window.location.origin).href;
      await navigator.clipboard.writeText(
        '<iframe src="' +
          absolute.replaceAll('"', "&quot;") +
          '" title="App" width="100%" height="720"></iframe>',
      );
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <section className="studio-preview">
      <div className="studio-preview-toolbar">
        <span>
          <span className="status-dot" /> {safe ? "App preview" : "Preview"}
        </span>
        <div className="device-switch" aria-label="Preview size">
          <button
            aria-label="Desktop preview"
            aria-pressed={!mobile}
            onClick={() => setMobile(false)}
          >
            <Monitor size={15} />
          </button>
          <button
            aria-label="Mobile preview"
            aria-pressed={mobile}
            onClick={() => setMobile(true)}
          >
            <Smartphone size={15} />
          </button>
        </div>
        {safe && (
          <a
            href={safe}
            target="_blank"
            rel="noreferrer"
            aria-label="Open preview in new tab"
          >
            <ArrowUpRight size={16} />
          </a>
        )}
      </div>
      <div className={"preview-stage " + (mobile ? "mobile-preview" : "")}>
        {safe ? (
          <iframe
            key={safe}
            src={safe}
            title="App preview"
            sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="preview-empty">
            <div className="empty-grid">
              <Globe2 size={36} />
            </div>
            <h2>
              {busy
                ? "Your app is taking shape."
                : "An idea goes in.\nAn app comes out."}
            </h2>
            <p>
              {busy
                ? "Follow the conversation while your preview is prepared."
                : "Start with a prompt. This is where you’ll see the result."}
            </p>
            <span>
              {demo ? "SIMULATED LOCAL PREVIEW" : "POWERED BY OVERSKILL"}
            </span>
          </div>
        )}
      </div>
      {published && (
        <div className="embed-handoff">
          <span>
            <Check size={15} />
            {demo ? "Demo handoff ready" : "Deployment requested"}
          </span>
          <button onClick={copyEmbed}>
            <Copy size={13} />
            {copied ? "Copied" : demo ? "Copy sample embed" : "Copy embed"}
          </button>
          {copyError && (
            <span role="alert">
              Clipboard unavailable. Open the preview to copy its URL.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
