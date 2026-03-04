import type {
  ClientEvent,
  FinishedPayload,
  GameState,
  PlayerSlot,
  ProtocolErrorCode,
  ServerEvent
} from "../domain/messages";

type RoomSession = {
  playerId: string;
  slot?: PlayerSlot;
  socket: WebSocket;
};

export class RoomDO {
  private readonly sessions = new Map<string, RoomSession>();
  private lastMoveBy: PlayerSlot = "P2";

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
        const protocolError: ServerEvent = { type: "error", code: "BAD_REQUEST", message: "Invalid JSON message" };
        this.sendTo(playerId, protocolError);
      }
    });

    socket.addEventListener("close", () => {
      this.sessions.delete(playerId);
    });

    this.sendSnapshot(playerId);
  }

  private onClientEvent(playerId: string, event: ClientEvent): void {
    if (event.type === "ping") {
      const pong: ServerEvent = { type: "pong" };
      this.sendTo(playerId, pong);
      return;
    }

    if (event.type === "join") {
      const session = this.sessions.get(playerId);
      if (!session) {
        return;
      }
      session.slot = event.slot ?? session.slot ?? this.firstFreeSlot();
      if (!session.slot) {
        const roomFull: ServerEvent = { type: "error", code: "ROOM_FULL", message: "Room is full" };
        this.sendTo(playerId, roomFull);
        return;
      }
      this.sendWelcome(playerId, session.slot);
      return;
    }

    if (event.type === "move") {
      this.handleMove(playerId, event.seq, event.move);
    }
  }

  private handleMove(playerId: string, seq: number | undefined, move: { fromRow: number; fromCol: number; toRow: number; toCol: number }): void {
    const session = this.sessions.get(playerId);
    const slot = session?.slot;
    if (!slot) {
      this.sendProtocolError(playerId, "UNAUTHORIZED", "Join room first (slot required).");
      return;
    }

    if (this.state.finished) {
      this.sendProtocolError(playerId, "INVALID_MOVE", "Game is already finished.");
      return;
    }

    if (slot !== this.state.turn) {
      this.sendProtocolError(playerId, "INVALID_MOVE", "It is not this player's turn.");
      return;
    }

    if (seq !== undefined && seq !== this.state.seq) {
      this.sendProtocolError(playerId, "INVALID_MOVE", `Expected seq ${this.state.seq}, got ${seq}.`);
      return;
    }

    void move;
    this.state.seq += 1;
    this.state.turn = this.state.turn === "P1" ? "P2" : "P1";
    this.lastMoveBy = slot;
    const stateEvent: ServerEvent = {
      type: "state",
      seq: this.state.seq,
      state: this.state,
      last_move_by: this.lastMoveBy,
      finished: this.currentFinished()
    };
    this.broadcast(stateEvent);
  }

  private sendProtocolError(
    playerId: string,
    code: ProtocolErrorCode,
    message: string
  ): void {
    const errorEvent: ServerEvent = { type: "error", code, message };
    this.sendTo(playerId, errorEvent);
  }

  private sendWelcome(playerId: string, player: PlayerSlot): void {
    const welcome: ServerEvent = {
      type: "welcome",
      room_id: this.state.roomId,
      player,
      seq: this.state.seq,
      state: this.state
    };
    this.sendTo(playerId, welcome);
  }

  private sendSnapshot(playerId: string): void {
    const snapshot: ServerEvent = {
      type: "state",
      seq: this.state.seq,
      state: this.state,
      last_move_by: this.lastMoveBy,
      finished: this.currentFinished()
    };
    this.sendTo(playerId, snapshot);
  }

  private currentFinished(): FinishedPayload | undefined {
    if (!this.state.finished) {
      return undefined;
    }
    if (!this.state.winnerPlayerId) {
      return { outcome: "Draw" };
    }
    return { outcome: "Winner", winner: this.state.winnerPlayerId };
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
