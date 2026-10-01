import { createDemoCustomer, customerError } from "@/lib/customer-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try { return await createDemoCustomer(req); } catch (error) { return customerError(error); }
}
