import type {
  ApplyMoveRequest,
  ApplyMoveResult,
  ClientEvent,
  GameState,
  PlayerSlot,
  ServerEvent
} from "../domain/messages";

type RoomSession = {
  playerId: string;
  slot?: PlayerSlot;
  socket: WebSocket;
};

export class RoomDO {
  private readonly sessions = new Map<string, RoomSession>();

  private readonly state: GameState = {
    roomId: "",
    seq: 0,
    turn: "P1",
    inCheck: false,
    checkmate: false,
    stalemate: false,
    finished: false,
    winnerPlayerId: "",
    pieces: [],
    legalMoves: []
  };

  constructor(private readonly durableState: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, clients: this.sessions.size, seq: this.state.seq });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const playerId = url.searchParams.get("playerId");
    if (!playerId) {
      return new Response("playerId is required", { status: 400 });
    }

    const roomId = url.searchParams.get("roomId") ?? "room";
    this.state.roomId = roomId;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.setupSocket(server, playerId);
    return new Response(null, { status: 101, webSocket: client });
  }

  private setupSocket(socket: WebSocket, playerId: string): void {
    socket.accept();
    this.sessions.set(playerId, { playerId, socket });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as ClientEvent;
        this.onClientEvent(playerId, msg);
      } catch {
        this.sendTo(playerId, { type: "error", message: "Invalid JSON message" });
      }
    });

    socket.addEventListener("close", () => {
      this.sessions.delete(playerId);
    });

    this.sendState(playerId);
  }

  private onClientEvent(playerId: string, event: ClientEvent): void {
    if (event.type === "ping") {
      this.sendTo(playerId, { type: "pong" });
      return;
    }

    if (event.type === "join") {
      const session = this.sessions.get(playerId);
      if (!session) {
        return;
      }
      session.slot = event.slot ?? session.slot ?? this.firstFreeSlot();
      if (!session.slot) {
        this.sendTo(playerId, { type: "error", message: "Room is full" });
        return;
      }
      this.sendState(playerId);
      return;
    }

    if (event.type === "apply_move") {
      this.handleApplyMove(playerId, event.payload);
    }
  }

  private handleApplyMove(playerId: string, req: ApplyMoveRequest): void {
    const session = this.sessions.get(playerId);
    const slot = session?.slot;
    if (!slot) {
      this.sendRejected(playerId, "UNAUTHORIZED", "Join room first (slot required).");
      return;
    }

    if (this.state.finished) {
      this.sendRejected(playerId, "ROOM_NOT_READY", "Game is already finished.");
      return;
    }

    if (slot !== this.state.turn) {
      this.sendRejected(playerId, "UNAUTHORIZED", "It is not this player's turn.");
      return;
    }

    if (req.seq !== this.state.seq) {
      this.sendRejected(playerId, "INVALID_MOVE", `Expected seq ${this.state.seq}, got ${req.seq}.`);
      return;
    }

    this.state.seq += 1;
    this.state.turn = this.state.turn === "P1" ? "P2" : "P1";

    const accepted: ApplyMoveResult = { accepted: true, state: this.state };
    this.broadcast({ type: "move_accepted", payload: accepted });
    this.broadcast({ type: "room_state", payload: this.state });
  }

  private sendRejected(
    playerId: string,
    errorCode: "UNAUTHORIZED" | "ROOM_NOT_READY" | "INVALID_MOVE",
    message: string
  ): void {
    const rejected: ApplyMoveResult = {
      accepted: false,
      errorCode,
      message,
      state: this.state
    };
    this.sendTo(playerId, { type: "move_rejected", payload: rejected });
  }

  private sendState(playerId: string): void {
    this.sendTo(playerId, { type: "room_state", payload: this.state });
  }

  private firstFreeSlot(): PlayerSlot | undefined {
    const used = new Set<PlayerSlot>();
    for (const s of this.sessions.values()) {
      if (s.slot) {
        used.add(s.slot);
      }
    }
    if (!used.has("P1")) {
      return "P1";
    }
    if (!used.has("P2")) {
      return "P2";
    }
    return undefined;
  }

  private sendTo(playerId: string, event: ServerEvent): void {
    const session = this.sessions.get(playerId);
    if (!session) {
      return;
    }
    session.socket.send(JSON.stringify(event));
  }

  private broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const session of this.sessions.values()) {
      session.socket.send(data);
    }
  }
}
