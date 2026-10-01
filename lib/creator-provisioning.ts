import { PilotError, redactSecrets, requireExternalCreatorId, type PilotSession } from "./pilot-security";
import type { ProvisionResponse } from "./types";

const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

// Accept credentials only after checking the identity returned by the hosted
// API. This state stays in the server process; the browser gets a redacted copy.
export function acceptCreatorProvision(session: PilotSession, response: ProvisionResponse, mocked: boolean, recovering = false, expectedExternalCreatorId?: string) {
  const key = response?.api_key?.key;
  const hasKey = typeof key === "string" && key.length > 0;
  if (!positiveId(response?.team?.id)) throw invalidResponse();
  if (!mocked) {
    const creator = response.creator;
    const apiKey = response.api_key;
    if (!positiveId(creator?.id) || creator?.external_creator_id !== (expectedExternalCreatorId ?? requireExternalCreatorId()) ||
        !positiveId(apiKey?.id) || apiKey?.scope !== "read_write" ||
        (!hasKey && !(response.replayed === true && apiKey.key === null && apiKey.recovery_required === true))) {
      throw invalidResponse();
    }
    const previous = session.creatorBinding;
    if (previous && (previous.id !== creator!.id || previous.teamId !== response.team.id || previous.externalId !== creator!.external_creator_id)) throw invalidResponse();
    if (recovering && (!previous || !hasKey || previous.keyId === apiKey!.id)) throw invalidResponse();
    session.creatorBinding = { id: creator!.id, keyId: apiKey!.id!, externalId: creator!.external_creator_id, teamId: response.team.id };
  } else if (!hasKey) {
    throw new PilotError(502, "creator_key_missing", "The demo did not issue a creator key.");
  }
  if (hasKey) session.creatorKey = key;
  session.provisioned = redactSecrets({ ...response, mocked, recoveryRequired: !session.creatorKey }, hasKey ? [key] : []) as Record<string, unknown>;
  return session.provisioned;
}

function invalidResponse() {
  return new PilotError(502, "invalid_creator_response", "The API did not return the expected creator identity and key metadata. Building is disabled; check the backend contract before retrying.");
}
