import { customerError, customerResponse, requireCustomer } from "@/lib/customer-auth";
import { workspaceHome } from "@/lib/customer-workspace";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try { return customerResponse(workspaceHome(requireCustomer(req))); }
  catch (error) { return customerError(error); }
}
