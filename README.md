# AstraChess Multiplayer Backend

Cloudflare Workers + Durable Objects backend scaffold for AstraChess multiplayer.

## Stack

- TypeScript
- Cloudflare Workers
- Durable Objects

## Project structure

- `src/worker.ts`: Worker entrypoint and HTTP routes
- `src/do/matchmaking-do.ts`: Matchmaking queue Durable Object
- `src/do/room-do.ts`: Room/session Durable Object for realtime messaging
- `src/domain/messages.ts`: Shared multiplayer message types

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
