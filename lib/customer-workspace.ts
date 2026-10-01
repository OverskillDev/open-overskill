import { randomUUID } from "node:crypto";
import { requireCustomer, publicCustomer } from "./customer-auth";
import { getCustomerStore, type CustomerRecord, type CustomerApp } from "./customer-store";
import { acceptCreatorProvision } from "./creator-provisioning";
import { builderConfig } from "./builder-config";
import { creatorCreditTeamId, hasUsableCreditSnapshot, normalizeCreditAccountUsage, readCreditAccountSnapshot } from "./credit-account";
import { PilotError, inputString, redactSecrets, requireLiveConfiguration, type PilotSession } from "./pilot-security";
import { deployTracked, generate, getCreatorPackCapability, getCreatorUsage, getDeploymentStatus, getMessages, getStatus, getUsage, provisionCreator } from "./overskill";
import type { AppSummary, ChatMessage, StatusResponse } from "./types";

const now = () => new Date().toISOString();
const MAX_APPS = 100;
const text = (value: unknown, max = 20_000) => typeof value === "string" ? value.slice(0, max) : null;
const states = new Set(["queued", "processing", "completed", "failed", "cancelled"]);
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^\/[^/\\]/.test(value) && !value.includes("\\")) return value;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

function appSummary(value: AppSummary | null): AppSummary | null {
  if (!value || typeof value.id !== "string") return null;
  return { id: value.id, name: text(value.name, 200) || "Your app", status: text(value.status, 60) || "unknown",
    preview_url: safeUrl(value.preview_url), production_url: safeUrl(value.production_url),
    published_at: text(value.published_at, 60), updated_at: text(value.updated_at, 60) || undefined };
}

function checkedStatus(value: StatusResponse, appId: string, jobId: string): StatusResponse {
  if (value?.app_id !== appId || value.job_id !== jobId || !states.has(value?.status) || (value.app && value.app.id !== appId)) {
    throw new PilotError(502, "workspace_response_mismatch", "The service returned an unexpected app. Refresh to check its state.");
  }
  return { job_id: text(value.job_id, 160), app_id: appId, status: value.status,
    progress: typeof value.progress === "number" && Number.isFinite(value.progress) ? Math.max(0, Math.min(100, value.progress)) : 0,
    message: text(value.message), app: appSummary(value.app), started_at: text(value.started_at, 60), completed_at: text(value.completed_at, 60) };
}

function checkedMessages(messages: ChatMessage[], secrets: string[]): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-100).filter(m => m && Number.isSafeInteger(m.id)).map(m => ({
    id: m.id, role: text(m.role, 40) || "assistant", status: text(m.status, 60), thinking_status: text(m.thinking_status, 60),
    content: redactSecrets(text(m.content, 60_000) || "", secrets) as string,
    flow: [], created_at: text(m.created_at, 60), updated_at: text(m.updated_at, 60),
  }));
}

export function publicWorkspaceApp(app: CustomerApp) {
  const payload = { id: app.id, name: app.name, prompt: app.prompt, jobId: app.jobId,
    status: app.status, messages: app.messages, publishedUrl: app.publishedUrl, deployState: app.deployState,
    createdAt: app.createdAt, updatedAt: app.updatedAt, simulated: app.simulated,
    submissionState: app.submissionState || "confirmed",
    ...(app.submissionState === "unknown" || app.submissionState === "pending" ? { attention: "The last submission is unconfirmed. It may have reached Overskill. Reconcile it before starting another build." } : {}),
    ...(app.deployState === "queued" && !app.deploymentId && !app.simulated ? { attention: "The publication request is unconfirmed. It may have reached Overskill. No automatic retry will be made." } : {}),
  };
  return redactSecrets(payload, [process.env.OVERSKILL_PARTNER_API_KEY || "", getCustomerStore().getCreator(app.userId).key || ""]) as typeof payload;
}

export function workspaceSession(user: CustomerRecord): PilotSession {
  const db = getCustomerStore();
  const creator = db.getCreator(user.id);
  if (creator.state !== "ready" || !creator.key || !creator.provisioned) {
    throw new PilotError(409, "workspace_required", creator.state === "unprovisioned"
      ? "Set up your workspace first." : "Workspace setup needs reconciliation before it can continue.");
  }
  const apps = db.listApps(user.id);
  return { id: user.id, expiresAt: Number.MAX_SAFE_INTEGER, mode: user.mode, tokenHash: "",
    creatorKey: creator.key, creatorBinding: creator.binding, provisioned: creator.provisioned,
    apps: new Set(apps.map(a => a.appId).filter(Boolean)), jobs: new Set(apps.map(a => a.jobId).filter((id): id is string => !!id)) };
}

