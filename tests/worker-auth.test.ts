import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker";

function createEnv(apiKey?: string) {
  const stub = {
    fetch: async () => Response.json({ ok: true, proxied: true })
  };
  const namespace = {
    idFromName: () => "id",
    get: () => stub
  };
  return {
    API_KEY: apiKey,
    MATCHMAKING_DO: namespace,
    ROOM_DO: namespace
  } as any;
}

test("health route is public", async () => {
  const response = await worker.fetch(new Request("https://example.com/health"), createEnv());
  assert.equal(response.status, 200);
});

test("protected routes require configured api key", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/matchmaking/join", { method: "POST" }),
    createEnv()
  );
  assert.equal(response.status, 500);
});

test("protected routes reject wrong key and allow correct key", async () => {
  const wrong = await worker.fetch(
    new Request("https://example.com/matchmaking/join", {
      method: "POST",
      headers: { "x-api-key": "wrong" }
    }),
    createEnv("secret")
  );
  assert.equal(wrong.status, 401);

  const ok = await worker.fetch(
    new Request("https://example.com/matchmaking/join", {
      method: "POST",
      headers: { "x-api-key": "secret" }
    }),
    createEnv("secret")
  );
  assert.equal(ok.status, 200);
});
