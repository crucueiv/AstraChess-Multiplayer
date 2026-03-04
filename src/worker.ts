import { MatchmakingDO } from "./do/matchmaking-do";
import { RoomDO } from "./do/room-do";

export { MatchmakingDO, RoomDO };

type Env = {
  MATCHMAKING_DO: DurableObjectNamespace;
  ROOM_DO: DurableObjectNamespace;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "astrachess-multiplayer-backend" });
    }

    if (url.pathname === "/matchmaking/join" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return stub.fetch("https://do.internal/join", request);
    }
    if (url.pathname === "/matchmaking/cancel" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return stub.fetch("https://do.internal/cancel", request);
    }
    if (url.pathname === "/matchmaking/rematch" && request.method === "POST") {
      const id = env.MATCHMAKING_DO.idFromName("global-queue");
      const stub = env.MATCHMAKING_DO.get(id);
      return stub.fetch("https://do.internal/rematch", request);
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

    return new Response("Not found", { status: 404 });
  }
};
