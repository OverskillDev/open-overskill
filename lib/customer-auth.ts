// Server-only customer authentication. OIDC tokens and creator keys never reach the browser.
import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import { getCustomerStore, hashCustomerToken, type CustomerRecord } from "./customer-store";
import { isLoopback, PilotError, readJsonObject } from "./pilot-security";
import { customerMode, customerOrigin, customerOidcSettings } from "./customer-configuration";
export { customerMode, customerOrigin } from "./customer-configuration";

export const CUSTOMER_SESSION_COOKIE = "open_overskill_customer";
export const CUSTOMER_OIDC_COOKIE = "open_overskill_login";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OIDC_TTL_MS = 10 * 60 * 1000;
function validateRequestHost(req: Request): URL {
  const origin = customerOrigin(); const incoming = new URL(req.url);
  const host = req.headers.get("host");
  if (host ? host.toLowerCase() !== origin.host.toLowerCase() : incoming.origin !== origin.origin) throw new PilotError(403, "customer_host_mismatch", "Use the configured application origin.");
  // A local Next server may reconstruct its own URL behind a trusted Host header.
  // Forwarded headers never establish the expected public origin.
  if (incoming.origin !== origin.origin && !(host && isLoopback(incoming.hostname))) throw new PilotError(403, "customer_host_mismatch", "Use the configured application origin.");
  return origin;
}
export function requireCustomerOrigin(req: Request, mutation = false) {
  const expected = validateRequestHost(req).origin;
  const source = req.headers.get("origin");
  if ((mutation && source !== expected) || (source && source !== expected) || ["cross-site", "same-site"].includes(req.headers.get("sec-fetch-site") || "")) throw new PilotError(403, "cross_origin_request", "Use this action from the same application origin.");
}
export const enforceCustomerMutation = (req: Request) => requireCustomerOrigin(req, true);
function cookie(req: Request, name: string): string | undefined {
  const values = req.headers.get("cookie")?.split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`)) || [];
  if (values.length !== 1) return;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function setCookie(name: string, value: string, ttlSeconds: number) {
  const secure = customerOrigin().protocol === "https:";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secure ? "; Secure" : ""}`;
}
export function findCustomer(req: Request): CustomerRecord | undefined {
  requireCustomerOrigin(req);
  const token = cookie(req, CUSTOMER_SESSION_COOKIE);
  if (!token) return;
  const store = getCustomerStore(); const session = store.getSession(token);
  const user = session ? store.getCustomer(session.userId) : undefined;
  return user?.mode === customerMode() ? user : undefined;
}
export function requireCustomer(req: Request, options: { mutation?: boolean } = {}): CustomerRecord {
  requireCustomerOrigin(req, options.mutation || false);
  const user = findCustomer(req);
  if (!user) throw new PilotError(401, "customer_session_required", "Sign in to your workspace first.");
  // This header is a stale-tab consistency check, never an identity selector.
  // The authenticated cookie remains authoritative for every ownership lookup.
  const expected = req.headers.get("x-open-overskill-customer");
  if ((options.mutation || expected !== null) && expected !== user.id) {
    throw new PilotError(409, "customer_session_changed", "Your signed-in account changed. Reload the workspace before continuing.");
  }
  return user;
}
export function publicCustomer(user: CustomerRecord) {
  return { id: user.id, name: user.name, email: user.email || null, simulated: user.mode === "demo" };
}
export function customerResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
export function customerError(error: unknown) {
  if (error instanceof PilotError) return customerResponse({ error: error.message, code: error.code }, error.status);
  return customerResponse({ error: "The customer request could not be completed. Check the server configuration and the operation state before retrying.", code: "customer_request_failed" }, 500);
}
function logoutToken(req: Request) {
  const existing = cookie(req, CUSTOMER_SESSION_COOKIE);
  if (existing) getCustomerStore().deleteSession(existing);
}
function authenticate(req: Request, user: CustomerRecord, response: Response): Response {
  logoutToken(req);
  const sessionToken = getCustomerStore().createSession(user.id, Date.now() + SESSION_TTL_MS);
  response.headers.append("Set-Cookie", setCookie(CUSTOMER_SESSION_COOKIE, sessionToken, SESSION_TTL_MS / 1000));
  return response;
}
export function customerAuthInfo(req: Request) {
  const user = findCustomer(req); const demoAvailable = customerMode() === "demo" && isLoopback(customerOrigin().hostname);
  return { authenticated: Boolean(user), ...(user ? { user: publicCustomer(user) } : {}), mode: customerMode(), demoAvailable, loginAvailable: !demoAvailable && Boolean(process.env.OPEN_OVERSKILL_OIDC_ISSUER && process.env.OPEN_OVERSKILL_OIDC_CLIENT_ID && process.env.OPEN_OVERSKILL_ENCRYPTION_KEY) };
}
export async function createDemoCustomer(req: Request): Promise<Response> {
  enforceCustomerMutation(req);
  if (customerMode() !== "demo" || !isLoopback(customerOrigin().hostname)) throw new PilotError(404, "demo_unavailable", "Simulated customer accounts are unavailable.");
  const body = await readJsonObject(req, 1000);
  if (body.persona !== "alice" && body.persona !== "bob") throw new PilotError(400, "invalid_demo_persona", "Choose Alice or Bob for the simulated workspace.");
  const name = body.persona === "alice" ? "Alice Demo" : "Bob Demo";
  const user = getCustomerStore().upsertIdentity({ issuer: "urn:open-overskill:local-demo", subject: body.persona, email: `${body.persona}@example.invalid`, emailVerified: false, name });
  return authenticate(req, user, customerResponse({ authenticated: true, user: publicCustomer(user), simulated: true }));
}
export function logoutCustomer(req: Request): Response {
  enforceCustomerMutation(req); logoutToken(req);
  const response = customerResponse({ authenticated: false });
  response.headers.append("Set-Cookie", setCookie(CUSTOMER_SESSION_COOKIE, "", 0));
  response.headers.append("Set-Cookie", setCookie(CUSTOMER_OIDC_COOKIE, "", 0));
  return response;
}
async function oidcConfiguration() {
  const settings = customerOidcSettings();
  const config = await oidc.discovery(settings.issuer, settings.clientId, settings.secret, undefined, { timeout: 10, execute: [oidc.enableNonRepudiationChecks] });
  return { settings, config };
}
export async function beginCustomerLogin(req: Request): Promise<Response> {
  requireCustomerOrigin(req);
  const origin = customerOrigin(); const { settings, config } = await oidcConfiguration();
  const state = oidc.randomState(); const verifier = oidc.randomPKCECodeVerifier(); const nonce = oidc.randomNonce();
  const browserToken = randomBytes(32).toString("base64url");
  const url = oidc.buildAuthorizationUrl(config, { redirect_uri: `${origin.origin}/api/customer/callback`, scope: "openid profile email", response_type: "code", code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce });
  getCustomerStore().saveOidcAttempt({ state, verifier, nonce, issuer: settings.issuerValue, browserHash: hashCustomerToken(browserToken), expiresAt: Date.now() + OIDC_TTL_MS });
  const response = new Response(null, { status: 302, headers: { Location: url.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  response.headers.set("Set-Cookie", setCookie(CUSTOMER_OIDC_COOKIE, browserToken, OIDC_TTL_MS / 1000));
  return response;
}
export async function finishCustomerLogin(req: Request): Promise<Response> {
  // Cross-site top-level GET is expected from the identity provider; host, state,
  // browser binding, PKCE and nonce protect this callback instead of Origin.
  const origin = validateRequestHost(req); const incoming = new URL(req.url);
  if (incoming.pathname !== "/api/customer/callback") throw new PilotError(400, "invalid_oidc_callback", "Invalid sign-in callback.");
  const browserToken = cookie(req, CUSTOMER_OIDC_COOKIE); const state = incoming.searchParams.get("state");
  if (!browserToken || !state || incoming.searchParams.getAll("state").length !== 1) throw new PilotError(400, "login_state_invalid", "Sign-in expired or belongs to another browser. Start again.");
  const settings = customerOidcSettings();
  const attempt = getCustomerStore().consumeOidcAttempt(state, browserToken);
  if (!attempt || attempt.issuer !== settings.issuerValue) throw new PilotError(400, "login_state_invalid", "Sign-in expired or was already used. Start again.");
  const { config } = await oidcConfiguration();
  const callback = new URL(`/api/customer/callback${incoming.search}`, origin);
  const tokens = await oidc.authorizationCodeGrant(config, callback, { expectedState: attempt.state, expectedNonce: attempt.nonce, pkceCodeVerifier: attempt.verifier, idTokenExpected: true });
  const claims = tokens.claims();
  if (!claims || claims.iss !== settings.issuerValue || typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || claims.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) || claims.email_verified !== true) throw new PilotError(403, "verified_identity_required", "A verified email from your identity provider is required before creating a workspace.");
  const user = getCustomerStore().upsertIdentity({ issuer: claims.iss, subject: claims.sub, email: claims.email, emailVerified: true, name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 120) : "Builder" });
  const response = new Response(null, { status: 303, headers: { Location: `${origin.origin}/workspace`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  response.headers.append("Set-Cookie", setCookie(CUSTOMER_OIDC_COOKIE, "", 0));
  return authenticate(req, user, response);
}
