"use client";
import { useState } from "react";
import { useBuilder } from "@/hooks/useBuilder";
import { PromptComposer } from "@/components/builder/PromptComposer";
import { BuildTranscript } from "@/components/builder/BuildTranscript";
import { PreviewPanel } from "@/components/builder/PreviewPanel";
import { CreditAccountNotice, CreatorAccessRecovery } from "@/components/builder/CreditAccountNotice";

/** Minimal composition for an existing React surface; uses the same local API. */
export function MinimalBuilder() {
  const builder = useBuilder();
  const [token, setToken] = useState("");
  return (
    <section aria-label="Minimal app builder">
      <p className="demo-notice" style={{ marginBottom: 24 }}>
        {!builder.config
          ? "Loading local builder configuration…"
          : builder.config.mock
            ? "Simulated local build. No AI credits are used and nothing is published online."
            : "Local operator pilot. Live requests can use credits and create workspaces or deployments."}
      </p>
      {builder.locked && (
        <form className="unlock-form" onSubmit={(event) => {
          event.preventDefault();
          const credential = token;
          setToken("");
          void builder.unlock(credential);
        }}>
          <label htmlFor="minimal-operator-token">Local operator token</label>
          <input id="minimal-operator-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
          <button className="button primary" disabled={!token || builder.unlocking}>
            {builder.unlocking ? "Unlocking…" : "Unlock local pilot"}
          </button>
        </form>
      )}
      {builder.needsKeyRecovery && <CreatorAccessRecovery recovering={builder.recoveringKey} onRecover={builder.recoverCreatorKey} />}
      <PromptComposer value={builder.prompt} onChange={builder.setPrompt} onSubmit={builder.build} suggestions={builder.suggestions} disabled={!builder.ready || builder.needsKeyRecovery || builder.recoveringKey || builder.creditAccountBlocked || builder.creditAccountLoading} busy={builder.busy} hasApp={Boolean(builder.appId)} />
      {builder.ready && builder.config && builder.provisioned && <CreditAccountNotice account={builder.creditAccount} loading={builder.creditAccountLoading} error={builder.creditAccountError}
        demo={builder.config.mock} provisioned={builder.provisioned} needsKeyRecovery={builder.needsKeyRecovery}
        disabled={builder.busy || builder.recoveringKey} onRefresh={builder.refreshCreditAccount} />}
      <p className="build-status" aria-live="polite">{builder.stage}</p>
      {builder.error && <p className="error-message" role="alert">{builder.error}</p>}
      <BuildTranscript messages={builder.messages} busy={builder.busy} />
      <PreviewPanel url={builder.status?.app?.preview_url} publishedUrl={builder.publishedUrl} busy={builder.busy} demo={Boolean(builder.config?.mock)} />
      <div className="deploy-panel">
        <strong>{builder.deployState === "queued" ? "Deployment requested" : builder.deployState === "demo" ? "Demo deploy complete" : "Ready for the next step?"}</strong>
        <p>{builder.deployState === "queued" ? "Publication has not been verified." : builder.config?.mock ? "Explore a local deploy handoff. Nothing is published online." : "Request deployment through Overskill."}</p>
        <button className="button secondary" onClick={builder.deploy} disabled={builder.status?.status !== "completed" || builder.busy || builder.deploying || builder.deployState !== "idle"}>
          {builder.deploying ? "Requesting…" : builder.config?.mock ? "Demo deploy" : "Request deploy"}
        </button>
      </div>
      {builder.ready && !builder.config?.mock && <button className="text-link" onClick={builder.lock}>Lock local pilot</button>}
    </section>
  );
}
