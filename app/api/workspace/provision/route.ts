import { customerError, customerResponse, requireCustomer } from "@/lib/customer-auth";
import { provisionWorkspace } from "@/lib/customer-workspace";
import { readJsonObject } from "@/lib/pilot-security";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const user = requireCustomer(req, { mutation: true });
    await readJsonObject(req);
    return customerResponse(await provisionWorkspace(req, user));
  } catch (error) { return customerError(error); }
}
