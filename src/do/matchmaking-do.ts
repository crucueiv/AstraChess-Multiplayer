type QueueEntry = {
  playerId: string;
};

export class MatchmakingDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST" && new URL(request.url).pathname === "/join") {
      const body = (await request.json()) as Partial<QueueEntry>;
      if (!body.playerId) {
        return Response.json({ error: "playerId is required" }, { status: 400 });
      }

      const queue = (await this.state.storage.get<QueueEntry[]>("queue")) ?? [];
      queue.push({ playerId: body.playerId });

      if (queue.length >= 2) {
        const first = queue.shift()!;
        const second = queue.shift()!;
        await this.state.storage.put("queue", queue);
        const roomId = `${first.playerId}-${second.playerId}-${Date.now()}`;
        return Response.json({
          matched: true,
          roomId,
          players: [first.playerId, second.playerId]
        });
      }

      await this.state.storage.put("queue", queue);
      return Response.json({ matched: false, status: "queued" });
    }

    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
}
