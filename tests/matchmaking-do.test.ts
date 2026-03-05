import test from "node:test";
import assert from "node:assert/strict";
import { MatchmakingDO } from "../src/do/matchmaking-do";
import { MockDurableState } from "./helpers/mock-durable-state";

async function post(doInstance: MatchmakingDO, path: string, body: Record<string, unknown>): Promise<any> {
  const response = await doInstance.fetch(
    new Request(`https://do.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  return response.json();
}

async function get(doInstance: MatchmakingDO, path: string): Promise<any> {
  const response = await doInstance.fetch(new Request(`https://do.internal${path}`));
  return response.json();
}

test("join queues then matches two players", async () => {
  const state = new MockDurableState();
  const instance = new MatchmakingDO(state as any);

  const first = await post(instance, "/join", { playerId: "p1" });
  assert.equal(first.matched, false);
  assert.equal(first.status, "queued");
  assert.ok(first.requestId);

  const second = await post(instance, "/join", { playerId: "p2" });
  assert.equal(second.matched, true);
  assert.ok(second.roomId);
  assert.deepEqual(second.players, ["p1", "p2"]);
});

test("persists queued and matched status by request and player", async () => {
  const state = new MockDurableState();
  const instance = new MatchmakingDO(state as any);

  const first = await post(instance, "/join", { playerId: "p1", requestId: "req-1" });
  const queued = await get(instance, "/status?requestId=req-1");
  assert.equal(first.requestId, "req-1");
  assert.equal(queued.found, true);
  assert.equal(queued.status, "queued");

  await post(instance, "/join", { playerId: "p2", requestId: "req-2" });
  const matchedByRequest = await get(instance, "/status?requestId=req-1");
  const matchedByPlayer = await get(instance, "/status?playerId=p2");
  assert.equal(matchedByRequest.found, true);
  assert.equal(matchedByRequest.status, "matched");
  assert.ok(matchedByRequest.roomId);
  assert.equal(matchedByPlayer.found, true);
  assert.equal(matchedByPlayer.requestId, "req-2");
  assert.equal(matchedByPlayer.status, "matched");
});

test("cancel removes queued request", async () => {
  const state = new MockDurableState();
  const instance = new MatchmakingDO(state as any);
  const first = await post(instance, "/join", { playerId: "p1" });

  const cancelled = await post(instance, "/cancel", { playerId: "p1", requestId: first.requestId });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.status, "cancelled");
  const status = await get(instance, `/status?requestId=${first.requestId as string}`);
  assert.equal(status.found, true);
  assert.equal(status.status, "cancelled");
});

test("timeout status is persisted", async () => {
  const state = new MockDurableState();
  const instance = new MatchmakingDO(state as any);
  await state.storage.put("queue", [{ playerId: "p-timeout", requestId: "req-timeout", createdAt: Date.now() - 31_000 }]);

  const cancelled = await post(instance, "/cancel", { playerId: "p-timeout", requestId: "req-timeout" });
  assert.equal(cancelled.cancelled, false);
  assert.equal(cancelled.status, "timed_out");

  const status = await get(instance, "/status?requestId=req-timeout");
  assert.equal(status.found, true);
  assert.equal(status.status, "timed_out");
});

test("rematch waits then matches", async () => {
  const state = new MockDurableState();
  const instance = new MatchmakingDO(state as any);

  const first = await post(instance, "/rematch", { roomId: "room-1", playerId: "p1" });
  assert.equal(first.matched, false);
  assert.equal(first.status, "waiting_rematch");

  const second = await post(instance, "/rematch", { roomId: "room-1", playerId: "p2" });
  assert.equal(second.matched, true);
  assert.ok(second.roomId);
  assert.deepEqual(second.players, ["p1", "p2"]);
});

test("creates engine game on match when engine URL configured", async () => {
  const state = new MockDurableState();
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null
    });
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const instance = new MatchmakingDO(state as any, { ASTRACHESS_ENGINE_URL: "https://engine.local" });
    await post(instance, "/join", { playerId: "p1" });
    await post(instance, "/join", { playerId: "p2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://engine.local/games/create");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
