import { logoutCustomer, customerError } from "@/lib/customer-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(req: Request) {
  try { return logoutCustomer(req); } catch (error) { return customerError(error); }
}