export function workspaceHome(user: CustomerRecord) {
  const db = getCustomerStore();
  return { user: publicCustomer(user), mode: user.mode, provisioned: db.getCreator(user.id).state === "ready",
    apps: db.listApps(user.id).map(publicWorkspaceApp) };
}

/** User IDs and email come only from the authenticated server identity. */
export async function provisionWorkspace(req: Request, user: CustomerRecord) {
  const db = getCustomerStore();
  const previous = db.getCreator(user.id);
  if (previous.state === "ready") return { provisioned: true, simulated: user.mode === "demo" };
  if (user.mode === "live" && (!user.emailVerified || !user.email)) throw new PilotError(403, "verified_identity_required", "Verify your email with the sign-in provider before setting up a workspace.");
  if (!db.claimProvisioning(user.id)) throw new PilotError(409, "provisioning_pending", "Workspace setup is pending reconciliation. No duplicate workspace was requested.");
  try {
    if (user.mode === "demo") {
      const teamId = Number.parseInt(user.id.replaceAll("-", "").slice(0, 10), 16) || 1;
      db.saveCreator(user.id, { key: `demo-only-${user.id}`, provisioned: { team: { id: teamId, name: `${user.name}'s workspace` }, mocked: true } });
    } else {
      const result = await provisionCreator({ name: `${user.name}'s workspace`.slice(0, 92), userEmail: user.email, externalCreatorId: user.externalCreatorId });
      // A response is persisted for this immutable identity even if the browser logs out while waiting.
      if (!result.ok) {
        db.markCreatorState(user.id, result.status >= 500 ? "recovery_required" : "failed");
        throw new PilotError(result.status >= 500 ? 502 : result.status, "workspace_setup_failed", "Workspace setup was not confirmed. No automatic retry was made.");
      }
      const session: PilotSession = { id: user.id, expiresAt: 0, mode: "live", tokenHash: "", apps: new Set(), jobs: new Set() };
      acceptCreatorProvision(session, result.json, false, false, user.externalCreatorId);
      if (session.creatorKey) db.saveCreator(user.id, { key: session.creatorKey, binding: session.creatorBinding, provisioned: session.provisioned! });
      else {
        db.markCreatorState(user.id, "recovery_required");
        throw new PilotError(409, "workspace_key_recovery_required", "Your workspace exists, but its access key needs secure recovery.");
      }
    }
  } catch (error) {
    if (error instanceof PilotError && ["creator_identity_unavailable", "live_not_configured", "invalid_api_base", "creator_identity_not_configured", "credential_required"].includes(error.code)) {
      db.releaseProvisioning(user.id);
    } else if (db.getCreator(user.id).state === "provisioning") db.markCreatorState(user.id, "recovery_required");
    throw error;
  }
  if (requireCustomer(req).id !== user.id) throw new PilotError(401, "session_ended", "Sign in again to continue.");
  return { provisioned: true, simulated: user.mode === "demo" };
}

export async function workspaceCredits(user: CustomerRecord) {
  const session = workspaceSession(user);
  const teamId = creatorCreditTeamId(session.provisioned);
  if (user.mode === "demo") return normalizeCreditAccountUsage({ team_id: teamId, credits: { balance: 1000 } }, teamId, { simulated: true });
  return readCreditAccountSnapshot(teamId, () => getCreatorUsage(session), () => getUsage(session));
}

export async function workspacePacks(user: CustomerRecord) {
  const session = workspaceSession(user);
  if (user.mode === "demo") return { packs: [], checkoutAvailable: false, simulated: true,
    message: "This local demo makes no purchases. Live mode reads the existing Overskill catalog; checkout will open after the creator-bound purchase contract is connected." };
  const response = await getCreatorPackCapability(session);
  if (!response.ok || response.json.version !== "creator-credit-packs-v1" || response.json.available !== true || !Array.isArray(response.json.packs)) {
    return { packs: [], checkoutAvailable: false, simulated: false, message: "Purchasing is not enabled for this workspace yet. Your existing credits remain available for building." };
  }
  const packs = response.json.packs.flatMap(p => {
    const credits = p.total_credits ?? p.credits;
    const priceCents = p.discounted_price_cents ?? p.price_cents;
    if (typeof p.id !== "string" || typeof credits !== "number" || !Number.isFinite(credits) || credits < 0 || !Number.isSafeInteger(priceCents) || Number(priceCents) < 0) return [];
    return [{ id: p.id, name: text(p.display_name || p.name, 120) || p.id, credits, priceCents: Number(priceCents), currency: "USD", description: text(p.tagline, 500) || "" }];
  });
  const safePacks = redactSecrets(packs, [session.creatorKey || "", process.env.OVERSKILL_PARTNER_API_KEY || ""]) as typeof packs;
  return { packs: safePacks, checkoutAvailable: packs.length > 0, simulated: false, message: "Existing Overskill packs fund this creator workspace. Payment and credit confirmation come from Overskill." };
}

