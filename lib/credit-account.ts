export type CreditMetricSource =
  | "credit_transaction_and_token_ledger_entry"
  | "team_credit_balance_excluding_expired_sources"
  | "credit_transaction_pending_reservations"
  | "team_spendable_minus_pending_reservations"
  | "token_balance_cache"
  | "token_balance_pending_deductions";

export type CreditMetric = {
  status: "known" | "unknown";
  value: number | null;
  unit: "credits";
  source: CreditMetricSource;
  reason?: "missing_record" | "read_failed" | "invalid_value" | "dependency_unavailable";
};

export interface CreatorUsageMeter {
  schema_version: 1;
  team_id: number;
  status: "ready" | "partial" | "unavailable";
  period: "1d" | "7d" | "30d";
  window: { from: string; through: string };
  observed_at: string;
  snapshot_consistency: "request_local_non_atomic";
  metrics: {
    gross_recorded_generation_debits: CreditMetric;
    spendable: CreditMetric;
    reservations: CreditMetric;
    available_for_admission: CreditMetric;
  };
  whop: {
    cached_balance: CreditMetric;
    pending_sync: CreditMetric;
    last_synced_at: string | null;
    provider_authoritative: false;
    wallet_isolation: "unverified";
  };
  auto_billing: {
    status: "reported" | "not_reported";
    topup_enabled: boolean | null;
    tier_upgrade_enabled: boolean | null;
    overage_enabled: boolean | null;
  };
  trial: { status: "requires_app_context" };
  refunds: { status: "not_reported" };
  net_charge: { status: "not_reported" };
  spending_cap: null;
}

/** Read-only telemetry. Neither a funding guarantee nor a spending cap. */
export interface CreditAccountSnapshot {
  creditAccount: {
    type: "creator_workspace";
    teamId: number;
    partnerSponsorshipSupported: false;
  };
  balance: {
    status: "reported" | "simulated" | "unavailable";
    credits: number | null;
    source: "overskill_usage_team_credit_balance" | "creator_usage_v1_spendable" | "simulated" | null;
    includesPendingReservations: false;
    providerAuthoritative: false;
    observedAt: string | null;
  };
  autoBilling: CreatorUsageMeter["auto_billing"] | { status: "not_reported" };
  whop: { provisioning: "not_reported"; providerWalletIsolation: "unverified" };
  spendingCap: null;
  telemetry: "creator_usage_v1" | "partial_legacy" | "simulated" | "unavailable";
  meter: CreatorUsageMeter | null;
}

export class CreditAccountError extends Error {
  constructor(public code: "creator_team_unknown" | "invalid_credit_usage" | "credit_account_mismatch", message: string) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Use only the team stored by the authenticated server session, never a browser-supplied payer. */
export function creatorCreditTeamId(provisioned: unknown): number {
  const id = record(record(provisioned)?.team)?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new CreditAccountError("creator_team_unknown", "The creator workspace could not be verified.");
  }
  return id;
}

export function unavailableCreditAccount(teamId: number): CreditAccountSnapshot {
  // Validate callers even when there is no upstream response to compare.
  creatorCreditTeamId({ team: { id: teamId } });
  return {
    creditAccount: { type: "creator_workspace", teamId, partnerSponsorshipSupported: false },
    balance: { status: "unavailable", credits: null, source: null, includesPendingReservations: false, providerAuthoritative: false, observedAt: null },
    autoBilling: { status: "not_reported" },
    whop: { provisioning: "not_reported", providerWalletIsolation: "unverified" },
    spendingCap: null,
    telemetry: "unavailable",
    meter: null,
  };
}

/** Allowlist the response; never forward key metadata, historical totals or provider error text. */
export function normalizeCreditAccountUsage(usage: unknown, teamId: number, { simulated = false, observedAt = new Date().toISOString() }: { simulated?: boolean; observedAt?: string } = {}): CreditAccountSnapshot {
  const snapshot = unavailableCreditAccount(teamId);
  const response = record(usage);
  if (!response || typeof response.team_id !== "number" || !Number.isSafeInteger(response.team_id)) {
    throw new CreditAccountError("invalid_credit_usage", "Overskill did not report a verifiable credit account.");
  }
  if (response.team_id !== teamId) {
    throw new CreditAccountError("credit_account_mismatch", "The reported credit account does not match this creator workspace.");
  }
  const credits = record(response.credits)?.balance;
  if (typeof credits !== "number" || !Number.isFinite(credits) || Math.abs(credits) > Number.MAX_SAFE_INTEGER) return snapshot;
  return {
    ...snapshot,
    telemetry: simulated ? "simulated" : "partial_legacy",
    balance: {
      ...snapshot.balance,
      status: simulated ? "simulated" : "reported",
      credits,
      source: simulated ? "simulated" : "overskill_usage_team_credit_balance",
      observedAt,
    },
  };
}

