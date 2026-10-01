// Server-only adapter: keep partner credentials and generation orchestration in OverSkill.
// Live calls require an explicitly enabled local operator session.

import * as mock from "./mock-engine";
import { isDemoMode, requireLiveConfiguration, requireExternalCreatorId, PilotError, type PilotSession } from "./pilot-security";
import type {
  OverskillResult,
  ProvisionResponse,
  GenerateResponse,
  StatusResponse,
  DeployResponse,
  AppSummary,
  WhiteLabel,
  MessagesResponse,
} from "./types";

export const config = {
  apiBase: (process.env.OVERSKILL_API_BASE || "http://localhost:3000").replace(/\/+$/, ""),
  apiKey: process.env.OVERSKILL_PARTNER_API_KEY || "",
  partnerSlug: process.env.OVERSKILL_PARTNER_SLUG || "open-overskill",
  mockSetting: (process.env.OVERSKILL_MOCK || "1").toLowerCase(),
  // Origins the partner editor embeds the OverSkill preview from. Sent as
  // partner_frame_ancestors so the generated app's CSP allows the iframe.
  // https-only (FrameAncestorsPolicy rejects http/localhost).
  embedOrigins: (process.env.OVERSKILL_PARTNER_EMBED_ORIGINS || "")
    .split(/[\s,]+/)
    .filter(Boolean),
};

export function isMock(): boolean {
  return isDemoMode();
}

export function configInfo() {
  return {
    apiBase: safeApiOrigin(),
    partnerSlug: config.partnerSlug,
    hasKey: Boolean(config.apiKey),
    mock: isMock(),
    mockSetting: config.mockSetting,
    localPilot: true,
    callbacksEnabled: false,
    sessionRequired: !isMock(),
  };
}

function safeApiOrigin() {
  try { return new URL(config.apiBase).origin; }
  catch { return "Invalid API origin"; }
}

// ---- real HTTP client ------------------------------------------------------

function creatorKey(session: PilotSession): string {
  if (!session.creatorKey) throw new PilotError(409, "creator_required", "Provision a creator before making creator API calls.");
  return session.creatorKey;
}

