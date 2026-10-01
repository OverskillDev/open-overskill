"use client";

import { useState } from "react";
import { useBuilder } from "@/hooks/useBuilder";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  KeyRound,
  Loader2,
  LockKeyhole,
  Rocket,
} from "lucide-react";
import { SiteHeader } from "./SiteHeader";
import { PromptComposer } from "./builder/PromptComposer";
import { BuildTranscript } from "./builder/BuildTranscript";
import { PreviewPanel } from "./builder/PreviewPanel";
import { CreditAccountNotice, CreatorAccessRecovery } from "./builder/CreditAccountNotice";
import { builderConfig, overskillLinks } from "@/lib/builder-config";
export function Editor() {
  const {
    config, creator, brief, suggestions, ready, locked, unlocking, error,
    prompt, submitted, busy, stage, status, appId, messages, deploying,
    deployState, publishedUrl, setPrompt, build, deploy, lock,
    provisioned, needsKeyRecovery, recoveringKey, recoverCreatorKey,
    creditAccount, creditAccountLoading, creditAccountBlocked, creditAccountError, refreshCreditAccount,
    unlock: unlockSession,
  } = useBuilder();
  const [token, setToken] = useState("");
  const [contextOpen, setContextOpen] = useState(false);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    const credential = token;
    setToken("");
    await unlockSession(credential);
  }

  return (
    <div className="studio-page">
      <SiteHeader studio />
      <div className="studio-topline">
        <div>
          <span className="workspace-icon">
            {builderConfig.studioName.slice(0, 1)}
          </span>
          <strong>{builderConfig.studioName}</strong>
          <span className="muted">/</span>
          <span>Creator studio</span>
        </div>
        <div>
          <span className="engine-badge">
            <span className="status-dot" />
            {config
              ? config.mock
                ? "Demo engine"
                : "Live Overskill"
              : "Connecting"}
          </span>
          {ready && config && !config.mock && (
            <button className="lock-button" onClick={lock}>
              <LockKeyhole size={13} /> Lock
            </button>
          )}
        </div>
      </div>
      <div className="demo-notice">
        <CircleHelp size={14} />
        {!config
          ? "Loading your local builder configuration…"
          : config.mock
            ? "This is a simulated build. No AI credits are used and nothing is published online."
            : "Local operator pilot. Live builds use the creator workspace’s Overskill credits."}
        <a href="/guide">
          Setup guide <ArrowRight size={12} />
        </a>
      </div>
      <main className="studio-layout">
        <section className="studio-conversation">
          <div className="studio-heading">
            <div className="eyebrow">YOUR BUILDER, YOUR EXPERIENCE</div>
            <h1>What’s the next idea?</h1>
            <p>Describe an idea. Ship a real app.</p>
          </div>
          <div className="creator-brief">
            <button
              aria-expanded={contextOpen}
              aria-controls="creator-details"
              onClick={() => setContextOpen(!contextOpen)}
            >
              <span className="creator-avatar">PN</span>
              <span>
                <strong>{creator?.brand || "Loading example creator…"}</strong>
                <small>Fictional creator · example context</small>
              </span>
              <ChevronDown
                size={16}
                style={{
                  transform: contextOpen ? "rotate(180deg)" : undefined,
                }}
              />
            </button>
            <div className="context-disclosure" data-open={contextOpen}>
              <div id="creator-details" inert={!contextOpen}>
                <p>{creator?.niche}</p>
                <pre>{brief}</pre>
              </div>
            </div>
          </div>
          {locked && (
            <form className="unlock-form" onSubmit={unlock}>
              <KeyRound size={19} />
              <h2>Unlock your local pilot</h2>
              <p>
                Enter the operator token configured on your server. Your partner
                API key stays on the server.
              </p>
              <label htmlFor="operator-token">Operator token</label>
              <input
                id="operator-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="button primary" disabled={unlocking || !token}>
                {unlocking ? "Unlocking…" : "Unlock builder"}
              </button>
            </form>
          )}
          {needsKeyRecovery && <CreatorAccessRecovery recovering={recoveringKey} onRecover={recoverCreatorKey} />}
          <PromptComposer
            value={prompt}
            onChange={setPrompt}
            onSubmit={build}
            suggestions={suggestions}
            suggestionLabels={["Member portal", "Helpful quiz", "Event landing page"]}
            disabled={!ready || needsKeyRecovery || recoveringKey || creditAccountBlocked || creditAccountLoading}
            busy={busy}
            hasApp={Boolean(appId)}
          />
          {ready && config && provisioned && <CreditAccountNotice account={creditAccount} loading={creditAccountLoading} error={creditAccountError}
            demo={config.mock} provisioned={provisioned} needsKeyRecovery={needsKeyRecovery}
            disabled={busy || recoveringKey} onRefresh={refreshCreditAccount} />}
          {error && (
            <div role="alert" className="error-message">
              {error}
            </div>
          )}
          {submitted && (
            <div className="submitted-prompt">
              <span className="small-label">YOU</span>
              <p>{submitted}</p>
            </div>
          )}
          <div className="build-status" aria-live="polite">
            {busy ? (
              <Loader2 size={15} className="animate-spin-slow" />
            ) : status?.status === "completed" ? (
              <Check size={15} />
            ) : (
              <span className="status-dot" />
            )}
            <span>{stage}</span>
            {status && (
              <span className="progress-count">
                {Math.round(Math.min(100, Math.max(0, status.progress)))}%
              </span>
            )}
          </div>
          {busy && (
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Build progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(status?.progress || 0)}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(3, status?.progress || 3))}%`,
                }}
              />
            </div>
          )}
          <BuildTranscript messages={messages} busy={busy} />
          <div className="deploy-panel">
            <div>
              <strong>
                {deployState === "demo"
                  ? "Demo deploy complete"
                  : deployState === "queued"
                    ? "Deployment requested"
                    : "Ready for the next step?"}
              </strong>
              <p>
                {deployState === "queued"
                  ? "Overskill accepted the request. This starter has not verified publication."
                  : config?.mock
                    ? "Explore the publishing handoff locally."
                    : "Request a deploy through the Overskill API."}
              </p>
            </div>
            <button
              className="button secondary"
              disabled={
                status?.status !== "completed" ||
                busy ||
                deploying ||
                deployState !== "idle"
              }
              onClick={deploy}
            >
              {deploying ? (
                <Loader2 size={15} className="animate-spin-slow" />
              ) : (
                <Rocket size={15} />
              )}{" "}
              {config?.mock ? "Demo deploy" : "Request deploy"}
            </button>
          </div>
        </section>
        <PreviewPanel
          url={status?.app?.preview_url}
          publishedUrl={publishedUrl}
          busy={busy}
          demo={Boolean(config?.mock)}
        />
      </main>
      <footer className="studio-footer">
        <span>Customizable interface. Managed Overskill engine.</span>
        <a href={overskillLinks.docsUrl}>Powered by Overskill ↗</a>
      </footer>
    </div>
  );
}
