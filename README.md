# AstraChess Multiplayer Backend

Cloudflare Workers + Durable Objects backend scaffold for AstraChess multiplayer.

## Stack

- TypeScript
- Cloudflare Workers
- Durable Objects

## Project structure

- `src/worker.ts`: Worker entrypoint and HTTP routes
- `src/do/matchmaking-do.ts`: Matchmaking queue Durable Object
- `src/do/room-do.ts`: Authoritative room/session Durable Object (join, ping, apply_move checks)
- `src/domain/messages.ts`: Shared multiplayer message contracts aligned with AstraChess (`P1`/`P2`, move request fields)

## Current room protocol (WIP)

- Client `join`: `{ type: "join", playerId, slot?: "P1" | "P2" }`
- Client `apply_move`: `{ type: "apply_move", payload: { seq, fromRow, fromCol, toRow, toCol } }`
- Server emits: `room_state`, `move_accepted`, `move_rejected`, `pong`, `error`
- Current authoritative checks: player joined, turn ownership, `seq` match, room not finished

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

## Next TODOs

- [x] Align message contracts with `crucueiv/AstraChess` for room state and move request shape
- [x] Implement initial authoritative room command handling (turn/seq/finished checks)
- [ ] Align remaining contracts with `serg-cs/versus-arcade`
- [ ] Expand matchmaking (timeout, cancel, rematch)
- [ ] Add persistence/recovery strategy for rooms and players
- [ ] Add automated tests for Durable Objects behavior
- [ ] Add auth/reconnect and observability
