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
    SESSION_TOKEN_SECRET: "session-secret",
    MATCHMAKING_DO: namespace,
    ROOM_DO: namespace
  } as any;
}

test("health route is public", async () => {
  const response = await worker.fetch(new Request("https://example.com/health"), createEnv());
  assert.equal(response.status, 200);
});

test("protected routes reject unauthenticated requests", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/matchmaking/join", { method: "POST" }),
    createEnv()
  );
  assert.equal(response.status, 401);
});

test("protected routes reject api key authentication", async () => {
  const wrong = await worker.fetch(
    new Request("https://example.com/matchmaking/join", {
      method: "POST",
      headers: { "x-api-key": "wrong" }
    }),
    createEnv("secret")
  );
  assert.equal(wrong.status, 401);

  const stillUnauthorized = await worker.fetch(
    new Request("https://example.com/matchmaking/join", {
      method: "POST",
      headers: { "x-api-key": "secret" }
    }),
    createEnv("secret")
  );
  assert.equal(stillUnauthorized.status, 401);
});

test("session token can access protected routes", async () => {
  const tokenResponse = await worker.fetch(
    new Request("https://example.com/auth/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret"
      },
      body: JSON.stringify({ playerId: "p1" })
    }),
    createEnv("secret")
  );
  assert.equal(tokenResponse.status, 200);
  const { token } = (await tokenResponse.json()) as { token: string };

  const ok = await worker.fetch(
    new Request("https://example.com/matchmaking/join", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      }
    }),
    createEnv("secret")
  );
  assert.equal(ok.status, 200);
});

test("session token in query can access protected routes", async () => {
  const tokenResponse = await worker.fetch(
    new Request("https://example.com/auth/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret"
      },
      body: JSON.stringify({ playerId: "p2" })
    }),
    createEnv("secret")
  );
  assert.equal(tokenResponse.status, 200);
  const { token } = (await tokenResponse.json()) as { token: string };

  const ok = await worker.fetch(
    new Request(`https://example.com/matchmaking/join?access_token=${encodeURIComponent(token)}`, {
      method: "POST"
    }),
    createEnv("secret")
  );
  assert.equal(ok.status, 200);
});

test("room routes require session token and reject unauthenticated requests", async () => {
  const unauthorized = await worker.fetch(new Request("https://example.com/room/room-1"), createEnv("secret"));
  assert.equal(unauthorized.status, 401);

  const tokenResponse = await worker.fetch(
    new Request("https://example.com/auth/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret"
      },
      body: JSON.stringify({ playerId: "p3" })
    }),
    createEnv("secret")
  );
  assert.equal(tokenResponse.status, 200);
  const { token } = (await tokenResponse.json()) as { token: string };

  const authorized = await worker.fetch(
    new Request(`https://example.com/room/room-1?access_token=${encodeURIComponent(token)}`),
    createEnv("secret")
  );
  assert.equal(authorized.status, 200);
});
