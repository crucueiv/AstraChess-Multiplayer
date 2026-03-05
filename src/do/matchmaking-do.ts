type QueueEntry = {
  playerId: string;
  requestId: string;
  createdAt: number;
};

type RematchEntry = {
  playerId: string;
  requestId: string;
  createdAt: number;
};

const QUEUE_STORAGE_KEY = "queue";
const REMATCH_STORAGE_PREFIX = "rematch:";
const REQUEST_STATUS_STORAGE_PREFIX = "request-status:";
const PLAYER_STATUS_STORAGE_PREFIX = "player-status:";
const QUEUE_TIMEOUT_MS = 30_000;
const REMATCH_TIMEOUT_MS = 60_000;

type MatchmakingStatus = "queued" | "matched" | "cancelled" | "timed_out";

type MatchmakingStatusRecord = {
  requestId: string;
  playerId: string;
  status: MatchmakingStatus;
  updatedAt: number;
  roomId?: string;
};

export class MatchmakingDO {
  private joinCount = 0;
  private cancelCount = 0;
  private rematchCount = 0;
  private timeoutCount = 0;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env?: { ASTRACHESS_ENGINE_URL?: string }
  ) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (request.method === "POST" && pathname === "/join") {
      this.joinCount += 1;
      const body = (await request.json()) as Partial<{ playerId: string; requestId: string }>;
      if (!body.playerId) {
        return Response.json({ error: "playerId is required" }, { status: 400 });
      }

      const now = Date.now();
      const requestId = body.requestId ?? crypto.randomUUID();
      const queue = await this.pruneQueueAndTrack((await this.state.storage.get<QueueEntry[]>(QUEUE_STORAGE_KEY)) ?? [], now);
      const dedupedQueue = queue.filter((entry) => entry.playerId !== body.playerId);
      dedupedQueue.push({ playerId: body.playerId, requestId, createdAt: now });

      if (dedupedQueue.length >= 2) {
        const first = dedupedQueue.shift()!;
        const second = dedupedQueue.shift()!;
        await this.state.storage.put(QUEUE_STORAGE_KEY, dedupedQueue);
        const roomId = `${first.playerId}-${second.playerId}-${Date.now()}`;
        const requestIdForEngine = crypto.randomUUID();
        void createGameWithEngine(this.env ?? {}, requestIdForEngine, {
          roomId,
          players: [first.playerId, second.playerId]
        }).catch((error: unknown) => {
          console.error(
            JSON.stringify({
              component: "matchmaking",
              event: "engine_create_error",
              roomId,
              message: String(error)
            })
          );
        });
        await Promise.all([
          this.setRequestStatus(first.requestId, first.playerId, "matched", now, roomId),
          this.setRequestStatus(second.requestId, second.playerId, "matched", now, roomId)
        ]);
        const response = {
          protocolVersion: PROTOCOL_VERSION,
          matched: true,
          roomId,
          players: [first.playerId, second.playerId],
          requestId
        };
        this.log("join", { status: "matched", playerId: body.playerId, roomId });
        return Response.json(response);
      }

      await this.state.storage.put(QUEUE_STORAGE_KEY, dedupedQueue);
      await this.setRequestStatus(requestId, body.playerId, "queued", now);
      const response = {
        protocolVersion: PROTOCOL_VERSION,
        matched: false,
        status: "queued",
        requestId,
        timeoutMs: QUEUE_TIMEOUT_MS,
        expiresAt: now + QUEUE_TIMEOUT_MS
      };
      this.log("join", { status: "queued", playerId: body.playerId, requestId });
      return Response.json(response);
    }

    if (request.method === "POST" && pathname === "/cancel") {
      this.cancelCount += 1;
      const body = (await request.json()) as Partial<{ playerId: string; requestId: string }>;
      if (!body.playerId) {
        return Response.json({ error: "playerId is required" }, { status: 400 });
      }

      const now = Date.now();
      const queue = await this.pruneQueueAndTrack((await this.state.storage.get<QueueEntry[]>(QUEUE_STORAGE_KEY)) ?? [], now);
      const matchIndex = queue.findIndex(
        (entry) => entry.playerId === body.playerId && (!body.requestId || entry.requestId === body.requestId)
      );

      if (matchIndex === -1) {
        await this.state.storage.put(QUEUE_STORAGE_KEY, queue);
        const existing = body.requestId ? await this.getRequestStatus(body.requestId) : await this.getPlayerStatus(body.playerId);
        if (existing?.status === "timed_out") {
          this.log("cancel", { status: "timed_out", playerId: body.playerId, requestId: existing.requestId });
          return Response.json({ cancelled: false, status: "timed_out", requestId: existing.requestId });
        }
        this.log("cancel", { status: "not_found", playerId: body.playerId });
        return Response.json({ cancelled: false, status: "not_found" });
      }

      const [entry] = queue.splice(matchIndex, 1);
      await this.state.storage.put(QUEUE_STORAGE_KEY, queue);
      if (this.isExpired(entry, now, QUEUE_TIMEOUT_MS)) {
        this.timeoutCount += 1;
        await this.setRequestStatus(entry.requestId, entry.playerId, "timed_out", now);
        this.log("cancel", { status: "timed_out", playerId: body.playerId, requestId: entry.requestId });
        return Response.json({ cancelled: false, status: "timed_out", requestId: entry.requestId });
      }
      await this.setRequestStatus(entry.requestId, entry.playerId, "cancelled", now);
      this.log("cancel", { status: "cancelled", playerId: body.playerId, requestId: entry.requestId });
      return Response.json({ cancelled: true, status: "cancelled", requestId: entry.requestId });
    }

    if (request.method === "POST" && pathname === "/rematch") {
      this.rematchCount += 1;
      const body = (await request.json()) as Partial<{ roomId: string; playerId: string; requestId: string }>;
      if (!body.roomId || !body.playerId) {
        return Response.json({ error: "roomId and playerId are required" }, { status: 400 });
      }

      const now = Date.now();
      const requestId = body.requestId ?? crypto.randomUUID();
      const storageKey = `${REMATCH_STORAGE_PREFIX}${body.roomId}`;
      const rematchQueue = this.pruneRematchQueue((await this.state.storage.get<RematchEntry[]>(storageKey)) ?? [], now);
      const dedupedQueue = rematchQueue.filter((entry) => entry.playerId !== body.playerId);
      dedupedQueue.push({ playerId: body.playerId, requestId, createdAt: now });

      if (dedupedQueue.length >= 2) {
        const first = dedupedQueue.shift()!;
        const second = dedupedQueue.shift()!;
        await this.state.storage.put(storageKey, dedupedQueue);
        const roomId = `${body.roomId}-rematch-${now}`;
        const response = {
          protocolVersion: PROTOCOL_VERSION,
          matched: true,
          roomId,
          players: [first.playerId, second.playerId],
          requestId
        };
        this.log("rematch", { status: "matched", roomId, playerId: body.playerId });
        return Response.json(response);
      }

      await this.state.storage.put(storageKey, dedupedQueue);
      const response = {
        protocolVersion: PROTOCOL_VERSION,
        matched: false,
        status: "waiting_rematch",
        requestId,
        timeoutMs: REMATCH_TIMEOUT_MS,
        expiresAt: now + REMATCH_TIMEOUT_MS
      };
      this.log("rematch", { status: "waiting_rematch", roomId: body.roomId, playerId: body.playerId, requestId });
      return Response.json(response);
    }

    if (request.method === "GET" && pathname === "/status") {
      const url = new URL(request.url);
      const requestId = url.searchParams.get("requestId");
      const playerId = url.searchParams.get("playerId");
      if (!requestId && !playerId) {
        return Response.json({ error: "requestId or playerId is required" }, { status: 400 });
      }
      if (requestId) {
        const status = await this.getRequestStatus(requestId);
        return Response.json(status ? { found: true, ...status } : { found: false, requestId });
      }
      const status = await this.getPlayerStatus(playerId!);
      return Response.json(status ? { found: true, ...status } : { found: false, playerId });
    }

    if (request.method === "GET" && pathname === "/health") {
      return Response.json({
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        queueDepth: ((await this.state.storage.get<QueueEntry[]>(QUEUE_STORAGE_KEY)) ?? []).length,
        counters: {
          join: this.joinCount,
          cancel: this.cancelCount,
          rematch: this.rematchCount,
          timeout: this.timeoutCount
        }
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async pruneQueueAndTrack(queue: QueueEntry[], now: number): Promise<QueueEntry[]> {
    const active: QueueEntry[] = [];
    for (const entry of queue) {
      if (this.isExpired(entry, now, QUEUE_TIMEOUT_MS)) {
        this.timeoutCount += 1;
        await this.setRequestStatus(entry.requestId, entry.playerId, "timed_out", now);
      } else {
        active.push(entry);
      }
    }
    return active;
  }

  private pruneRematchQueue(queue: RematchEntry[], now: number): RematchEntry[] {
    return queue.filter((entry) => !this.isExpired(entry, now, REMATCH_TIMEOUT_MS));
  }

  private isExpired(entry: { createdAt: number }, now: number, timeoutMs: number): boolean {
    return now - entry.createdAt >= timeoutMs;
  }

  private async setRequestStatus(
    requestId: string,
    playerId: string,
    status: MatchmakingStatus,
    updatedAt: number,
    roomId?: string
  ): Promise<void> {
    const record: MatchmakingStatusRecord = { requestId, playerId, status, updatedAt, ...(roomId ? { roomId } : {}) };
    await this.state.storage.put(`${REQUEST_STATUS_STORAGE_PREFIX}${requestId}`, record);
    await this.state.storage.put(`${PLAYER_STATUS_STORAGE_PREFIX}${playerId}`, record);
  }

  private getRequestStatus(requestId: string): Promise<MatchmakingStatusRecord | undefined> {
    return this.state.storage.get<MatchmakingStatusRecord>(`${REQUEST_STATUS_STORAGE_PREFIX}${requestId}`);
  }

  private getPlayerStatus(playerId: string): Promise<MatchmakingStatusRecord | undefined> {
    return this.state.storage.get<MatchmakingStatusRecord>(`${PLAYER_STATUS_STORAGE_PREFIX}${playerId}`);
  }

  private log(event: "join" | "cancel" | "rematch", data: Record<string, unknown>): void {
    console.log(JSON.stringify({ component: "matchmaking", event, ...data }));
  }
}
import { PROTOCOL_VERSION } from "@astrachess/contracts";
import { createGameWithEngine } from "../integrations/native-clients";
