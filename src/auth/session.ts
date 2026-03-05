const encoder = new TextEncoder();

type SessionClaims = {
  sub: string;
  exp: number;
};

function toBase64Url(input: Uint8Array): string {
  let binary = "";
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

export async function issueSessionToken(playerId: string, secret: string, ttlSeconds = 60 * 60): Promise<string> {
  const claims: SessionClaims = {
    sub: playerId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<{ ok: true; playerId: string } | { ok: false }> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) {
    return { ok: false };
  }
  const expected = await hmac(payload, secret);
  if (expected !== sig) {
    return { ok: false };
  }
  const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as SessionClaims;
  if (!claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false };
  }
  return { ok: true, playerId: claims.sub };
}
