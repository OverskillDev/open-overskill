// Server-only persistence for a single Node instance on private persistent disk.
// There is intentionally no local credit balance or financial ledger here.
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ChatMessage, StatusResponse } from "./types";

export interface CustomerRecord {
  id: string; issuer: string; subject: string; externalCreatorId: string;
  email?: string; emailVerified: boolean; name: string; mode: "demo" | "live"; createdAt: string;
}
export interface CreatorBinding { id: number; keyId: number; externalId: string; teamId: number }
export type CreatorState = "unprovisioned" | "provisioning" | "ready" | "recovery_required" | "failed";
export interface CustomerCreator { state: CreatorState; key?: string; binding?: CreatorBinding; provisioned?: Record<string, unknown>; updatedAt: string }
export interface CustomerApp {
  id: string; userId: string; appId: string; jobId: string | null; name: string; prompt: string;
  status: StatusResponse | null; messages: ChatMessage[]; publishedUrl: string | null;
  deployState: "idle" | "queued" | "demo" | "published";
  createdAt: string; updatedAt: string; simulated: boolean;
  submissionState?: "confirmed" | "unknown" | "pending"; operationToken?: string;
  deploymentRequestedAt?: string; deploymentId?: number;
}
export interface OidcAttempt { state: string; browserHash: string; verifier: string; nonce: string; issuer: string; expiresAt: number }
export interface CustomerSession { userId: string; expiresAt: number }
export interface CustomerPurchase {
  id: string; userId: string; packId: string; idempotencyKey: string; coreId?: string;
  checkoutState: "submitting" | "open" | "unknown" | "resolved" | "rejected";
  purchaseStatus: string | null; credits: number | null; priceCents: number | null;
  currency: "USD"; checkoutUrl: string | null; creditsGranted: boolean;
  readAvailable?: boolean;
  createdAt: string; updatedAt: string;
}
export const hashCustomerToken = (value: string) => createHash("sha256").update(value).digest("hex");

