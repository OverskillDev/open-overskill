import { getCreatorUsage, getUsage } from "@/lib/overskill";
import { CreditAccountError, creatorCreditTeamId, readCreditAccountSnapshot } from "@/lib/credit-account";
import { apiError, apiResponse, PilotError, requireCreator, requireSession } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

/** Read-only: no account creation, funding, ledger reconciliation or billing-setting changes. */
export async function GET(req: Request) {
  try {
    const session = requireSession(req);
    requireCreator(session);
    const teamId = creatorCreditTeamId(session.provisioned);
    const snapshot = await readCreditAccountSnapshot(teamId, () => getCreatorUsage(session), () => getUsage(session), { simulated: session.mode === "demo" });
    return apiResponse(snapshot, 200, session);
  } catch (error) {
    return apiError(error instanceof CreditAccountError ? new PilotError(502, error.code, error.message) : error);
  }
}
