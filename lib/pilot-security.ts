// Local, single-process pilot access control. Replace with your verified user /
// tenant identity and durable credential store before offering a public service.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "open_overskill_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 128;
const MAX_RESOURCES = 200;

export class PilotError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface PilotSession {
  id: string;
  expiresAt: number;
  mode: "demo" | "live";
  tokenHash: string;
  creatorKey?: string;
  creatorBinding?: { id: number; keyId: number; externalId: string; teamId: number };
  provisioned?: Record<string, unknown>;
  provisioning?: boolean;
  apps: Set<string>;
  jobs: Set<string>;
}

interface PilotStore {
  sessions: Map<string, PilotSession>;
  loginAttempts: number[];
}
const globalStore = globalThis as unknown as { __openOverskillPilot?: PilotStore };
function store(): PilotStore {
  return globalStore.__openOverskillPilot ??= { sessions: new Map(), loginAttempts: [] };
}

export function isDemoMode(env = process.env): boolean {
  // Possession of a partner key alone must never turn on paid operations.
  return !["0", "false"].includes((env.OVERSKILL_MOCK || "1").toLowerCase());
}

export function requireLiveConfiguration(env = process.env) {
  if (isDemoMode(env)) return;
  if (env.OVERSKILL_LIVE_ENABLED !== "1" || !env.OVERSKILL_PARTNER_API_KEY ||
      (env.OPEN_OVERSKILL_OPERATOR_TOKEN || "").length < 32) {
    throw new PilotError(503, "live_not_configured", "Live pilot requires explicit opt-in, a partner key, and an operator token of at least 32 characters.");
  }
  let base: URL;
  try { base = new URL(env.OVERSKILL_API_BASE || "http://localhost:3000"); }
  catch { throw new PilotError(503, "invalid_api_base", "Configure a valid OverSkill API origin."); }
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(base.protocol === "http:" && isLoopback(base.hostname)))) {
    throw new PilotError(503, "invalid_api_base", "Use an HTTPS OverSkill API origin, or HTTP on loopback for local development.");
  }
}

export function isLoopback(host: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host.toLowerCase());
}

// Next may construct req.url using localhost while the browser connected to
// 127.0.0.1. Use the direct Host authority after validating both as loopback;
// forwarded host headers never establish this pilot's trusted browser origin.
function localRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  if (!isLoopback(url.hostname) || (host && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host))) {
    throw new PilotError(403, "local_pilot_only", "This pilot runs on localhost. Public hosting requires production authentication and tenancy.");
  }
  try { return host ? new URL(`${url.protocol}//${host}`).origin : url.origin; }
  catch { throw new PilotError(403, "local_pilot_only", "Use a valid local host and port."); }
}

export function requireLocalRequest(req: Request) {
  localRequestOrigin(req);
}

export function requireSameOrigin(req: Request) {
  const expectedOrigin = localRequestOrigin(req);
  const origin = req.headers.get("origin");
  if ((origin && origin !== expectedOrigin) ||
      ["cross-site", "same-site"].includes(req.headers.get("sec-fetch-site") || "")) {
    throw new PilotError(403, "cross_origin_request", "Use this pilot from the same local origin.");
  }
}

function tokenHash() {
  return createHash("sha256").update(process.env.OPEN_OVERSKILL_OPERATOR_TOKEN || "").digest("hex");
}

function cookieId(req: Request): string | undefined {
  return req.headers.get("cookie")?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}

export function findSession(req: Request): PilotSession | undefined {
  const id = cookieId(req);
  const session = id ? store().sessions.get(id) : undefined;
  if (!session) return;
  if (session.expiresAt < Date.now() || session.mode !== (isDemoMode() ? "demo" : "live") ||
      (session.mode === "live" && session.tokenHash !== tokenHash())) {
    store().sessions.delete(session.id);
    return;
  }
  return session;
}

export function requireSession(req: Request): PilotSession {
  requireSameOrigin(req);
  requireLiveConfiguration();
  const session = findSession(req);
  if (!session) throw new PilotError(401, "operator_session_required", isDemoMode() ? "Start the demo session first." : "Unlock the local live pilot with your operator token.");
  return session;
}

export function createSession(req: Request): PilotSession {
  requireSameOrigin(req);
  const s = store();
  for (const [id, session] of s.sessions) if (session.expiresAt < Date.now()) s.sessions.delete(id);
  if (s.sessions.size >= MAX_SESSIONS) throw new PilotError(429, "session_limit", "Local session limit reached. Restart the pilot or let sessions expire.");
  const session: PilotSession = {
    id: randomBytes(32).toString("hex"), expiresAt: Date.now() + SESSION_TTL_MS,
    mode: isDemoMode() ? "demo" : "live", tokenHash: tokenHash(), apps: new Set(), jobs: new Set(),
  };
  s.sessions.set(session.id, session);
  return session;
}