function ownedApp(user: CustomerRecord, id: string): CustomerApp {
  const app = getCustomerStore().getApp(user.id, id);
  if (!app) throw new PilotError(404, "app_not_found", "App not found in your workspace.");
  return app;
}

function demoStatus(app: CustomerApp): StatusResponse {
  const elapsed = Date.now() - Date.parse(app.status?.started_at || app.createdAt);
  const done = elapsed >= 6500;
  return { app_id: app.appId, job_id: app.jobId, status: done ? "completed" : "processing",
    progress: done ? 100 : Math.min(95, Math.max(8, elapsed / 65)), message: done ? "Demo preview ready" : "Preparing your sample preview",
    app: { id: app.appId, name: app.name, status: done ? "generated" : "generating", preview_url: done ? `/api/workspace/apps/${app.id}/preview` : null },
    started_at: app.status?.started_at || app.createdAt, completed_at: done ? new Date(Date.parse(app.status?.started_at || app.createdAt) + 6500).toISOString() : null };
}

export async function readWorkspaceApp(user: CustomerRecord, id: string) {
  const db = getCustomerStore();
  let app = ownedApp(user, id);
  const original = app;
  if (user.mode === "demo") {
    const status = demoStatus(app);
    app = { ...app, status, messages: [
      { id: 1, role: "user", content: app.prompt, status: "completed", thinking_status: null, flow: [], created_at: app.updatedAt, updated_at: app.updatedAt },
      { id: 2, role: "assistant", content: status.status === "completed" ? "Your sample preview is ready. This demonstration uses a fixed template. No AI generation or credits were used." : "Preparing a sample preview to demonstrate the build experience.", status: status.status, thinking_status: null, flow: [], created_at: app.updatedAt, updated_at: app.updatedAt },
    ] };
    if (!db.compareAndSwapApp(user.id, original, app)) app = ownedApp(user, id);
  } else if (app.jobId && app.appId) {
    const session = workspaceSession(user);
    const [progress, transcript] = await Promise.all([getStatus(session, app.jobId), getMessages(session, app.jobId)]);
    if (!progress.ok) throw new PilotError(502, "progress_unavailable", "Build progress is unavailable. The build may still be running; refresh to check it.");
    // Core echoes the requested identifier, including a numeric message-ID
    // fallback encoded as a string. Another job for this app is not our build.
    const status = checkedStatus(progress.json, app.appId, app.jobId);
    if (transcript.ok && (transcript.json.app_id !== app.appId || transcript.json.job_id !== app.jobId)) throw new PilotError(502, "workspace_response_mismatch", "The service returned a different conversation.");
    const messages = transcript.ok ? checkedMessages(transcript.json.messages, [session.creatorKey || "", process.env.OVERSKILL_PARTNER_API_KEY || ""]) : app.messages;
    app = { ...app, status, messages, updatedAt: now() };
    if (app.deployState === "queued" && app.deploymentId) {
      const latest = await getDeploymentStatus(session, app.appId, app.deploymentId);
      if (latest.ok && latest.json.app_id === app.appId && latest.json.deployment?.id === app.deploymentId &&
          latest.json.deployment.environment === "production" && latest.json.deployment.status === "deployed" &&
          latest.json.deployment.deployed_at && safeUrl(latest.json.urls?.production)) {
        app = { ...app, deployState: "published", publishedUrl: safeUrl(latest.json.urls.production) };
      }
    }
    if (!db.compareAndSwapApp(user.id, original, app)) app = ownedApp(user, id);
  }
  return publicWorkspaceApp(app);
}

