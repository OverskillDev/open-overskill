// In-memory OverSkill simulator.
//
// The real OverSkill is a large Rails app that isn't practical to boot for a
// quick local demo. Unless live mode is explicitly enabled, Open OverSkill
// routes API calls here so the flow — provision →
// context injection → generate → poll → preview → deploy — is demonstrable
// locally and end-to-end. The response shapes match the real controllers 1:1
// (see lib/types.ts). A successful simulation does not verify the live service.
//
// This models exactly what the OverSkill partner branches add on top of the
// stock API: `partner_context` echo + a `white_label` block on the app/deploy.
//
// State lives on globalThis: Next.js bundles each API route separately, so a
// plain module-level Map would give every route its own copy and break
// cross-route flows (generate here, poll there). globalThis is shared across
// all route bundles in the one server process.

import type {
  ProvisionResponse,
  GenerateResponse,
  StatusResponse,
  DeployResponse,
  AppSummary,
  GenerationStatus,
  WhiteLabel,
  MessagesResponse,
  FlowBlock,
} from "./types";

interface MockApp {
  appId: string;
  messageId: number;
  jobId: string;
  name: string;
  prompt: string;
  partnerContext?: string;
  attribution?: WhiteLabel;
  createdAt: number;
  deployed: boolean;
  deploymentId?: number;
}

interface MockState {
  apps: Map<string, MockApp>;
  byJob: Map<string, string>; // jobId | messageId -> appId
  // Preserve each generation's transcript when a later edit replaces the app.
  // Optional for existing local dev state surviving hot reload.
  generations?: Map<string, MockApp>;
  seq: number;
}

const GENERATION_MS = 12_000; // sim build takes ~12s to reach 100%

const g = globalThis as unknown as { __fmMock?: MockState };
function state(): MockState {
  if (!g.__fmMock) g.__fmMock = { apps: new Map(), byJob: new Map(), seq: 1000 };
  return g.__fmMock;
}

function newId(prefix: string) {
  const s = state();
  s.seq += 1;
  return `${prefix}_${s.seq.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function provision(name: string, userEmail?: string): ProvisionResponse {
  const s = state();
  const teamId = 4200 + (s.seq % 1000);
  s.seq += 1;
  return {
    team: {
      id: teamId,
      name,
      subscription_tier: "free",
      credit_tier: "tier_500",
      created_at: new Date().toISOString(),
    },
    user_added: Boolean(userEmail),
    warning: null,
    api_key: {
      key: `os_${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
      name: `${name} API Key`,
      scope: "read_write",
      note: "Save this key now - it cannot be retrieved later (simulated)",
    },
  };
}

export function generate(opts: {
  prompt: string;
  appId?: string;
  name?: string;
  partnerContext?: string;
  attribution?: WhiteLabel;
}): GenerateResponse {
  const s = state();
  const appId = opts.appId && s.apps.has(opts.appId) ? opts.appId : newId("app");
  const messageId = s.seq++;
  const jobId = newId("job");

  const existing = s.apps.get(appId);
  const app: MockApp = existing
    ? {
        ...existing, prompt: opts.prompt, jobId, messageId, createdAt: Date.now(), deployed: false,
        partnerContext: opts.partnerContext ?? existing.partnerContext,
        attribution: opts.attribution ?? existing.attribution,
        deploymentId: undefined,
      }
    : {
        appId,
        messageId,
        jobId,
        name: opts.name || "Creator app",
        prompt: opts.prompt,
        partnerContext: opts.partnerContext,
        attribution: opts.attribution,
        createdAt: Date.now(),
        deployed: false,
      };
  s.apps.set(appId, app);
  s.byJob.set(jobId, appId);
  s.byJob.set(String(messageId), appId);
  const generations = s.generations ??= new Map();
  generations.set(jobId, app);
  generations.set(String(messageId), app);

  const applied = Boolean(opts.partnerContext);
  return {
    job_id: jobId,
    app_id: appId,
    message_id: messageId,
    status: "queued",
    estimated_time_seconds: Math.round(GENERATION_MS / 1000),
    webhook_events: [
      "app.generation.started",
      "app.generation.progress",
      "app.generation.completed",
      "app.generation.failed",
    ],
    status_url: `/api/status?id=${jobId}`,
    app_url: `/preview/${appId}`,
    partner_context: applied
      ? { applied: true, bytes: Buffer.byteLength(opts.partnerContext || "", "utf8"), truncated: false }
      : undefined,
  };
}

function summarize(app: MockApp, progress: number): AppSummary {
  const done = progress >= 100;
  return {
    id: app.appId,
    name: app.name,
    description: app.prompt.slice(0, 120),
    status: app.deployed ? "published" : done ? "ready" : "generating",
    visibility: "public",
    ai_model: "simulated-model",
    preview_url: done ? `/preview/${app.appId}` : null,
    production_url: app.deployed ? `/preview/${app.appId}?env=production` : null,
    published_at: app.deployed ? new Date().toISOString() : null,
    created_at: new Date(app.createdAt).toISOString(),
    updated_at: new Date().toISOString(),
    white_label: app.attribution ?? null,
  };
}

