"use client";
import type { CreditAccountSnapshot, CreditMetric } from "@/lib/credit-account";

export interface CreditAccountNoticeProps {
  account: CreditAccountSnapshot | null;
  loading: boolean;
  error: string;
  demo: boolean;
  provisioned: boolean;
  needsKeyRecovery?: boolean;
  disabled?: boolean;
  onRefresh: () => void;
}

/** Presentation only: this component never selects a payer or changes billing settings. */
export function CreditAccountNotice({ account, loading, error, demo, provisioned, needsKeyRecovery, disabled, onRefresh }: CreditAccountNoticeProps) {
  const balance = account?.balance;
  const meter = account?.meter;
  const readable = provisioned && !needsKeyRecovery && !error && !loading;
  const credits = (value: CreditMetric) => value.status === "known" && value.value !== null ? `${value.value.toLocaleString()} credits` : "Unknown";
  const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const setting = (value: boolean | null) => value === null ? "Not reported" : value ? "Enabled" : "Disabled";
  return (
    <aside className="deploy-panel credit-account-notice" aria-label="Creator workspace credits" style={{ marginBottom: 22 }}>
      <strong>{demo ? "Simulated creator credits" : "Creator workspace credits"}</strong>
      <p>
        {demo
          ? "This demo uses no real credits. Its example balance does not fund live builds."
          : "Builds use this creator workspace’s Overskill credits. Existing workspace billing settings apply."}
      </p>
      <div aria-live="polite" aria-busy={loading}>
        <p>
          {loading ? "Reading usage and credits…"
            : needsKeyRecovery ? "Recover creator access to read this workspace’s credits."
            : !provisioned ? "Usage and credits appear after creator workspace setup."
            : error || (meter
              ? `Workspace ${account?.creditAccount.teamId} · ${meter.status === "ready" ? "Reported snapshot" : meter.status === "partial" ? "Partial snapshot" : "Usage unavailable · Builds paused"}`
              : balance?.credits !== null && balance?.credits !== undefined
                ? `${balance.status === "simulated" ? "Example" : "Partial legacy"} balance: ${balance.credits.toLocaleString()} credits · Workspace ${account?.creditAccount.teamId}`
                : "Usage and balance unavailable. Builds are paused until a successful refresh. Unknown does not mean zero.")}
        </p>
        {readable && meter && (
          <>
            <p><strong>Recorded gross generation usage: {credits(meter.metrics.gross_recorded_generation_debits)}</strong><br />
              <time dateTime={meter.window.from}>{date(meter.window.from)}</time> – <time dateTime={meter.window.through}>{date(meter.window.through)}</time> (UTC)
            </p>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div><dt>Spendable balance</dt><dd style={{ margin: 0 }}>{credits(meter.metrics.spendable)}</dd></div>
              <div><dt>Pending holds</dt><dd style={{ margin: 0 }}>{credits(meter.metrics.reservations)}</dd></div>
              <div><dt>Available after holds</dt><dd style={{ margin: 0 }}>{credits(meter.metrics.available_for_admission)}</dd></div>
            </dl>
          </>
        )}
      </div>
      {!demo && (
        <details style={{ fontSize: 11, lineHeight: 1.7, marginBottom: 12 }}>
          <summary>Sources and limits of this snapshot</summary>
          {readable && meter ? (
            <>
              <p>Gross usage counts recorded generation debits within this window. Refunds and net charges are not reported. Trial credits need app context. These values are read during one request, not an atomic ledger snapshot.</p>
              <p>Cached Whop balance: {credits(meter.whop.cached_balance)}. Pending sync deductions: {credits(meter.whop.pending_sync)}. These are separate observations; they are not added to or subtracted from the balance above. Cached values may lag and are not an authoritative provider balance.</p>
              <p>Automatic top-ups: {setting(meter.auto_billing.topup_enabled)}. Tier upgrades: {setting(meter.auto_billing.tier_upgrade_enabled)}. Overages: {setting(meter.auto_billing.overage_enabled)}.</p>
              {meter.whop.last_synced_at && <p>Whop cache last synced: <time dateTime={meter.whop.last_synced_at}>{meter.whop.last_synced_at}</time>.</p>}
            </>
          ) : account?.telemetry === "partial_legacy" ? (
            <p>The legacy balance is partial: it excludes pending holds and does not report generation usage, Whop balances or auto-billing settings. Unavailable information stays unknown.</p>
          ) : (
            <p>The credit service has not reported a usable snapshot. Builds are paused until a successful refresh. Usage, balances and billing settings remain unknown until a successful read.</p>
          )}
          <p>This is not a price quote, spending cap or guarantee a build will be admitted. A separate Whop wallet per workspace has not been verified. Partner sponsorship is not supported by this starter.</p>
          {readable && balance?.observedAt && <p>Observed: <time dateTime={balance.observedAt}>{balance.observedAt}</time>.</p>}
        </details>
      )}
      {provisioned && !needsKeyRecovery && (
        <button type="button" className="text-link" onClick={onRefresh} disabled={disabled || loading}>
          {loading ? "Reading credits…" : "Refresh usage and credits"}
        </button>
      )}
    </aside>
  );
}

export function CreatorAccessRecovery({ recovering, onRecover }: { recovering: boolean; onRecover: () => void }) {
  return (
    <div className="unlock-form" role="status">
      <h2>Restore this creator workspace</h2>
      <p>
        This workspace already exists, but its builder key is unavailable in this session.
        Recovering access replaces the previous builder key. Other sessions using that key will need to reconnect.
        Your prompt will remain here for you to submit afterward.
      </p>
      <button type="button" className="button primary" onClick={onRecover} disabled={recovering}>
        {recovering ? "Recovering creator access…" : "Recover creator access"}
      </button>
    </div>
  );
}