export async function generateWorkspaceApp(req: Request, user: CustomerRecord, input: Record<string, unknown>) {
  if (Object.keys(input).some(k => !["prompt", "appId"].includes(k))) throw new PilotError(400, "invalid_input", "Send a prompt and optional workspace app ID only.");
  const prompt = inputString(input.prompt, "prompt", 10_000)!;
  const id = inputString(input.appId, "appId", 80, false);
  const db = getCustomerStore();
  const existing = id ? ownedApp(user, id) : undefined;
  if (existing && (existing.submissionState !== "confirmed" || ["queued", "processing"].includes(existing.status?.status || "queued"))) {
    throw new PilotError(409, "build_in_progress", "Wait for this build to finish, or refresh its current state before editing.");
  }
  if (!id && db.listApps(user.id).length >= MAX_APPS) throw new PilotError(429, "workspace_app_limit", "This reference workspace has reached its app limit.");
  const session = workspaceSession(user);
  const credits = await workspaceCredits(user);
  if (!hasUsableCreditSnapshot(credits)) throw new PilotError(503, "credits_unavailable", "Credit information is unavailable. No build was requested.");
  if (requireCustomer(req).id !== user.id) throw new PilotError(401, "session_ended", "Sign in again to build.");
  const lock = db.claimOperation(user.id, "app-write");
  if (!lock) throw new PilotError(409, "submission_unresolved", "An earlier submission needs reconciliation. No additional build was requested.");
  const fresh = existing ? ownedApp(user, existing.id) : undefined;
  if ((existing && JSON.stringify(fresh) !== JSON.stringify(existing)) || (fresh?.deployState === "queued") || (!id && db.listApps(user.id).length >= MAX_APPS)) {
    db.releaseOperation(user.id, "app-write", lock);
    throw new PilotError(409, "workspace_changed", "This workspace changed while the request was being prepared. Refresh before submitting again.");
  }
  const localId = existing?.id || randomUUID();
  const time = now();
  let app: CustomerApp = { id: localId, userId: user.id, appId: existing?.appId || "", jobId: null,
    name: existing?.name || prompt.replace(/\s+/g, " ").slice(0, 64), prompt, status: null, messages: [], publishedUrl: null,
    deployState: "idle", createdAt: existing?.createdAt || time, updatedAt: time, simulated: user.mode === "demo", submissionState: "pending", operationToken: lock };
  db.saveApp(user.id, app);
  if (user.mode === "demo") {
    app = { ...app, appId: existing?.appId || `demo-${localId}`, jobId: `demo-${randomUUID()}`, submissionState: "confirmed", operationToken: undefined };
    app.status = { job_id: app.jobId, app_id: app.appId, status: "queued", progress: 0, message: "Starting sample preview", app: null, started_at: time, completed_at: null };
    db.saveApp(user.id, app); db.releaseOperation(user.id, "app-write", lock);
    return publicWorkspaceApp(app);
  }
  try {
    const result = await generate(session, { prompt, appId: existing?.appId, name: app.name,
      partnerContext: "Build the app described by this customer. Customer data and app access are isolated to the authenticated creator workspace.",
      attribution: { partner: process.env.OVERSKILL_PARTNER_SLUG || "open-overskill", display_name: builderConfig.name, powered_by: "Overskill", show_attribution: true } });
    if (!result.ok && [400, 401, 402, 403, 404, 405, 422, 429].includes(result.status)) {
      const restored = existing ? db.compareAndSwapApp(user.id, app, existing) : db.discardUnsubmittedApp(user.id, app);
      if (!restored) throw new PilotError(409, "workspace_changed", "This app changed while the rejected request was being restored. Refresh its state.");
      db.releaseOperation(user.id, "app-write", lock);
      throw new PilotError(result.status, "build_rejected", "Overskill declined this build. Check your workspace access and available credits before submitting again.");
    }
    const jobId = typeof result.json.job_id === "string" && result.json.job_id.length > 0 && result.json.job_id.length <= 160
      ? result.json.job_id : Number.isSafeInteger(result.json.message_id) && Number(result.json.message_id) > 0 ? String(result.json.message_id) : null;
    if (!result.ok || typeof result.json.app_id !== "string" || !jobId || (existing && result.json.app_id !== existing.appId)) {
      throw new PilotError(502, "submission_unconfirmed", "The build submission was not confirmed. It may have reached Overskill. No automatic retry was made.");
    }
    app = { ...app, appId: result.json.app_id, jobId, submissionState: "confirmed", operationToken: undefined,
      status: { job_id: jobId, app_id: result.json.app_id, status: "queued", progress: 0, message: "Build queued", app: null, started_at: time, completed_at: null } };
    db.saveApp(user.id, app); db.releaseOperation(user.id, "app-write", lock);
    return publicWorkspaceApp(app);
  } catch (error) {
    if (error instanceof PilotError && error.code === "build_rejected") throw error;
    db.saveApp(user.id, { ...app, submissionState: "unknown", updatedAt: now() });
    throw error;
  }
}

