import { PROTOCOL_VERSION, type EngineMoveRequest, type EngineMoveResponse } from "@astrachess/contracts";

type NativeEnv = {
  ASTRACHESS_ENGINE_URL?: string;
  ARCADE_LINK_URL?: string;
};

export async function validateMoveWithEngine(
  env: NativeEnv,
  requestId: string,
  payload: EngineMoveRequest
): Promise<EngineMoveResponse | null> {
  if (!env.ASTRACHESS_ENGINE_URL) {
    return null;
  }
  const response = await fetch(`${env.ASTRACHESS_ENGINE_URL}/moves/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    },
    body: JSON.stringify({ version: PROTOCOL_VERSION, ...payload })
  });
  if (!response.ok) {
    throw new Error(`Engine validation failed (${response.status})`);
  }
  return (await response.json()) as EngineMoveResponse;
}

export async function attachArcadeLinkSession(
  env: NativeEnv,
  requestId: string,
  payload: { roomId: string; playerId: string; reconnectToken: string }
): Promise<void> {
  if (!env.ARCADE_LINK_URL) {
    return;
  }
  const response = await fetch(`${env.ARCADE_LINK_URL}/sessions/attach`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    },
    body: JSON.stringify({ version: PROTOCOL_VERSION, ...payload })
  });
  if (!response.ok) {
    throw new Error(`arcade-link attach failed (${response.status})`);
  }
}
