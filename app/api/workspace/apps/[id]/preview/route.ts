import { customerError, requireCustomer } from "@/lib/customer-auth";
import { demoPreview } from "@/lib/customer-workspace";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const body = demoPreview(requireCustomer(req), (await ctx.params).id);
    return new Response(body, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    } });
  } catch (error) { return customerError(error); }
}