type Row = Record<string, unknown>;
const isoNow = () => new Date().toISOString();
function noSymlink(path: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Customer storage cannot use symlinks.");
}
function encryptionKey(directory: string, live: boolean): Buffer {
  const configured = process.env.OPEN_OVERSKILL_ENCRYPTION_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32 || key.toString("base64") !== configured) throw new Error("OPEN_OVERSKILL_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64.");
    return key;
  }
  if (live) throw new Error("Live customer storage requires OPEN_OVERSKILL_ENCRYPTION_KEY.");
  const file = join(directory, "demo-encryption-key");
  noSymlink(file);
  if (!existsSync(file)) {
    try { writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  if ((lstatSync(file).mode & 0o077) !== 0) throw new Error("Demo encryption key must be private (mode 0600).");
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error("Invalid demo encryption key.");
  return key;
}

export class CustomerStore {
  private db: DatabaseSync;
  private key: Buffer;
  constructor(public readonly directory: string, public readonly mode: "demo" | "live") {
    if (typeof window !== "undefined") throw new Error("Customer storage is server-only.");
    if (!isAbsolute(directory)) throw new Error("Customer storage directory must be absolute.");
    noSymlink(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if ((lstatSync(directory).mode & 0o077) !== 0) throw new Error("Customer storage directory must be private (mode 0700).");
    this.key = encryptionKey(directory, mode === "live");
    const file = join(directory, `customers-${mode}.sqlite`);
    noSymlink(file);
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
        external_creator_id TEXT NOT NULL UNIQUE, email TEXT, email_verified INTEGER NOT NULL,
        name TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(issuer, subject)
      );
      CREATE TABLE IF NOT EXISTS customer_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES customers(id), expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oidc_attempts (
        state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, encrypted TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS customer_creators (
        user_id TEXT PRIMARY KEY REFERENCES customers(id), state TEXT NOT NULL,
        encrypted TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS customer_apps (
        user_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, data TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(user_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS customer_apps_backend_identity
        ON customer_apps(json_extract(data, '$.appId')) WHERE json_extract(data, '$.appId') != '';
      CREATE TABLE IF NOT EXISTS customer_operations (
        user_id TEXT NOT NULL REFERENCES customers(id), kind TEXT NOT NULL, token TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(user_id, kind)
      );
      CREATE TABLE IF NOT EXISTS customer_purchases (
        user_id TEXT NOT NULL REFERENCES customers(id), id TEXT NOT NULL, active INTEGER NOT NULL,
        data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS customer_purchase_active ON customer_purchases(user_id) WHERE active=1;`);
  }
  close() { this.db.close(); }
  private encrypt(value: unknown, aad: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
  }
  private decrypt<T>(value: string, aad: string): T {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted customer record.");
    const cipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(encrypted, "base64")), cipher.final()]).toString("utf8")) as T;
  }
  private customer(row: Row | undefined): CustomerRecord | undefined {
    if (!row) return;
    return { id: String(row.id), issuer: String(row.issuer), subject: String(row.subject), externalCreatorId: String(row.external_creator_id), email: row.email ? String(row.email) : undefined, emailVerified: row.email_verified === 1, name: String(row.name), mode: row.mode as CustomerRecord["mode"], createdAt: String(row.created_at) };
  }
  getCustomer(id: string): CustomerRecord | undefined {
    return this.customer(this.db.prepare("SELECT * FROM customers WHERE id = ?").get(id));
  }
  // Only the verified OIDC callback or fixed local demo identities may call this.
  // Email is profile data, never a lookup or merge key.
  upsertIdentity(identity: { issuer: string; subject: string; email?: string; emailVerified: boolean; name: string }): CustomerRecord {
    if (!identity.issuer || !identity.subject || identity.subject.length > 512) throw new Error("Invalid customer identity.");
    const id = randomUUID();
    this.db.prepare(`INSERT INTO customers(id,issuer,subject,external_creator_id,email,email_verified,name,mode,created_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET
      email=excluded.email,email_verified=excluded.email_verified,name=excluded.name`).run(
      id, identity.issuer, identity.subject, `customer_${randomUUID()}`, identity.email || null,
      Number(identity.emailVerified), identity.name, this.mode, isoNow());
    return this.customer(this.db.prepare("SELECT * FROM customers WHERE issuer=? AND subject=?").get(identity.issuer, identity.subject))!;
  }
  createSession(userId: string, expiresAt: number): string {
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM customer_sessions WHERE expires_at <= ?").run(Date.now());
    this.db.prepare("INSERT INTO customer_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(hashCustomerToken(token), userId, expiresAt);
    return token;
  }
  getSession(token: string, now = Date.now()): CustomerSession | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = this.db.prepare("SELECT user_id,expires_at FROM customer_sessions WHERE token_hash=? AND expires_at > ?").get(hashCustomerToken(token), now);
    return row ? { userId: String(row.user_id), expiresAt: Number(row.expires_at) } : undefined;
  }
  deleteSession(token: string) { this.db.prepare("DELETE FROM customer_sessions WHERE token_hash=?").run(hashCustomerToken(token)); }
  saveOidcAttempt(attempt: OidcAttempt) {
    const stateHash = hashCustomerToken(attempt.state);
    this.db.prepare("DELETE FROM oidc_attempts WHERE expires_at <= ?").run(Date.now());
    this.db.prepare("INSERT INTO oidc_attempts(state_hash,browser_hash,encrypted,expires_at) VALUES(?,?,?,?)").run(stateHash, attempt.browserHash, this.encrypt(attempt, `oidc:${stateHash}`), attempt.expiresAt);
  }
  consumeOidcAttempt(state: string, browserToken: string, now = Date.now()): OidcAttempt | undefined {
    if (state.length > 256 || browserToken.length > 256) return;
    const stateHash = hashCustomerToken(state);
    // One SQL statement consumes it before any token exchange, across processes.
    const row = this.db.prepare("DELETE FROM oidc_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING encrypted").get(stateHash, hashCustomerToken(browserToken), now);
    return row ? this.decrypt<OidcAttempt>(String(row.encrypted), `oidc:${stateHash}`) : undefined;
  }
  getCreator(userId: string): CustomerCreator {
    const row = this.db.prepare("SELECT * FROM customer_creators WHERE user_id=?").get(userId);
    if (!row) return { state: "unprovisioned", updatedAt: isoNow() };
    const data = row.encrypted ? this.decrypt<Omit<CustomerCreator, "state" | "updatedAt">>(String(row.encrypted), `creator:${userId}`) : {};
    return { ...data, state: row.state as CreatorState, updatedAt: String(row.updated_at) };
  }
  claimProvisioning(userId: string): boolean {
    const result = this.db.prepare("INSERT OR IGNORE INTO customer_creators(user_id,state,updated_at) VALUES(?,'provisioning',?)").run(userId, isoNow());
    // Existing failed/ambiguous attempts need explicit reconciliation, never blind retry.
    return Number(result.changes) === 1;
  }
  releaseProvisioning(userId: string): void {
    // Only a positively known preflight failure may release a pristine claim.
    // Ambiguous requests and persisted credentials cannot be cleared by this API.
    this.db.prepare("DELETE FROM customer_creators WHERE user_id=? AND state='provisioning' AND encrypted IS NULL").run(userId);
  }
  saveCreator(userId: string, value: { key: string; binding?: CreatorBinding; provisioned: Record<string, unknown> }) {
    const user = this.getCustomer(userId);
    if (!user || !value.key) throw new Error("Invalid creator credentials.");
    const previous = this.getCreator(userId);
    if (value.binding && value.binding.externalId !== user.externalCreatorId) throw new Error("Creator identity does not match customer.");
    if (previous.binding && (!value.binding || previous.binding.id !== value.binding.id || previous.binding.teamId !== value.binding.teamId || previous.binding.externalId !== value.binding.externalId)) throw new Error("Creator binding is immutable.");
    this.db.prepare(`INSERT INTO customer_creators(user_id,state,encrypted,updated_at) VALUES(?,'ready',?,?)
      ON CONFLICT(user_id) DO UPDATE SET state='ready',encrypted=excluded.encrypted,updated_at=excluded.updated_at`).run(userId, this.encrypt(value, `creator:${userId}`), isoNow());
  }
  markCreatorState(userId: string, state: Exclude<CreatorState, "unprovisioned" | "ready">) {
    this.db.prepare(`INSERT INTO customer_creators(user_id,state,updated_at) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`).run(userId, state, isoNow());
  }
  listApps(userId: string): CustomerApp[] {
    return this.db.prepare("SELECT data FROM customer_apps WHERE user_id=? ORDER BY updated_at DESC").all(userId).map(row => JSON.parse(String(row.data)) as CustomerApp);
  }
  getApp(userId: string, id: string): CustomerApp | undefined {
    const row = this.db.prepare("SELECT data FROM customer_apps WHERE user_id=? AND id=?").get(userId, id);
    return row ? JSON.parse(String(row.data)) as CustomerApp : undefined;
  }
  private validateApp(userId: string, app: CustomerApp, previous?: CustomerApp) {
    if (app.userId !== userId || !app.id || (!app.appId && !["pending", "unknown"].includes(app.submissionState || ""))) throw new Error("App ownership or pending state does not match customer.");
    if (previous && (previous.userId !== userId || previous.id !== app.id || (previous.appId && previous.appId !== app.appId))) throw new Error("Backend app binding is immutable.");
  }
  saveApp(userId: string, app: CustomerApp) {
    const previous = this.getApp(userId, app.id);
    this.validateApp(userId, app, previous);
    if (previous) {
      if (!this.compareAndSwapApp(userId, previous, app)) throw new Error("App changed while saving; reload its latest state.");
    } else {
      this.db.prepare("INSERT INTO customer_apps(user_id,id,data,updated_at) VALUES(?,?,?,?)").run(userId, app.id, JSON.stringify(app), app.updatedAt);
    }
  }
  compareAndSwapApp(userId: string, expected: CustomerApp, next: CustomerApp): boolean {
    this.validateApp(userId, next, expected);
    const result = this.db.prepare("UPDATE customer_apps SET data=?,updated_at=? WHERE user_id=? AND id=? AND data=?").run(JSON.stringify(next), next.updatedAt, userId, expected.id, JSON.stringify(expected));
    return Number(result.changes) === 1;
  }
  discardUnsubmittedApp(userId: string, expected: CustomerApp): boolean {
    if (expected.userId !== userId || expected.appId || expected.submissionState !== "pending") throw new Error("Only an unsubmitted placeholder can be discarded.");
    const result = this.db.prepare("DELETE FROM customer_apps WHERE user_id=? AND id=? AND data=?").run(userId, expected.id, JSON.stringify(expected));
    return Number(result.changes) === 1;
  }
  updateApp(userId: string, id: string, patch: Partial<Omit<CustomerApp, "id" | "userId" | "appId" | "createdAt" | "simulated">>): CustomerApp {
    const previous = this.getApp(userId, id);
    if (!previous) throw new Error("App not found in customer workspace.");
    const allowed = ["jobId", "name", "prompt", "status", "messages", "publishedUrl", "deployState", "updatedAt", "submissionState", "operationToken", "deploymentRequestedAt", "deploymentId"] as const;
    const safe = Object.fromEntries(allowed.filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]]));
    const app = { ...previous, ...safe };
    this.saveApp(userId, app); return app;
  }
  claimOperation(userId: string, kind: string): string | null {
    const token = randomUUID();
    const result = this.db.prepare("INSERT OR IGNORE INTO customer_operations(user_id,kind,token,created_at) VALUES(?,?,?,?)").run(userId, kind, token, isoNow());
    return Number(result.changes) === 1 ? token : null;
  }
  releaseOperation(userId: string, kind: string, token: string) {
    this.db.prepare("DELETE FROM customer_operations WHERE user_id=? AND kind=? AND token=?").run(userId, kind, token);
  }
  getPurchase(userId: string, id: string): CustomerPurchase | undefined {
    const row = this.db.prepare("SELECT data FROM customer_purchases WHERE user_id=? AND id=?").get(userId, id);
    return row ? JSON.parse(String(row.data)) as CustomerPurchase : undefined;
  }
  latestPurchase(userId: string): CustomerPurchase | undefined {
    const row = this.db.prepare("SELECT data FROM customer_purchases WHERE user_id=? ORDER BY active DESC,created_at DESC,id DESC LIMIT 1").get(userId);
    return row ? JSON.parse(String(row.data)) as CustomerPurchase : undefined;
  }
  beginPurchase(purchase: CustomerPurchase): boolean {
    if (purchase.checkoutState !== "submitting" || purchase.coreId || purchase.purchaseStatus || purchase.creditsGranted || purchase.checkoutUrl) throw new Error("A purchase must begin without a provider receipt.");
    const result = this.db.prepare("INSERT OR IGNORE INTO customer_purchases(user_id,id,active,data,created_at) VALUES(?,?,1,?,?)").run(purchase.userId, purchase.id, JSON.stringify(purchase), purchase.createdAt);
    return Number(result.changes) === 1;
  }
  savePurchase(expected: CustomerPurchase, next: CustomerPurchase): boolean {
    if (["id", "userId", "packId", "idempotencyKey", "createdAt"].some(k => expected[k as keyof CustomerPurchase] !== next[k as keyof CustomerPurchase]) || (expected.coreId && expected.coreId !== next.coreId)) throw new Error("Purchase identity is immutable.");
    const active = ["resolved", "rejected"].includes(next.checkoutState) ? 0 : 1;
    const result = this.db.prepare("UPDATE customer_purchases SET data=?,active=? WHERE user_id=? AND id=? AND data=?").run(JSON.stringify(next), active, expected.userId, expected.id, JSON.stringify(expected));
    return Number(result.changes) === 1;
  }
}
const registry = globalThis as unknown as { __openOverskillCustomers?: Map<string, CustomerStore> };
export function getCustomerStore(): CustomerStore {
  const mode = ["0", "false"].includes((process.env.OVERSKILL_MOCK || "1").toLowerCase()) ? "live" : "demo";
  const directory = process.env.OPEN_OVERSKILL_DATA_DIR || resolve(process.cwd(), ".data");
  // Key changes create a new handle and fail decryption rather than silently reusing an old key.
  const identity = `${directory}:${mode}:${hashCustomerToken(process.env.OPEN_OVERSKILL_ENCRYPTION_KEY || "local-demo")}`;
  const stores = registry.__openOverskillCustomers ??= new Map();
  if (!stores.has(identity)) stores.set(identity, new CustomerStore(directory, mode));
  return stores.get(identity)!;
}
