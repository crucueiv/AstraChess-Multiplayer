import test from "node:test";
import assert from "node:assert/strict";
import { MatchmakingDO } from "../src/do/matchmaking-do";
import { RoomDO } from "../src/do/room-do";
import { MockDurableState } from "./helpers/mock-durable-state";

class FakeSocket {
  sent: string[] = [];
  accept(): void {}
  addEventListener(): void {}
  send(data: string): void {
    this.sent.push(data);
  }
}

test("multiplayer smoke flow: queue -> match -> move -> rematch", async () => {
  const mmState = new MockDurableState();
  const mm = new MatchmakingDO(mmState as any);
  const post = (path: string, body: Record<string, unknown>) =>
    mm.fetch(
      new Request(`https://do.internal${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
    );

  const queued = await (await post("/join", { playerId: "p1" })).json() as { matched: boolean; status?: string };
  assert.equal(queued.matched, false);
  assert.equal(queued.status, "queued");

  const matched = await (await post("/join", { playerId: "p2" })).json() as { matched: boolean; roomId?: string };
  assert.equal(matched.matched, true);
  assert.ok(matched.roomId);

  const roomState = new MockDurableState();
  const room = new RoomDO(roomState as any);
  (room as any).sessions.set("p1", { playerId: "p1", socket: new FakeSocket(), slot: "P1" });
  (room as any).slotAssignments.set("p1", "P1");
  (room as any).onClientEvent("p1", { type: "move", seq: 0, move: { fromRow: 1, fromCol: 1, toRow: 2, toCol: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((room as any).state.seq, 1);

  const rematch1 = await (await post("/rematch", { roomId: "room-1", playerId: "p1" })).json() as { matched: boolean };
  const rematch2 = await (await post("/rematch", { roomId: "room-1", playerId: "p2" })).json() as { matched: boolean };
  assert.equal(rematch1.matched, false);
  assert.equal(rematch2.matched, true);
});
