import { getMessages } from "@/lib/overskill";
import { apiError, apiResponse, inputString, PilotError, requireOwned, requireSession } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireSession(req);
    const id = inputString(new URL(req.url).searchParams.get("id"), "id", 160)!;
    requireOwned(session, "job", id);
    const res = await getMessages(session, id);
    if (res.ok && !session.apps.has(res.json.app_id)) throw new PilotError(502, "resource_mismatch", "OverSkill returned a different app for this job.");
    return apiResponse({ ...res.json, mocked: res.mocked ?? false }, res.status, session);
  } catch (error) { return apiError(error); }
}
