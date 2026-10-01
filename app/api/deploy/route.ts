import { deploy } from "@/lib/overskill";
import { apiError, apiResponse, inputString, readJsonObject, requireCreator, requireOwned, requireSession } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

// The upstream response may only confirm queue acceptance, not deployment success.
export async function POST(req: Request) {
  try {
    const session = requireSession(req);
    const body = await readJsonObject(req);
    const appId = inputString(body.appId, "appId", 160)!;
    requireCreator(session);
    requireOwned(session, "app", appId);
    const res = await deploy(session, appId);
    return apiResponse({ ...res.json, mocked: res.mocked ?? false }, res.status, session);
  } catch (error) { return apiError(error); }
}
