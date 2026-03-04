# AstraChess Multiplayer Backend

Cloudflare Workers + Durable Objects backend scaffold for AstraChess multiplayer.

## Stack

- TypeScript
- Cloudflare Workers
- Durable Objects

## Project structure

- `src/worker.ts`: Worker entrypoint and HTTP routes
- `src/do/matchmaking-do.ts`: Matchmaking queue Durable Object
- `src/do/room-do.ts`: Authoritative room/session Durable Object (join, ping, move checks)
- `src/domain/messages.ts`: Shared multiplayer message contracts aligned with AstraChess (`P1`/`P2`, move request fields)

## Current room protocol (arcade-link aligned)

- Client `join`: `{ type: "join", playerId, slot?: "P1" | "P2" }`
- Client `move`: `{ type: "move", seq?: number, move: { fromRow, fromCol, toRow, toCol } }`
- Server emits: `welcome`, `state`, `pong`, `error`
- Error envelope: `{ type: "error", code: "INVALID_MOVE" | "UNAUTHORIZED" | ..., message }`
- Current authoritative checks: player joined, turn ownership, optional `seq` match, room not finished

## Commands

```bash
npm install
npm run dev
```

### Build/type-check

```bash
npm run typecheck
```

### Deploy

```bash
npm run deploy
```

### Test

There is no test suite yet in this scaffold.

Manual websocket smoke test:

- Build the tiny test client:
  ```bash
  npx tsc tinytests/testonly.ts --target ES2020 --module ES2020 --moduleResolution bundler --outDir tinytests --skipLibCheck
  ```
- Open `tinytests/testonly.html`
- Click `Join`, then `Move`
- Verify server frames include `welcome`/`state` and typed `error` envelopes when rejected

## Next TODOs

- [x] Align message contracts with `crucueiv/AstraChess` for room state and move request shape
- [x] Implement initial authoritative room command handling (turn/seq/finished checks)
- [x] Align remaining contracts with `serg-cs/versus-arcade`
- [ ] Expand matchmaking (timeout, cancel, rematch)
- [ ] Add persistence/recovery strategy for rooms and players
- [ ] Add automated tests for Durable Objects behavior
- [ ] Add auth/reconnect and observability