export function destroySession(req: Request) {
  const id = cookieId(req);
  if (id) store().sessions.delete(id);
}

export function sessionCookie(session: PilotSession, req: Request): string {
  return `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}

export function verifyOperatorToken(token: unknown) {
  requireLiveConfiguration();
  const s = store();
  s.loginAttempts = s.loginAttempts.filter((at) => at > Date.now() - 60_000);
  if (s.loginAttempts.length >= 5) throw new PilotError(429, "login_rate_limited", "Too many unlock attempts. Wait one minute.");
  s.loginAttempts.push(Date.now());
  const expected = Buffer.from(tokenHash(), "hex");
  const supplied = createHash("sha256").update(typeof token === "string" ? token : "").digest();
  if (!timingSafeEqual(expected, supplied)) throw new PilotError(401, "invalid_operator_token", "Invalid operator token.");
}

export function requireCreator(session: PilotSession) {
  if (!session.provisioned || !session.creatorKey) throw new PilotError(409, "creator_required", session.creatorBinding ? "Recover the lost creator key explicitly before building." : "Provision a creator in this session before building.");
}

export function requireExternalCreatorId(env: Record<string, string | undefined> = process.env): string {
  const id = env.OVERSKILL_CREATOR_ID;
  if (typeof id !== "string" || !id || id !== id.trim() || id.length > 200 || id === "creator_demo_001") {
    throw new PilotError(503, "creator_identity_not_configured", "Set OVERSKILL_CREATOR_ID to your creator's stable internal ID before live provisioning. Keep it unchanged across restarts.");
  }
  return id;
}

export function requireOwned(session: PilotSession, kind: "app" | "job", id: string) {
  if (!(kind === "app" ? session.apps : session.jobs).has(id)) {
    throw new PilotError(404, "resource_not_found", "Resource not found in this session.");
  }
}

export function rememberGeneration(session: PilotSession, result: { app_id?: unknown; job_id?: unknown; message_id?: unknown }) {
  if (typeof result.app_id !== "string" || !result.app_id || (!result.job_id && !result.message_id)) {
    throw new PilotError(502, "invalid_generation_response", "OverSkill did not return a usable app and job identifier.");
  }
  session.apps.add(result.app_id);
  if (typeof result.job_id === "string" && result.job_id) session.jobs.add(result.job_id);
  if (typeof result.message_id === "number" || typeof result.message_id === "string") session.jobs.add(String(result.message_id));
}

export function requireGenerationCapacity(session: PilotSession) {
  if (session.apps.size >= MAX_RESOURCES || session.jobs.size >= MAX_RESOURCES * 2) {
    throw new PilotError(429, "pilot_resource_limit", "This session has reached the pilot build limit.");
  }
}

export async function readJsonObject(req: Request, limit = 20_000): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new PilotError(415, "json_required", "Send an application/json request body.");
  }
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new PilotError(413, "body_too_large", "Request body is too large.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PilotError(400, "invalid_json", "Request body must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new PilotError(400, "invalid_body", "Request body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

export function inputString(value: unknown, name: string, max: number, required = true): string | undefined {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new PilotError(400, "invalid_input", `${name} must be a nonempty string of at most ${max} characters.`);
  }
  return value.trim();
}

export function redactSecrets(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
  }
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, secrets));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    /^(key|token|secret|password|authorization|access_token|refresh_token|client_secret|operator_token)$/i.test(key) || /(?:api[_-]?key|secret|token)$/i.test(key) && typeof entry === "string"
      ? "[REDACTED]" : redactSecrets(entry, secrets),
  ]));
}

export function apiResponse(body: unknown, status = 200, session?: PilotSession): Response {
  const secrets = [process.env.OVERSKILL_PARTNER_API_KEY || "", process.env.OPEN_OVERSKILL_OPERATOR_TOKEN || "", session?.creatorKey || ""];
  return Response.json(redactSecrets(body, secrets), { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function apiError(error: unknown): Response {
  if (error instanceof PilotError) return apiResponse({ error: error.message, code: error.code }, error.status);
  // Never echo raw transport errors or upstream bodies containing credentials.
  return apiResponse({ error: "The pilot could not complete this request.", code: "pilot_request_failed" }, 500);
}