const PROGRESS_STEPS: { at: number; msg: string }[] = [
  { at: 0.05, msg: "Reading creator context (courses, communities, audience)…" },
  { at: 0.25, msg: "Planning screens for your audience…" },
  { at: 0.45, msg: "Generating components in your brand voice…" },
  { at: 0.7, msg: "Wiring courses + community links…" },
  { at: 0.9, msg: "Building preview bundle…" },
  { at: 1, msg: "Done — preview ready." },
];

export function status(id: string): StatusResponse | null {
  const s = state();
  const appId = s.byJob.get(id);
  if (!appId) return null;
  const app = s.generations?.get(id) ?? s.apps.get(appId);
  if (!app) return null;

  const elapsed = Date.now() - app.createdAt;
  const ratio = Math.min(1, elapsed / GENERATION_MS);
  const progress = Math.round(ratio * 100);
  const statusStr: GenerationStatus = progress >= 100 ? "completed" : progress > 0 ? "processing" : "queued";
  const step = [...PROGRESS_STEPS].reverse().find((st) => ratio >= st.at) ?? PROGRESS_STEPS[0];

  return {
    job_id: app.jobId,
    app_id: appId,
    status: statusStr,
    progress,
    message: step.msg,
    app: summarize(app, progress),
    started_at: new Date(app.createdAt).toISOString(),
    completed_at: progress >= 100 ? new Date(app.createdAt + GENERATION_MS).toISOString() : null,
  };
}

export function getApp(appId: string): AppSummary | null {
  const s = state();
  const app = s.apps.get(appId);
  if (!app) return null;
  const elapsed = Date.now() - app.createdAt;
  const progress = Math.round(Math.min(1, elapsed / GENERATION_MS) * 100);
  return summarize(app, progress);
}

export function deploy(appId: string): DeployResponse | { error: string; reason: string; recoverable: boolean } {
  const s = state();
  const app = s.apps.get(appId);
  if (!app) return { error: "App not found", reason: "Unknown app id", recoverable: false };
  const elapsed = Date.now() - app.createdAt;
  if (elapsed < GENERATION_MS) {
    return {
      error: "App is not deployable",
      reason: "Build hasn't finished (no dist/ bundle yet). Wait for the preview, then deploy.",
      recoverable: true,
    };
  }
  app.deployed = true;
  app.deploymentId = s.seq++;
  return {
    deployment_id: app.deploymentId,
    status: "queued",
    message: "Production deployment queued (simulated)",
    production_url: `/preview/${appId}?env=production`,
    white_label: app.attribution ?? null,
  };
}

// Synthetic build timeline that grows with elapsed time, mirroring OverSkill's
// conversation_flow (assistant commentary + tool {name, status}) so the demo
// chat-left pane looks like the live one.
const FLOW_SCRIPT: { at: number; block: FlowBlock }[] = [
  { at: 0.05, block: { type: "message", content: "Reading the creator context and planning screens." } },
  { at: 0.2, block: { type: "tools", status: "complete", tools: [{ name: "os-create-entity", status: "complete" }] } },
  { at: 0.35, block: { type: "message", content: "Building components in the creator's brand voice." } },
  { at: 0.5, block: { type: "tools", status: "complete", tools: [{ name: "edit-file", status: "complete" }, { name: "edit-file", status: "complete" }] } },
  { at: 0.7, block: { type: "tools", status: "complete", tools: [{ name: "edit-file", status: "complete" }, { name: "os-search", status: "complete" }] } },
  { at: 0.9, block: { type: "message", content: "Wiring courses + community links and building the preview." } },
  { at: 1, block: { type: "tools", status: "complete", tools: [{ name: "os-deploy-preview", status: "complete" }] } },
];

export function messages(id: string): MessagesResponse | null {
  const s = state();
  const appId = s.byJob.get(id);
  if (!appId) return null;
  const app = s.generations?.get(id) ?? s.apps.get(appId);
  if (!app) return null;

  const ratio = Math.min(1, (Date.now() - app.createdAt) / GENERATION_MS);
  const progress = Math.round(ratio * 100);
  const flow = FLOW_SCRIPT.filter((f) => ratio >= f.at).map((f) => f.block);
  const done = progress >= 100;

  return {
    job_id: app.jobId,
    app_id: appId,
    status: done ? "completed" : progress > 0 ? "processing" : "queued",
    messages: [
      {
        id: app.messageId - 1,
        role: "user",
        status: null,
        thinking_status: null,
        content: app.prompt,
        flow: [],
        created_at: new Date(app.createdAt).toISOString(),
        updated_at: new Date(app.createdAt).toISOString(),
      },
      {
        id: app.messageId,
        role: "assistant",
        status: done ? "completed" : "generating",
        thinking_status: done ? null : "Building your app…",
        content: done ? "Done — preview ready." : "Design Direction: built for this creator.",
        flow,
        created_at: new Date(app.createdAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    app: summarize(app, progress),
  };
}

// Used by the preview route to render a real, personalized app for the iframe.
export function getMockApp(appId: string): MockApp | null {
  return state().apps.get(appId) ?? null;
}
