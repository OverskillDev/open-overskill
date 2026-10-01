import { isMock, provisionCreator } from "@/lib/overskill";
import { creator } from "@/lib/creator-context";
import { acceptCreatorProvision } from "@/lib/creator-provisioning";
import { apiError, apiResponse, inputString, PilotError, readJsonObject, requireSession } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = requireSession(req);
    const body = await readJsonObject(req);
    if (session.provisioned) return apiResponse(session.provisioned, 200, session);
    if (session.provisioning) throw new PilotError(409, "provision_in_progress", "Creator provisioning is already in progress.");
    const name = inputString(body.name ?? `${creator.brand} (Open Overskill pilot)`, "name", 92)!;
    const userEmail = inputString(isMock() ? body.userEmail ?? "creator@example.invalid" : process.env.OPEN_OVERSKILL_CREATOR_EMAIL, "OPEN_OVERSKILL_CREATOR_EMAIL", 254)!.toLowerCase();
    if (!isMock() && body.userEmail !== undefined && body.userEmail !== userEmail) throw new PilotError(400, "creator_identity_fixed", "The local live pilot uses the creator configured on the server.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) throw new PilotError(400, "invalid_email", "Provide a valid creator email.");
    session.provisioning = true;
    try {
      const res = await provisionCreator({ name, userEmail });
      if (res.ok) {
        acceptCreatorProvision(session, res.json, res.mocked ?? false);
        return apiResponse(session.provisioned, res.status, session);
      }
      return apiResponse({ ...res.json, mocked: res.mocked ?? false }, res.status, session);
    } finally { session.provisioning = false; }
  } catch (error) { return apiError(error); }
}
