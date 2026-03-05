import test from "node:test";
import assert from "node:assert/strict";
import { MatchmakingDO } from "../src/do/matchmaking-do";
import { MockDurableState } from "./helpers/mock-durable-state";

test("matchmaking handles burst joins without throwing", async () => {
  const state = new MockDurableState();
  const instance = new MatchmakingDO(state as any);

  for (let i = 0; i < 20; i += 1) {
    const response = await instance.fetch(
      new Request("https://do.internal/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: `p${i}` })
      })
    );
    assert.equal(response.status, 200);
  }

  const health = await instance.fetch(new Request("https://do.internal/health"));
  assert.equal(health.status, 200);
  const payload = (await health.json()) as { queueDepth: number; counters: { join: number } };
  assert.equal(payload.counters.join, 20);
  assert.ok(payload.queueDepth >= 0);
});