async function real<T>(
  path: string,
  { method = "GET", body, key, idempotencyKey }: { method?: string; body?: unknown; key?: string; idempotencyKey?: string } = {},
): Promise<OverskillResult<T>> {
  requireLiveConfiguration();
  if (!key) throw new PilotError(503, "credential_required", "A scoped API credential is required.");
  let res: Response;
  try {
    res = await fetch(`${config.apiBase}${path}`, {
      method,
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      json: {
        error: "Could not reach OverSkill",
        hint: "Check the configured API connection. The pilot did not switch to demo mode.",
      } as T,
    };
  }

  const text = await res.text();
  let json: T;
  try {
    json = (text ? JSON.parse(text) : {}) as T;
  } catch {
    return { ok: false, status: 502, json: { error: "Non-JSON response from OverSkill" } as T };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, status: 502, json: { error: "Invalid response from OverSkill" } as T };
  return { ok: res.ok, status: res.status, json };
}

// ---- public surface --------------------------------------------------------

export async function provisionCreator(input: {
  name: string;
  userEmail?: string;
  apiKeyScope?: string;
  /** Server-derived verified customer identity; never copy this from request input. */
  externalCreatorId?: string;
}): Promise<OverskillResult<ProvisionResponse>> {
  if (isMock()) {
    return { ok: true, status: 201, mocked: true, json: mock.provision(input.name, input.userEmail) };
  }
  const externalCreatorId = input.externalCreatorId === undefined ? requireExternalCreatorId() : requireExternalCreatorId({ OVERSKILL_CREATOR_ID: input.externalCreatorId });
  // Older servers silently ignore unknown POST fields. Verify support with a
  // read before any creation so an undeployed contract cannot make duplicates.
  const capability = await real<{ creator_identity?: { version?: number; key_recovery?: string; onboarding_profile?: string } }>("/api/v1/partner/creators/capabilities", { key: config.apiKey });
  if (!capability.ok || capability.json.creator_identity?.version !== 1 || capability.json.creator_identity.key_recovery !== "compare_and_swap") {
    throw new PilotError(503, "creator_identity_unavailable", "This API has not confirmed stable creator provisioning support. No workspace creation was requested. Check the backend rollout and partner access.");
  }
  if (capability.json.creator_identity.onboarding_profile !== "api_creator_paid_v1") {
    throw new PilotError(503, "creator_onboarding_unavailable", "Workspace setup is not available for this operator yet. No workspace was created. Ask the operator to finish connecting its API onboarding profile.");
  }
  return real<ProvisionResponse>("/api/v1/partner/teams", {
    key: config.apiKey,
    method: "POST",
    body: {
      name: input.name,
      user_email: input.userEmail,
      external_creator_id: externalCreatorId,
      // An assertion, never a policy selector. Core must compare this with the
      // authenticated partner's current profile under its provisioning lock.
      expected_onboarding_profile: "api_creator_paid_v1",
      // The hosted API binds this stable partner-owned ID to one creator team.
      provision_user: true,
      generate_api_key: true,
      // Creator (child) keys are read_write, never full_access — enough for the
      // flow (generation:queue + apps:write for deploy) without delete/admin
      // perms. OverSkill caps this to [read_only, read_write] anyway (#5190).
      api_key_scope: input.apiKeyScope || "read_write",
    },
  });
}

export async function recoverCreatorKey(session: PilotSession): Promise<OverskillResult<ProvisionResponse>> {
  if (!session.creatorBinding || session.creatorKey || isMock()) throw new PilotError(409, "recovery_not_required", "There is no lost creator credential to recover in this session.");
  const binding = session.creatorBinding;
  return real<ProvisionResponse>(`/api/v1/partner/creators/${binding.id}/recover_api_key`, {
    key: config.apiKey, method: "POST", body: { expected_key_id: binding.keyId },
  });
}

export async function getUsage(session: PilotSession): Promise<OverskillResult<unknown>> {
  if (isMock()) {
    const team = session.provisioned?.team as { id?: unknown } | undefined;
    return { ok: true, status: 200, mocked: true, json: { team_id: team?.id, credits: { balance: 500 } } };
  }
  return real<unknown>("/api/v1/usage", { key: creatorKey(session) });
}

/** Draft read-only meter. Never use the partner credential or retry automatically. */
export async function getCreatorUsage(session: PilotSession): Promise<OverskillResult<unknown>> {
  const key = creatorKey(session);
  // The simulator has no recorded ledger; exercise the labeled legacy fallback.
  if (isMock()) return { ok: false, status: 404, mocked: true, json: {} };
  return real<unknown>("/api/v1/creator_usage?period=30d", { key });
}

export async function generate(session: PilotSession, input: {
  prompt: string;
  appId?: string;
  name?: string;
  partnerContext?: string;
  attribution?: WhiteLabel;
  thinkingEffort?: string;
}): Promise<OverskillResult<GenerateResponse>> {
  if (isMock()) {
    return {
      ok: true,
      status: 202,
      mocked: true,
      json: mock.generate({
        prompt: input.prompt,
        appId: input.appId,
        name: input.name,
        partnerContext: input.partnerContext,
        attribution: input.attribution,
      }),
    };
  }
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    name: input.name,
    // gap (a): the creator's whole context, so the app is built for THEM.
    partner_context: input.partnerContext,
    // gap (d): white-label the built app.
    partner_attribution: input.attribution,
    // white-label embed (#5189): let the partner surface iframe the preview.
    partner_frame_ancestors: config.embedOrigins,
    // Polling only until a verified, replay-safe webhook contract is provided.
    thinking_effort: input.thinkingEffort,
    // Partner attribution remains visible to the hosted service.
    metadata: { partner: input.attribution?.partner || config.partnerSlug },
  };
  if (input.appId) body.app_id = input.appId;
  return real<GenerateResponse>("/api/v1/generation_queue", { method: "POST", body, key: creatorKey(session) });
}

export async function getStatus(session: PilotSession, id: string): Promise<OverskillResult<StatusResponse>> {
  if (isMock()) {
    const s = mock.status(id);
    if (!s) return { ok: false, status: 404, mocked: true, json: { error: "Unknown job id" } as unknown as StatusResponse };
    return { ok: true, status: 200, mocked: true, json: s };
  }
  return real<StatusResponse>(`/api/v1/generation_queue/${encodeURIComponent(id)}`, { key: creatorKey(session) });
}