function invalidMeter(): never {
  throw new CreditAccountError("invalid_credit_usage", "Overskill did not report a valid creator usage snapshot.");
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalidMeter();
  return value;
}

const reasons = ["missing_record", "read_failed", "invalid_value", "dependency_unavailable"] as const;

function metric(value: unknown, expectedSource: CreditMetricSource, nonnegative = false): CreditMetric {
  const input = record(value);
  if (!input || input.unit !== "credits" || input.source !== expectedSource) invalidMeter();
  if (input.status === "known") {
    if (typeof input.value !== "number" || !Number.isFinite(input.value) || Math.abs(input.value) > Number.MAX_SAFE_INTEGER || (nonnegative && input.value < 0) || input.reason !== undefined) invalidMeter();
    return { status: "known", value: input.value, unit: "credits", source: expectedSource };
  }
  if (input.status !== "unknown" || input.value !== null || (input.reason !== undefined && !reasons.includes(input.reason as typeof reasons[number]))) invalidMeter();
  return { status: "unknown", value: null, unit: "credits", source: expectedSource, ...(input.reason === undefined ? {} : { reason: input.reason as typeof reasons[number] }) };
}

/** Validate the versioned contract and explicitly copy public fields only. */
export function normalizeCreatorUsage(usage: unknown, teamId: number, { simulated = false }: { simulated?: boolean } = {}): CreditAccountSnapshot {
  const snapshot = unavailableCreditAccount(teamId);
  const input = record(usage);
  if (!input || input.schema_version !== 1 || typeof input.team_id !== "number" || !Number.isSafeInteger(input.team_id) || input.team_id <= 0) invalidMeter();
  if (input.team_id !== teamId) throw new CreditAccountError("credit_account_mismatch", "The reported credit account does not match this creator workspace.");
  if (!["1d", "7d", "30d"].includes(input.period as string) || input.snapshot_consistency !== "request_local_non_atomic") invalidMeter();
  const window = record(input.window);
  const from = timestamp(window?.from), through = timestamp(window?.through), observedAt = timestamp(input.observed_at);
  const duration = Number((input.period as string).slice(0, -1)) * 24 * 60 * 60 * 1000;
  if (Date.parse(through) - Date.parse(from) !== duration || Date.parse(through) !== Date.parse(observedAt)) invalidMeter();
  const metrics = record(input.metrics), whop = record(input.whop), auto = record(input.auto_billing);
  if (!metrics || !whop || !auto || whop.provider_authoritative !== false || whop.wallet_isolation !== "unverified" || input.spending_cap !== null || record(input.trial)?.status !== "requires_app_context" || record(input.refunds)?.status !== "not_reported" || record(input.net_charge)?.status !== "not_reported") invalidMeter();
  if (auto.status !== "reported" && auto.status !== "not_reported") invalidMeter();
  for (const field of ["topup_enabled", "tier_upgrade_enabled", "overage_enabled"]) {
    if (auto[field] !== null && typeof auto[field] !== "boolean") invalidMeter();
    if (auto.status === "not_reported" && auto[field] !== null) invalidMeter();
    if (auto.status === "reported" && typeof auto[field] !== "boolean") invalidMeter();
  }
  const normalizedMetrics = {
    gross_recorded_generation_debits: metric(metrics.gross_recorded_generation_debits, "credit_transaction_and_token_ledger_entry", true),
    spendable: metric(metrics.spendable, "team_credit_balance_excluding_expired_sources"),
    reservations: metric(metrics.reservations, "credit_transaction_pending_reservations", true),
    available_for_admission: metric(metrics.available_for_admission, "team_spendable_minus_pending_reservations"),
  };
  const normalizedWhop: CreatorUsageMeter["whop"] = {
    cached_balance: metric(whop.cached_balance, "token_balance_cache"),
    pending_sync: metric(whop.pending_sync, "token_balance_pending_deductions", true),
    last_synced_at: whop.last_synced_at === null ? null : timestamp(whop.last_synced_at),
    provider_authoritative: false, wallet_isolation: "unverified",
  };
  const { spendable, reservations, available_for_admission: available } = normalizedMetrics;
  if (available.status === "known") {
    if (spendable.value === null || reservations.value === null || available.value === null) invalidMeter();
    const expected = spendable.value - reservations.value;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(expected), Math.abs(spendable.value), Math.abs(reservations.value)) * 4;
    if (Math.abs(available.value - expected) > tolerance) invalidMeter();
  }
  const known = [...Object.values(normalizedMetrics), normalizedWhop.cached_balance, normalizedWhop.pending_sync].filter(item => item.status === "known").length;
  const status = known === 6 ? "ready" : known === 0 ? "unavailable" : "partial";
  if (input.status !== status) invalidMeter();
  const meter: CreatorUsageMeter = {
    schema_version: 1, team_id: teamId, status, period: input.period as CreatorUsageMeter["period"],
    window: { from, through }, observed_at: observedAt, snapshot_consistency: "request_local_non_atomic",
    metrics: normalizedMetrics, whop: normalizedWhop,
    auto_billing: { status: auto.status, topup_enabled: auto.topup_enabled as boolean | null, tier_upgrade_enabled: auto.tier_upgrade_enabled as boolean | null, overage_enabled: auto.overage_enabled as boolean | null },
    trial: { status: "requires_app_context" }, refunds: { status: "not_reported" }, net_charge: { status: "not_reported" }, spending_cap: null,
  };
  return {
    ...snapshot, telemetry: simulated ? "simulated" : "creator_usage_v1", meter, autoBilling: meter.auto_billing,
    balance: { ...snapshot.balance, status: normalizedMetrics.spendable.status === "known" ? (simulated ? "simulated" : "reported") : "unavailable", credits: normalizedMetrics.spendable.value, source: normalizedMetrics.spendable.status === "known" ? (simulated ? "simulated" : "creator_usage_v1_spendable") : null, observedAt },
  };
}

