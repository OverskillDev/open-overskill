// A durable transport journal. Overskill remains the only credit ledger.
import { randomUUID } from "node:crypto";
import { requireCustomer } from "./customer-auth";
import { getCustomerStore, type CustomerRecord, type CustomerPurchase } from "./customer-store";
import { workspacePacks, workspaceSession } from "./customer-workspace";
import { createCreatorPackPurchase, getCreatorPackPurchase } from "./overskill";
import { inputString, PilotError } from "./pilot-security";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const settled = new Set(["completed", "refunded", "partially_refunded"]);
const statuses = new Set(["pending", "completed", "failed", "expired", "refunded", "partially_refunded"]);
function checkoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "whop.com" && !url.port && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function received(previous: CustomerPurchase, value: unknown): CustomerPurchase {
  if (!value || typeof value !== "object") throw new Error("Missing purchase receipt.");
  const p = value as Record<string, unknown>;
  if (typeof p.id !== "string" || !uuid.test(p.id) || (previous.coreId && p.id !== previous.coreId) || p.pack_id !== previous.packId ||
      !["submitting", "open", "unknown"].includes(String(p.checkout_state)) || !statuses.has(String(p.purchase_status)) ||
      p.currency !== "usd" || !Number.isSafeInteger(p.price_cents) || Number(p.price_cents) < 0 ||
      typeof p.total_credits !== "number" || !Number.isFinite(p.total_credits) || p.total_credits < 0 ||
      typeof p.credits_granted !== "boolean" || p.credits_granted !== (p.purchase_status === "completed")) throw new Error("Purchase receipt mismatch.");
  const status = String(p.purchase_status);
  const url = status === "pending" && p.checkout_state === "open" ? checkoutUrl(p.checkout_url) : null;
  if (status === "pending" && p.checkout_state === "open" && !url) throw new Error("Invalid checkout destination.");
  return { ...previous, coreId: p.id, purchaseStatus: status, credits: p.total_credits,
    priceCents: Number(p.price_cents), checkoutUrl: url, creditsGranted: p.credits_granted, readAvailable: true,
    checkoutState: settled.has(status) ? "resolved" : status !== "pending" ? "unknown" : p.checkout_state as CustomerPurchase["checkoutState"], updatedAt: new Date().toISOString() };
}
function save(expected: CustomerPurchase, next: CustomerPurchase) {
  const db = getCustomerStore();
  return db.savePurchase(expected, next) ? next : db.getPurchase(expected.userId, expected.id)!;
}
export function publicPurchase(p: CustomerPurchase) {
  const message = p.readAvailable === false ? "The latest purchase check is unavailable. The last confirmed status is shown; checkout links stay hidden until a successful refresh." :
    p.checkoutState === "rejected" ? "Checkout was declined before it started. Refresh the catalog before trying again." :
    p.checkoutState === "unknown" || p.checkoutState === "submitting" ? "This purchase needs confirmation. Refresh checks the existing request without starting another checkout." :
    p.purchaseStatus === "completed" ? "Overskill confirmed this purchase. Refresh your workspace balance for its current credits." :
    p.purchaseStatus === "refunded" || p.purchaseStatus === "partially_refunded" ? "Overskill recorded a refund for this purchase. Your current balance is shown separately." :
    p.checkoutState === "open" ? "Continue to Whop to pay. Opening checkout or returning here does not confirm payment." :
    "This purchase needs confirmation. Refresh checks the existing request without starting another checkout.";
  return { id: p.id, packId: p.packId, checkoutState: p.checkoutState, purchaseStatus: p.purchaseStatus,
    credits: p.credits, priceCents: p.priceCents, currency: p.currency, checkoutUrl: p.readAvailable === false ? null : p.checkoutUrl,
    creditsGranted: p.creditsGranted, updatedAt: p.updatedAt, readAvailable: p.readAvailable !== false, message };
}
export async function readWorkspacePurchase(user: CustomerRecord) {
  const existing = getCustomerStore().latestPurchase(user.id);
  if (!existing || user.mode === "demo") return null;
  if (existing.checkoutState === "rejected") return publicPurchase(existing);
  const result = await getCreatorPackPurchase(workspaceSession(user), existing.coreId || existing.idempotencyKey, !existing.coreId);
  try {
    if (!result.ok) throw new Error("Purchase receipt unavailable.");
    return publicPurchase(save(existing, received(existing, result.json.purchase)));
  } catch {
    // A failed read cannot undo a known payment/refund or reactivate a settled
    // intent. Availability and the last observed financial facts are separate.
    return publicPurchase(save(existing, { ...existing, readAvailable: false }));
  }
}
export async function createWorkspacePurchase(req: Request, user: CustomerRecord, input: Record<string, unknown>) {
  if (Object.keys(input).some(k => k !== "packId")) throw new PilotError(400, "invalid_input", "Choose an existing pack only.");
  const packId = inputString(input.packId, "packId", 80)!;
  if (user.mode === "demo") throw new PilotError(409, "demo_purchase_unavailable", "The local demo does not create purchases.");
  const db = getCustomerStore();
  const previous = db.latestPurchase(user.id);
  if (previous && (previous.readAvailable === false || !["resolved", "rejected"].includes(previous.checkoutState))) return readWorkspacePurchase(user);
  const catalog = await workspacePacks(user);
  const offer = catalog.packs.find(p => p.id === packId);
  if (!catalog.checkoutAvailable || !offer) throw new PilotError(503, "purchase_unavailable", "This pack is not available for your workspace. No checkout was requested.");
  if (requireCustomer(req).id !== user.id) throw new PilotError(401, "session_ended", "Sign in again before starting checkout.");
  const latest = db.latestPurchase(user.id);
  if (latest?.id !== previous?.id || (latest && (latest.readAvailable === false || !["resolved", "rejected"].includes(latest.checkoutState)))) return readWorkspacePurchase(user);
  const stamp = new Date().toISOString();
  const intent: CustomerPurchase = { id: randomUUID(), userId: user.id, packId, idempotencyKey: randomUUID(),
    checkoutState: "submitting", purchaseStatus: null, credits: offer.credits, priceCents: offer.priceCents,
    currency: "USD", checkoutUrl: null, creditsGranted: false, createdAt: stamp, updatedAt: stamp };
  if (!db.beginPurchase(intent)) return readWorkspacePurchase(user);
  // Exactly one dispatch for this persisted intent. Recovery uses GET by key.
  const result = await createCreatorPackPurchase(workspaceSession(user), packId, intent.idempotencyKey);
  if (!result.ok && [400, 401, 403, 404, 405, 422].includes(result.status)) {
    return publicPurchase(save(intent, { ...intent, checkoutState: "rejected", updatedAt: new Date().toISOString() }));
  }
  try {
    if (!result.ok) throw new Error("Checkout outcome unconfirmed.");
    return publicPurchase(save(intent, received(intent, result.json.purchase)));
  } catch {
    return publicPurchase(save(intent, { ...intent, checkoutState: "unknown", updatedAt: new Date().toISOString() }));
  }
}
