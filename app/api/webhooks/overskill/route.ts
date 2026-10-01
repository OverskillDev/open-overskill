import { apiResponse } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

export async function POST() {
  return apiResponse({ error: "Callbacks are disabled in the local pilot. Use authenticated status polling.", code: "callbacks_disabled" }, 410);
}
