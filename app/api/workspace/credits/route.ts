import { customerError, customerResponse, requireCustomer } from "@/lib/customer-auth";
import { workspaceCredits } from "@/lib/customer-workspace";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try { return customerResponse(await workspaceCredits(requireCustomer(req))); }
  catch (error) { return customerError(error); }
}
