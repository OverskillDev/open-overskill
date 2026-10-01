import { customerAuthInfo, customerError, customerResponse } from "@/lib/customer-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  try { return customerResponse(customerAuthInfo(req)); } catch (error) { return customerError(error); }
}
