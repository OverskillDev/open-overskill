import { customerError, customerResponse, requireCustomer } from "@/lib/customer-auth";
import { generateWorkspaceApp } from "@/lib/customer-workspace";
import { readJsonObject } from "@/lib/pilot-security";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const user = requireCustomer(req, { mutation: true });
    return customerResponse({ app: await generateWorkspaceApp(req, user, await readJsonObject(req)) }, 202);
  } catch (error) { return customerError(error); }
}
