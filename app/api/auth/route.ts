import { checkAuth, configInfo, isMock } from "@/lib/overskill";
import { apiError, apiResponse, createSession, findSession, requireSameOrigin, requireSession, sessionCookie } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

// Start a local demo session, or verify the already unlocked live operator.
export async function GET(req: Request) {
  try {
    requireSameOrigin(req);
    const existing = findSession(req);
    const session = isMock() ? existing || createSession(req) : requireSession(req);
    const res = await checkAuth();
    const response = apiResponse({ ...res.json, mocked: res.mocked ?? false, config: configInfo() }, res.status, session);
    if (!existing && isMock()) response.headers.set("Set-Cookie", sessionCookie(session, req));
    return response;
  } catch (error) { return apiError(error); }
}
