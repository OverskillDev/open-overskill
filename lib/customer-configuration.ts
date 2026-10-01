// Pure customer configuration checks shared by runtime code and read-only doctor.
// No discovery, database, filesystem, credential creation or provider calls.
import { isLoopback, PilotError } from "./pilot-security";

type CustomerEnvironment = Record<string, string | undefined>;

export const customerMode = (env: CustomerEnvironment = process.env): "demo" | "live" =>
  ["0", "false"].includes((env.OVERSKILL_MOCK || "1").toLowerCase()) ? "live" : "demo";

export function customerOrigin(env: CustomerEnvironment = process.env): URL {
  let url: URL;
  try { url = new URL(env.OPEN_OVERSKILL_ORIGIN || "http://127.0.0.1:3577"); }
  catch { throw new PilotError(503, "customer_origin_invalid", "Configure a valid customer application origin."); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !["http:", "https:"].includes(url.protocol)) throw new PilotError(503, "customer_origin_invalid", "Configure an origin without a path, credentials, or query.");
  if (!isLoopback(url.hostname) && (url.protocol !== "https:" || env.OPEN_OVERSKILL_HOSTED !== "1")) throw new PilotError(503, "hosted_auth_not_enabled", "Hosted customer authentication requires HTTPS and explicit configuration.");
  if (customerMode(env) === "demo" && !isLoopback(url.hostname)) throw new PilotError(503, "demo_is_local_only", "Simulated accounts are available only on loopback.");
  return url;
}

export function customerOidcSettings(env: CustomerEnvironment = process.env) {
  if (customerMode(env) !== "live") throw new PilotError(404, "login_unavailable", "Use a simulated account in local demo mode.");
  const issuerValue = env.OPEN_OVERSKILL_OIDC_ISSUER; const clientId = env.OPEN_OVERSKILL_OIDC_CLIENT_ID;
  if (!issuerValue || !clientId || !env.OPEN_OVERSKILL_ENCRYPTION_KEY) throw new PilotError(503, "oidc_not_configured", "Configure customer identity before enabling sign in.");
  let issuer: URL;
  try { issuer = new URL(issuerValue); } catch { throw new PilotError(503, "oidc_not_configured", "Configure a valid HTTPS identity issuer."); }
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) throw new PilotError(503, "oidc_not_configured", "Configure a valid HTTPS identity issuer.");
  return { issuer, issuerValue, clientId, secret: env.OPEN_OVERSKILL_OIDC_CLIENT_SECRET };
}

export function parseCustomerEncryptionKey(configured: string): Buffer {
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32 || key.toString("base64") !== configured) throw new Error("OPEN_OVERSKILL_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64.");
  return key;
}
