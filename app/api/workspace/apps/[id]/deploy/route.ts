import { customerError, customerResponse, requireCustomer } from "@/lib/customer-auth";
import { deployWorkspaceApp } from "@/lib/customer-workspace";
import { readJsonObject } from "@/lib/pilot-security";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = requireCustomer(req, { mutation: true });
    await readJsonObject(req);
    return customerResponse({ app: await deployWorkspaceApp(req, user, (await ctx.params).id) }, 202);
  } catch (error) { return customerError(error); }
}