export async function getApp(session: PilotSession, appId: string): Promise<OverskillResult<AppSummary>> {
  if (isMock()) {
    const a = mock.getApp(appId);
    if (!a) return { ok: false, status: 404, mocked: true, json: { error: "Unknown app" } as unknown as AppSummary };
    return { ok: true, status: 200, mocked: true, json: a };
  }
  const result = await real<{ app: AppSummary }>(`/api/v1/managed_apps/${encodeURIComponent(appId)}?detailed=true`, { key: creatorKey(session) });
  return { ...result, json: result.json.app };
}

export interface AppDeploymentStatus {
  app_id: string;
  capabilities?: { deployment_tracking?: string };
  deployment: { id: number; attempt_id?: number | null; environment: string; status: string; deployed_at: string | null } | null;
  urls: { preview?: string | null; production?: string | null; editor?: string | null };
}
export async function getDeploymentStatus(session: PilotSession, appId: string, deploymentId?: number): Promise<OverskillResult<AppDeploymentStatus>> {
  const query = deploymentId === undefined ? "" : `?deployment_id=${encodeURIComponent(deploymentId)}`;
  return real(`/api/v1/managed_apps/${encodeURIComponent(appId)}/status${query}`, { key: creatorKey(session) });
}

/** Only call after the creator-scoped status advertises request-v1 tracking. */
export async function deployTracked(session: PilotSession, appId: string): Promise<OverskillResult<DeployResponse & { tracking?: string }>> {
  return real(`/api/v1/managed_apps/${encodeURIComponent(appId)}/deploy`, {
    method: "POST", key: creatorKey(session), body: { track_deployment: true },
  });
}

/** The current creator's catalog. Purchase creation is a separate guarded contract. */
export async function getCreditPacks(session: PilotSession): Promise<OverskillResult<{ packs: Array<Record<string, unknown>> }>> {
  if (isMock()) return { ok: true, status: 200, mocked: true, json: { packs: [] } };
  return real("/api/v1/credit_packs", { key: creatorKey(session) });
}

export interface CreatorPackCapability { available: boolean; version: string; packs: Array<Record<string, unknown>> }
export async function getCreatorPackCapability(session: PilotSession): Promise<OverskillResult<CreatorPackCapability>> {
  return real("/api/v1/creator_credit_pack_checkouts/capabilities", { key: creatorKey(session) });
}
export async function createCreatorPackPurchase(session: PilotSession, packId: string, idempotencyKey: string): Promise<OverskillResult<{ purchase: unknown }>> {
  return real("/api/v1/creator_credit_pack_checkouts", { method: "POST", key: creatorKey(session), idempotencyKey, body: { pack_id: packId } });
}
export async function getCreatorPackPurchase(session: PilotSession, id: string, byKey = false): Promise<OverskillResult<{ purchase: unknown }>> {
  return real(`/api/v1/creator_credit_pack_checkouts/${byKey ? "by_key/" : ""}${encodeURIComponent(id)}`, { key: creatorKey(session) });
}

export async function deploy(session: PilotSession, appId: string): Promise<OverskillResult<DeployResponse>> {
  if (isMock()) {
    const d = mock.deploy(appId);
    const ok = !("error" in d);
    return { ok, status: ok ? 202 : 422, mocked: true, json: d as DeployResponse };
  }
  return real<DeployResponse>(`/api/v1/managed_apps/${encodeURIComponent(appId)}/deploy`, { method: "POST", key: creatorKey(session) });
}

// The generation chat transcript (assistant commentary + tool timeline) so the
// partner editor can render the build conversation.
export async function getMessages(session: PilotSession, id: string): Promise<OverskillResult<MessagesResponse>> {
  if (isMock()) {
    const m = mock.messages(id);
    if (!m) return { ok: false, status: 404, mocked: true, json: { error: "Unknown job id" } as unknown as MessagesResponse };
    return { ok: true, status: 200, mocked: true, json: m };
  }
  return real<MessagesResponse>(`/api/v1/generation_queue/${encodeURIComponent(id)}/messages`, { key: creatorKey(session) });
}

// Cheap auth probe: hit a read endpoint to confirm the partner key works.
export async function checkAuth(): Promise<OverskillResult<{ authenticated: boolean; apps?: unknown }>> {
  if (isMock()) {
    return { ok: true, status: 200, mocked: true, json: { authenticated: true } };
  }
  const res = await real<{ apps?: unknown }>("/api/v1/managed_apps?per_page=1", { key: config.apiKey });
  return { ...res, json: { authenticated: res.ok, apps: undefined } };
}
