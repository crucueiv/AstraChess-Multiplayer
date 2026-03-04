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

test("cancel removes queued request", async () => {
  const state = new MockDurableState();
  const instance = new MatchmakingDO(state as any);
  const first = await post(instance, "/join", { playerId: "p1" });

  const cancelled = await post(instance, "/cancel", { playerId: "p1", requestId: first.requestId });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.status, "cancelled");
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