/** Availability only: Overskill still enforces funding and the approved pilot cap. */
export function hasUsableCreditSnapshot(snapshot: CreditAccountSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.meter) return snapshot.meter.status === "ready" || snapshot.meter.status === "partial";
  return ["partial_legacy", "simulated"].includes(snapshot.telemetry) &&
    typeof snapshot.balance?.credits === "number" && Number.isFinite(snapshot.balance.credits);
}

export type WorkspaceFundingState = "unknown" | "empty" | "reserved" | "ready";

/** Customer onboarding/preflight only. Core still authorizes every real spend. */
export function workspaceFundingState(snapshot: CreditAccountSnapshot | null): WorkspaceFundingState {
  if (!snapshot) return "unknown";
  const balance = snapshot.balance;
  if (!balance || balance.status === "unavailable" || typeof balance.credits !== "number" || !Number.isFinite(balance.credits)) return "unknown";
  if (balance.credits <= 0) return "empty";
  if (snapshot.meter) {
    const available = snapshot.meter.metrics.available_for_admission;
    if (available.status !== "known" || typeof available.value !== "number" || !Number.isFinite(available.value)) return "unknown";
    return available.value > 0 ? "ready" : "reserved";
  }
  return ["partial_legacy", "simulated"].includes(snapshot.telemetry) ? "ready" : "unknown";
}

type CreditUsageRead = () => Promise<{ ok: boolean; status: number; json: unknown }>;

/** Shared read path for presentation and the server's generation preflight. */
export async function readCreditAccountSnapshot(teamId: number, readMeter: CreditUsageRead, readLegacy: CreditUsageRead, { simulated = false }: { simulated?: boolean } = {}): Promise<CreditAccountSnapshot> {
  const usage = await readMeter();
  const unavailable = unavailableCreditAccount(teamId);
  if (usage.status === 404) {
    const legacy = await readLegacy();
    return legacy.ok ? normalizeCreditAccountUsage(legacy.json, teamId, { simulated }) : unavailable;
  }
  if (usage.ok || usage.status === 503) {
    if (usage.status === 503 && (!record(usage.json) || !("schema_version" in record(usage.json)!))) return unavailable;
    const snapshot = normalizeCreatorUsage(usage.json, teamId, { simulated });
    return usage.status === 503 && snapshot.meter?.status !== "unavailable" ? unavailable : snapshot;
  }
  return unavailable;
}
