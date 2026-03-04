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
const QUEUE_TIMEOUT_MS = 30_000;
const REMATCH_TIMEOUT_MS = 60_000;

export class MatchmakingDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (request.method === "POST" && pathname === "/join") {
      const body = (await request.json()) as Partial<{ playerId: string; requestId: string }>;
      if (!body.playerId) {
        return Response.json({ error: "playerId is required" }, { status: 400 });
      }

      const now = Date.now();
      const requestId = body.requestId ?? crypto.randomUUID();
      const queue = this.pruneQueue((await this.state.storage.get<QueueEntry[]>(QUEUE_STORAGE_KEY)) ?? [], now);
      const dedupedQueue = queue.filter((entry) => entry.playerId !== body.playerId);
      dedupedQueue.push({ playerId: body.playerId, requestId, createdAt: now });

      if (dedupedQueue.length >= 2) {
        const first = dedupedQueue.shift()!;
        const second = dedupedQueue.shift()!;
        await this.state.storage.put(QUEUE_STORAGE_KEY, dedupedQueue);
        const roomId = `${first.playerId}-${second.playerId}-${Date.now()}`;
        return Response.json({
          matched: true,
          roomId,
          players: [first.playerId, second.playerId],
          requestId
        });
      }

      await this.state.storage.put(QUEUE_STORAGE_KEY, dedupedQueue);
      return Response.json({
        matched: false,
        status: "queued",
        requestId,
        timeoutMs: QUEUE_TIMEOUT_MS,
        expiresAt: now + QUEUE_TIMEOUT_MS
      });
    }

    if (request.method === "POST" && pathname === "/cancel") {
      const body = (await request.json()) as Partial<{ playerId: string; requestId: string }>;
      if (!body.playerId) {
        return Response.json({ error: "playerId is required" }, { status: 400 });
      }

      const now = Date.now();
      const queue = (await this.state.storage.get<QueueEntry[]>(QUEUE_STORAGE_KEY)) ?? [];
      const matchIndex = queue.findIndex(
        (entry) => entry.playerId === body.playerId && (!body.requestId || entry.requestId === body.requestId)
      );

      if (matchIndex === -1) {
        const pruned = this.pruneQueue(queue, now);
        await this.state.storage.put(QUEUE_STORAGE_KEY, pruned);
        return Response.json({ cancelled: false, status: "not_found" });
      }

      const [entry] = queue.splice(matchIndex, 1);
      const prunedQueue = this.pruneQueue(queue, now);
      await this.state.storage.put(QUEUE_STORAGE_KEY, prunedQueue);
      if (this.isExpired(entry, now, QUEUE_TIMEOUT_MS)) {
        return Response.json({ cancelled: false, status: "timed_out", requestId: entry.requestId });
      }
      return Response.json({ cancelled: true, status: "cancelled", requestId: entry.requestId });
    }

    if (request.method === "POST" && pathname === "/rematch") {
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
        return Response.json({
          matched: true,
          roomId,
          players: [first.playerId, second.playerId],
          requestId
        });
      }

      await this.state.storage.put(storageKey, dedupedQueue);
      return Response.json({
        matched: false,
        status: "waiting_rematch",
        requestId,
        timeoutMs: REMATCH_TIMEOUT_MS,
        expiresAt: now + REMATCH_TIMEOUT_MS
      });
    }

    if (request.method === "GET" && pathname === "/health") {
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }

  private pruneQueue(queue: QueueEntry[], now: number): QueueEntry[] {
    return queue.filter((entry) => !this.isExpired(entry, now, QUEUE_TIMEOUT_MS));
  }

  private pruneRematchQueue(queue: RematchEntry[], now: number): RematchEntry[] {
    return queue.filter((entry) => !this.isExpired(entry, now, REMATCH_TIMEOUT_MS));
  }

  private isExpired(entry: { createdAt: number }, now: number, timeoutMs: number): boolean {
    return now - entry.createdAt >= timeoutMs;
  }
}
