import { apiError, apiResponse, createSession, destroySession, isDemoMode, readJsonObject, requireSameOrigin, sessionCookie, verifyOperatorToken, SESSION_COOKIE } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    const body = await readJsonObject(req, 2_000);
    if (!isDemoMode()) verifyOperatorToken(body.token);
    destroySession(req);
    const session = createSession(req);
    const response = apiResponse({ authenticated: true, mocked: isDemoMode() });
    response.headers.set("Set-Cookie", sessionCookie(session, req));
    return response;
  } catch (error) { return apiError(error); }
}

export async function DELETE(req: Request) {
  try {
    requireSameOrigin(req);
    destroySession(req);
    const response = apiResponse({ authenticated: false });
    response.headers.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return response;
  } catch (error) { return apiError(error); }
}
