import { CreditAccountError, creatorCreditTeamId, hasUsableCreditSnapshot, readCreditAccountSnapshot } from "@/lib/credit-account";
import { generate, getCreatorUsage, getUsage } from "@/lib/overskill";
import { creator, contextAsMarkdown, attribution } from "@/lib/creator-context";
import { apiError, apiResponse, inputString, PilotError, readJsonObject, rememberGeneration, requireCreator, requireGenerationCapacity, requireOwned, requireSession } from "@/lib/pilot-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = requireSession(req);
    const body = await readJsonObject(req);
    if ((body.creditResponsibility !== undefined && body.creditResponsibility !== "creator_workspace") ||
        "sponsorTeamId" in body || "payerTeamId" in body) {
      throw new PilotError(422, "unsupported_credit_responsibility", "This starter charges the creator workspace. Partner sponsorship is not supported.");
    }
    const prompt = inputString(body.prompt, "prompt", 10_000)!;
    const appId = inputString(body.appId, "appId", 160, false);
    const thinkingEffort = inputString(body.thinkingEffort, "thinkingEffort", 16, false);
    if (thinkingEffort && !["low", "medium", "high"].includes(thinkingEffort)) throw new PilotError(400, "invalid_input", "thinkingEffort must be low, medium, or high.");
    requireCreator(session);
    requireGenerationCapacity(session);
    if (appId) requireOwned(session, "app", appId);
    const credits = await readCreditAccountSnapshot(creatorCreditTeamId(session.provisioned), () => getCreatorUsage(session), () => getUsage(session), { simulated: session.mode === "demo" });
    if (!hasUsableCreditSnapshot(credits)) throw new PilotError(503, "credit_usage_unavailable", "Usage information is unavailable. Refresh usage and credits before requesting a build. No build was requested.");
    // The session may have been locked or capacity consumed while the read waited.
    if (requireSession(req) !== session) throw new PilotError(401, "operator_session_required", "Unlock the builder to continue.");
    requireCreator(session);
    requireGenerationCapacity(session);
    const res = await generate(session, { prompt, appId, name: `${creator.brand} — app`, partnerContext: contextAsMarkdown(), attribution, thinkingEffort });
    if (res.ok) rememberGeneration(session, res.json);
    return apiResponse({ ...res.json, mocked: res.mocked ?? false }, res.status, session);
  } catch (error) { return apiError(error instanceof CreditAccountError ? new PilotError(502, error.code, error.message) : error); }
}