export async function deployWorkspaceApp(req: Request, user: CustomerRecord, id: string) {
  const db = getCustomerStore();
  let app = ownedApp(user, id);
  if (app.status?.status !== "completed") throw new PilotError(409, "build_not_complete", "Finish the build before publishing.");
  if (app.deployState !== "idle") return publicWorkspaceApp(app);
  const session = workspaceSession(user);
  if (user.mode === "live") {
    requireLiveConfiguration();
    const readiness = await getDeploymentStatus(session, app.appId);
    if (!readiness.ok || readiness.json.app_id !== app.appId || readiness.json.capabilities?.deployment_tracking !== "request-v1") {
      throw new PilotError(503, "publication_unavailable", "Publishing is not enabled for this workspace yet. No deployment was requested.");
    }
  }
  if (requireCustomer(req).id !== user.id) throw new PilotError(401, "session_ended", "Sign in again to publish.");
  const lock = db.claimOperation(user.id, "app-write");
  if (!lock) throw new PilotError(409, "deployment_unresolved", "An earlier publication request needs reconciliation. No duplicate request was made.");
  if (JSON.stringify(ownedApp(user, id)) !== JSON.stringify(app)) {
    db.releaseOperation(user.id, "app-write", lock);
    throw new PilotError(409, "workspace_changed", "This app changed while publication was being prepared. Refresh before trying again.");
  }
  if (user.mode === "demo") {
    app = { ...app, deployState: "demo", publishedUrl: `/api/workspace/apps/${app.id}/preview?published=1`, updatedAt: now() };
    db.saveApp(user.id, app); db.releaseOperation(user.id, "app-write", lock);
    return publicWorkspaceApp(app);
  }
  const requestedAt = now();
  const beforeRequest = app;
  app = { ...app, deployState: "queued", deploymentRequestedAt: requestedAt, operationToken: lock, updatedAt: requestedAt };
  db.saveApp(user.id, app);
  const result = await deployTracked(session, app.appId);
  if (!result.ok || result.json.tracking !== "request-v1" || !Number.isSafeInteger(result.json.deployment_id) || result.json.deployment_id <= 0) {
    if (!result.ok && result.status >= 400 && result.status < 500 && ![408, 409].includes(result.status)) {
      db.saveApp(user.id, beforeRequest);
      db.releaseOperation(user.id, "app-write", lock);
    }
    throw new PilotError(502, "deployment_unconfirmed", "Publication was not confirmed. Refresh the app before attempting another request.");
  }
  app = { ...app, deployState: "queued", publishedUrl: null, deploymentId: result.json.deployment_id, operationToken: undefined, updatedAt: now() };
  db.saveApp(user.id, app); db.releaseOperation(user.id, "app-write", lock);
  return publicWorkspaceApp(app);
}

export function demoPreview(user: CustomerRecord, id: string) {
  const app = ownedApp(user, id);
  if (user.mode !== "demo" || app.status?.status !== "completed") throw new PilotError(404, "preview_unavailable", "Demo preview unavailable.");
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(app.name)}</title><style>*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui;background:#faf9f6;color:#232928}.wrap{max-width:840px;margin:auto;padding:48px 24px}small{letter-spacing:.12em;text-transform:uppercase;color:#557466}h1{font-size:clamp(30px,6vw,48px);line-height:1.15;max-width:20ch}p{max-width:64ch}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:36px 0}.card{padding:24px;background:white;border:1px solid #e3e7e1;border-radius:16px}.notice{border-top:1px solid #d4dcd5;padding-top:24px;color:#64726a;font-size:13px}</style><main class="wrap"><small>${escape(user.name)} / sample app</small><h1>${escape(app.name)}</h1><p>${escape(app.prompt)}</p><div class="cards"><section class="card"><h2>Your idea</h2><p>A starting point for a useful customer experience.</p></section><section class="card"><h2>Your brand</h2><p>Customize the example builder for your audience.</p></section><section class="card"><h2>Your workspace</h2><p>Return to this saved example and try an edit.</p></section></div><p class="notice">Simulated preview using a fixed example template. No AI generation, credit charge or public deployment occurred.</p></main></html>`;
}
