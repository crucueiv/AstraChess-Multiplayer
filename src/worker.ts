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
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      return withMeta(new Response(null, { status: 204 }), requestId, protocolVersion, origin);
    }

    if (url.pathname === "/health") {
      return withMeta(
        Response.json({
          ok: true,
          service: "astrachess-multiplayer-backend",
          protocolVersion
        }),
        requestId,
        protocolVersion,
        origin
      );
    }

    if (url.pathname === "/auth/session" && request.method === "POST") {
      if (!env.API_KEY || request.headers.get("x-api-key") !== env.API_KEY) {
        return withMeta(Response.json({ error: "Unauthorized" }, { status: 401 }), requestId, protocolVersion, origin);
      }
      const sessionSecret = resolveSessionSecret(env);
      if (!sessionSecret) {
        return withMeta(Response.json({ error: "SESSION_TOKEN_SECRET or API_KEY must be configured" }, { status: 500 }), requestId, protocolVersion, origin);
      }
      const body = (await request.json()) as Partial<{ playerId: string; ttlSeconds: number }>;
      if (!body.playerId) {
        return withMeta(Response.json({ error: "playerId is required" }, { status: 400 }), requestId, protocolVersion, origin);
      }
      const token = await issueSessionToken(body.playerId, sessionSecret, body.ttlSeconds ?? 3600);
      return withMeta(Response.json({ token, protocolVersion }), requestId, protocolVersion, origin);
    }

    if (url.pathname.startsWith("/matchmaking/") || url.pathname.startsWith("/room/")) {
      const authError = await authorize(request, env);
      if (authError) {
        return withMeta(authError, requestId, protocolVersion, origin);
      }
    }

    if (url.pathname === "/matchmaking/join" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return withMeta(await stub.fetch("https://do.internal/join", request), requestId, protocolVersion, origin);
    }
    if (url.pathname === "/matchmaking/cancel" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return withMeta(await stub.fetch("https://do.internal/cancel", request), requestId, protocolVersion, origin);
    }
    if (url.pathname === "/matchmaking/rematch" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return withMeta(await stub.fetch("https://do.internal/rematch", request), requestId, protocolVersion, origin);
    }
    if (url.pathname === "/matchmaking/status" && request.method === "GET") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return withMeta(await stub.fetch(`https://do.internal/status${url.search}`, request), requestId, protocolVersion, origin);
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

    return withMeta(new Response("Not found", { status: 404 }), requestId, protocolVersion, origin);
  }
};

async function authorize(request: Request, env: Env): Promise<Response | null> {
  const auth = request.headers.get("authorization");
  const url = new URL(request.url);
  const tokenFromHeader = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const tokenFromQuery = url.searchParams.get("access_token") ?? "";
  const token = tokenFromHeader || tokenFromQuery;
  const sessionSecret = resolveSessionSecret(env);
  if (!sessionSecret) {
    return Response.json({ error: "SESSION_TOKEN_SECRET or API_KEY must be configured" }, { status: 500 });
  }
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await verifySessionToken(token, sessionSecret);
  if (!verified.ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function withMeta(response: Response, requestId: string, protocolVersion: string, origin?: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-protocol-version", protocolVersion);
  headers.set("access-control-allow-origin", origin ?? "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,x-api-key,authorization,x-request-id");
  headers.set("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function resolveSessionSecret(env: Env): string | undefined {
  return env.SESSION_TOKEN_SECRET ?? env.API_KEY;
}
