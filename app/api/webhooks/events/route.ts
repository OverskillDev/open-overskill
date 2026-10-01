import { apiError, apiResponse, inputString, requireOwned, requireSession } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireSession(req);
    const appId = inputString(new URL(req.url).searchParams.get("appId"), "appId", 160)!;
    requireOwned(session, "app", appId);
    return apiResponse({ appId, events: [], enabled: false, reason: "Polling only in the local pilot." });
  } catch (error) { return apiError(error); }
}
