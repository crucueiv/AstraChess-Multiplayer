export class RoomDO {
  private readonly sessions = new Map<string, WebSocket>();

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, clients: this.sessions.size });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const playerId = url.searchParams.get("playerId");
    if (!playerId) {
      return new Response("playerId is required", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.setupSocket(server, playerId);
    return new Response(null, { status: 101, webSocket: client });
  }

  private setupSocket(socket: WebSocket, playerId: string): void {
    socket.accept();
    this.sessions.set(playerId, socket);
    this.broadcast({ type: "player_joined", playerId });

    socket.addEventListener("message", (event) => {
      this.broadcast({ type: "message", from: playerId, payload: event.data });
    });

    socket.addEventListener("close", () => {
      this.sessions.delete(playerId);
      this.broadcast({ type: "player_left", playerId });
    });
  }

  private broadcast(payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const socket of this.sessions.values()) {
      socket.send(message);
    }
  }
}
