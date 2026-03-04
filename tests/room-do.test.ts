import test from "node:test";
import assert from "node:assert/strict";
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

test("reconnect restores previous player slot", async () => {
  const state = new MockDurableState();
  const room = new RoomDO(state as any);
  const sessionA = { playerId: "p1", socket: new FakeSocket(), slot: undefined as "P1" | "P2" | undefined };
  (room as any).sessions.set("p1", sessionA);

  (room as any).onClientEvent("p1", { type: "join", playerId: "p1", slot: "P1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((room as any).sessions.get("p1").slot, "P1");

  (room as any).sessions.delete("p1");
  const sessionReconnect = { playerId: "p1", socket: new FakeSocket(), slot: undefined as "P1" | "P2" | undefined };
  (room as any).sessions.set("p1", sessionReconnect);
  (room as any).onClientEvent("p1", { type: "join", playerId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((room as any).sessions.get("p1").slot, "P1");
});

test("move snapshot hydrates into a new RoomDO instance", async () => {
  const state = new MockDurableState();
  const room = new RoomDO(state as any);
  const sessionA = { playerId: "p1", socket: new FakeSocket(), slot: "P1" as const };
  (room as any).sessions.set("p1", sessionA);
  (room as any).slotAssignments.set("p1", "P1");

  (room as any).onClientEvent("p1", {
    type: "move",
    seq: 0,
    move: { fromRow: 1, fromCol: 1, toRow: 2, toCol: 1 }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const room2 = new RoomDO(state as any);
  await (room2 as any).ensureHydrated();
  assert.equal((room2 as any).state.seq, 1);
  assert.equal((room2 as any).state.turn, "P2");
});
