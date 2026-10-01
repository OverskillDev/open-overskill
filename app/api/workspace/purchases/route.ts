import { customerError, customerResponse, requireCustomer } from "@/lib/customer-auth";
import { createWorkspacePurchase, readWorkspacePurchase } from "@/lib/customer-purchases";
import { readJsonObject } from "@/lib/pilot-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try { return customerResponse({ purchase: await readWorkspacePurchase(requireCustomer(req)) }); }
  catch (error) { return customerError(error); }
}
export async function POST(req: Request) {
  try { const user = requireCustomer(req, { mutation: true }); return customerResponse({ purchase: await createWorkspacePurchase(req, user, await readJsonObject(req, 2000)) }); }
  catch (error) { return customerError(error); }
}
