export type ClientEvent =
  | { type: "join"; playerId: string }
  | { type: "move"; payload: unknown }
  | { type: "ping" };

export type ServerEvent =
  | { type: "queued" }
  | { type: "match_found"; roomId: string; opponentId: string }
  | { type: "broadcast"; from: string; payload: unknown }
  | { type: "pong" }
  | { type: "error"; message: string };
