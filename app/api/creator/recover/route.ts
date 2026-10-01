import { recoverCreatorKey } from "@/lib/overskill";
import { acceptCreatorProvision } from "@/lib/creator-provisioning";
import { apiError, apiResponse, PilotError, readJsonObject, requireSession } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = requireSession(req);
    const body = await readJsonObject(req);
    if (Object.keys(body).length) throw new PilotError(400, "invalid_recovery_request", "Creator recovery uses this session's server-side identity only.");
    if (session.provisioning) throw new PilotError(409, "provision_in_progress", "Creator provisioning is already in progress.");
    session.provisioning = true;
    try {
      const result = await recoverCreatorKey(session);
      if (result.ok) acceptCreatorProvision(session, result.json, false, true);
      return apiResponse(result.ok ? session.provisioned : { ...result.json, recoveryRequired: true }, result.status, session);
    } finally { session.provisioning = false; }
  } catch (error) { return apiError(error); }
}
