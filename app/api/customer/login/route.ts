import { beginCustomerLogin, customerError } from "@/lib/customer-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try { return await beginCustomerLogin(req); } catch (error) { return customerError(error); }
}
