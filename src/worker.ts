import { MatchmakingDO } from "./do/matchmaking-do";
import { RoomDO } from "./do/room-do";
import { PROTOCOL_VERSION } from "@astrachess/contracts";
import { issueSessionToken, verifySessionToken } from "./auth/session";

export { MatchmakingDO, RoomDO };

type Env = {
  MATCHMAKING_DO: DurableObjectNamespace;
  ROOM_DO: DurableObjectNamespace;
  API_KEY?: string;
  SESSION_TOKEN_SECRET?: string;
  ASTRACHESS_ENGINE_URL?: string;
  ARCADE_LINK_URL?: string;
  PROTOCOL_VERSION?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const protocolVersion = env.PROTOCOL_VERSION ?? PROTOCOL_VERSION;

    if (url.pathname === "/health") {
      return withMeta(
        Response.json({
          ok: true,
          service: "astrachess-multiplayer-backend",
          protocolVersion
        }),
        requestId,
        protocolVersion
      );
    }

    if (url.pathname === "/auth/session" && request.method === "POST") {
      if (!env.API_KEY || request.headers.get("x-api-key") !== env.API_KEY) {
        return withMeta(Response.json({ error: "Unauthorized" }, { status: 401 }), requestId, protocolVersion);
      }
      if (!env.SESSION_TOKEN_SECRET) {
        return withMeta(Response.json({ error: "SESSION_TOKEN_SECRET is not configured" }, { status: 500 }), requestId, protocolVersion);
      }
      const body = (await request.json()) as Partial<{ playerId: string; ttlSeconds: number }>;
      if (!body.playerId) {
        return withMeta(Response.json({ error: "playerId is required" }, { status: 400 }), requestId, protocolVersion);
      }
      const token = await issueSessionToken(body.playerId, env.SESSION_TOKEN_SECRET, body.ttlSeconds ?? 3600);
      return withMeta(Response.json({ token, protocolVersion }), requestId, protocolVersion);
    }

    if (url.pathname.startsWith("/matchmaking/") || url.pathname.startsWith("/room/")) {
      const authError = await authorize(request, env);
      if (authError) {
        return withMeta(authError, requestId, protocolVersion);
      }
    }

    if (url.pathname === "/matchmaking/join" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return withMeta(await stub.fetch("https://do.internal/join", request), requestId, protocolVersion);
    }
    if (url.pathname === "/matchmaking/cancel" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return withMeta(await stub.fetch("https://do.internal/cancel", request), requestId, protocolVersion);
    }
    if (url.pathname === "/matchmaking/rematch" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return withMeta(await stub.fetch("https://do.internal/rematch", request), requestId, protocolVersion);
    }

    if (url.pathname.startsWith("/room/")) {
      const roomId = url.pathname.replace("/room/", "");
      if (!roomId) {
        return new Response("roomId is required", { status: 400 });
      }
      const id = env.ROOM_DO.idFromName(roomId);
      const stub = env.ROOM_DO.get(id);
      const roomPath = `/ws${url.search ? url.search : ""}`;
      return stub.fetch(`https://do.internal${roomPath}`, request);
    }

    return withMeta(new Response("Not found", { status: 404 }), requestId, protocolVersion);
  }
};

async function authorize(request: Request, env: Env): Promise<Response | null> {
  if (!env.API_KEY) {
    return Response.json({ error: "API_KEY is not configured" }, { status: 500 });
  }
  const apiKey = request.headers.get("x-api-key");
  if (apiKey === env.API_KEY) {
    return null;
  }
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (token && env.SESSION_TOKEN_SECRET) {
    const verified = await verifySessionToken(token, env.SESSION_TOKEN_SECRET);
    if (verified.ok) {
      return null;
    }
  }
  if (apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function withMeta(response: Response, requestId: string, protocolVersion: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-protocol-version", protocolVersion);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
