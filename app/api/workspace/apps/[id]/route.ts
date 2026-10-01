import { customerError, customerResponse, requireCustomer } from "@/lib/customer-auth";
import { readWorkspaceApp } from "@/lib/customer-workspace";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { return customerResponse({ app: await readWorkspaceApp(requireCustomer(req), (await ctx.params).id) }); }
  catch (error) { return customerError(error); }
}
