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

type RoomSnapshot = {
  state: GameState;
  lastMoveBy: PlayerSlot;
};

const SNAPSHOT_STORAGE_KEY = "room:snapshot";
const SLOT_ASSIGNMENTS_STORAGE_KEY = "room:slotAssignments";

export class RoomDO {
  private readonly sessions = new Map<string, RoomSession>();
  private readonly slotAssignments = new Map<string, PlayerSlot>();
  private lastMoveBy: PlayerSlot = "P2";
  private hydrated = false;
  private joinCount = 0;
  private moveCount = 0;
  private reconnectCount = 0;
  private protocolErrorCount = 0;

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
    await this.ensureHydrated();
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        clients: this.sessions.size,
        seq: this.state.seq,
        counters: {
          join: this.joinCount,
          move: this.moveCount,
          reconnect: this.reconnectCount,
          protocolError: this.protocolErrorCount
        }
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const playerId = url.searchParams.get("playerId");
    if (!playerId) {
      return new Response("playerId is required", { status: 400 });
    }

    const roomId = url.searchParams.get("roomId") ?? "room";
    if (this.state.roomId !== roomId) {
      this.state.roomId = roomId;
      void this.persistSnapshot();
    }

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
      this.joinCount += 1;
      const session = this.sessions.get(playerId);
      if (!session) {
        return;
      }
      const isReconnect = !session.slot && this.slotAssignments.has(playerId);
      if (isReconnect) {
        this.reconnectCount += 1;
      }
      const requestedSlot = event.slot ?? session.slot ?? this.slotAssignments.get(playerId) ?? this.firstFreeSlot();
      if (!requestedSlot) {
        const roomFull: ServerEvent = { type: "error", code: "ROOM_FULL", message: "Room is full" };
        this.sendTo(playerId, roomFull);
        return;
      }
      const owner = this.ownerOfSlot(requestedSlot);
      if (owner && owner !== playerId) {
        const roomFull: ServerEvent = { type: "error", code: "ROOM_FULL", message: "Requested slot is occupied" };
        this.sendTo(playerId, roomFull);
        return;
      }
      session.slot = requestedSlot;
      if (!session.slot) {
        const roomFull: ServerEvent = { type: "error", code: "ROOM_FULL", message: "Room is full" };
        this.sendTo(playerId, roomFull);
        return;
      }
      this.slotAssignments.set(playerId, session.slot);
      void this.persistSlotAssignments();
      this.log("join", { playerId, slot: session.slot, reconnect: isReconnect });
      this.sendWelcome(playerId, session.slot);
      return;
    }

    if (event.type === "move") {
      this.moveCount += 1;
      this.log("move", { playerId, seq: event.seq ?? null });
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
    void this.persistSnapshot();
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
    this.protocolErrorCount += 1;
    this.log("error", { playerId, code, message });
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
    for (const assigned of this.slotAssignments.values()) {
      used.add(assigned);
    }
    if (!used.has("P1")) {
      return "P1";
    }
    if (!used.has("P2")) {
      return "P2";
    }
    return undefined;
  }

  private ownerOfSlot(slot: PlayerSlot): string | undefined {
    for (const [playerId, assignedSlot] of this.slotAssignments.entries()) {
      if (assignedSlot === slot) {
        return playerId;
      }
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

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) {
      return;
    }
    await this.durableState.blockConcurrencyWhile(async () => {
      if (this.hydrated) {
        return;
      }
      const [snapshot, assignments] = await Promise.all([
        this.durableState.storage.get<RoomSnapshot>(SNAPSHOT_STORAGE_KEY),
        this.durableState.storage.get<Record<string, PlayerSlot>>(SLOT_ASSIGNMENTS_STORAGE_KEY)
      ]);
      if (snapshot) {
        Object.assign(this.state, snapshot.state);
        this.lastMoveBy = snapshot.lastMoveBy;
      }
      this.slotAssignments.clear();
      if (assignments) {
        for (const [playerId, slot] of Object.entries(assignments)) {
          this.slotAssignments.set(playerId, slot);
        }
      }
      this.hydrated = true;
    });
  }

  private async persistSnapshot(): Promise<void> {
    const snapshot: RoomSnapshot = {
      state: this.state,
      lastMoveBy: this.lastMoveBy
    };
    await this.durableState.storage.put(SNAPSHOT_STORAGE_KEY, snapshot);
  }

  private async persistSlotAssignments(): Promise<void> {
    const data = Object.fromEntries(this.slotAssignments.entries());
    await this.durableState.storage.put(SLOT_ASSIGNMENTS_STORAGE_KEY, data);
  }

  private log(event: "join" | "move" | "error", data: Record<string, unknown>): void {
    console.log(JSON.stringify({ component: "room", roomId: this.state.roomId, event, ...data }));
  }
}
