# AstraChess Multiplayer (Full-stack Monorepo)

This repository now hosts both:
- **Backend API** (Cloudflare Worker + Durable Objects)
- **Frontend website** (React + Vite static app for GitHub Pages)

## Why this structure

The project is organized to let you work from any device using GitHub web tools while keeping deployment paths clear:
- frontend publishes to **GitHub Pages**
- backend deploys to **Cloudflare Workers**

## Repository structure

- `src/`: current backend Worker code (API + Durable Objects)
- `tests/`: backend automated tests
- `apps/web/`: new frontend React + Vite app
- `packages/contracts/`: shared TypeScript contracts for API/frontend alignment

## Commands

```bash
npm install
npm run dev           # backend dev (wrangler)
npm run typecheck     # backend typecheck
npm test              # backend automated tests
npm run web:dev       # frontend dev
npm run web:build     # frontend production build
npm run web:preview   # frontend preview
npm run test:e2e      # e2e multiplayer smoke tests
npm run test:load     # load/resilience tests
npm run deploy        # backend deploy
```

## Frontend status in this repo

Current frontend in `apps/web` includes:
- `VITE_API_BASE_URL` for backend base URL
- local controls for session token creation, matchmaking join, status polling, room connect/reconnect, and protocol error simulation
- network log panel for local debugging

## Backend status

Completed backend milestones:
- [x] Message contract alignment with AstraChess/arcade conventions
- [x] Authoritative room command handling
- [x] Matchmaking expansion (timeout, cancel, rematch)
- [x] Matchmaking status persistence + polling endpoint (`/matchmaking/status`)
- [x] Room persistence/recovery strategy
- [x] Automated Durable Object behavior tests
- [x] Token-based client auth for protected routes (`/matchmaking/*`, `/room/*`)
- [x] Minimal auth + observability scaffolding

## Auth and observability

- Browser clients should use a per-client session token for `/matchmaking/*` and `/room/*` (Bearer header or `access_token` query param), not a shared API key.
- `x-api-key` is for trusted bootstrap/server-side usage, primarily `POST /auth/session` to mint a player session token.
- Matchmaking lifecycle: call `POST /matchmaking/join`; if the response is `queued`, keep polling `GET /matchmaking/status?requestId=...` until a terminal state (`matched`, `cancelled`, or `timed_out`).
- `/health` remains public.
- Structured logs are emitted for matchmaking and room lifecycle events.
- Room and matchmaking `/health` responses include basic counters.
- CORS is enabled for web dev calls and responses include `x-request-id` + `x-protocol-version`.
- Configure local `.dev.vars` with `API_KEY=...` and (recommended) `SESSION_TOKEN_SECRET=...`.

### Local test flow (2 players)

1. Start backend: `npm run dev`.
2. Mint two session tokens via `POST /auth/session` using `x-api-key` (one token per `playerId`).
3. Player 1: `POST /matchmaking/join` with token; if `queued`, poll `GET /matchmaking/status?requestId=...`.
4. Player 2: `POST /matchmaking/join` with its own token; both clients should reach `matched` with the same `roomId`.
5. Connect each player to `/room/{roomId}` with their own token (`access_token` in query for WebSocket).

## Deploy model

### Frontend (GitHub Pages)
- Build locally with `npm run web:build` until workflows are reintroduced.

### Backend (Cloudflare)
- Deploy with `npm run deploy`
- Keep Worker secrets/config in Cloudflare (not in repo)

## Post-TypeScript roadmap (execution plan)

- [x] Stabilize HTTP/WebSocket contracts and API versioning  
  Define one versioned protocol contract in `packages/contracts` and enforce compatibility checks in backend/frontend CI.
- [x] CI/CD hardening (preview environments + release gates)  
  Keep Pages + Worker deploy pipelines and add required gates: `typecheck`, backend tests, frontend build, and e2e smoke before production.
- [x] Load/resilience validation for DO contention and reconnect storms  
  Add scripted load scenarios for matchmaking spikes, room contention, and reconnect storms; fail release if thresholds regress.
- [x] Gameplay UX polish (lobby, game HUD, reconnect states)  
  Implement lobby + room + game HUD screens, with reconnect and protocol-error surfaces wired to backend events.
- [x] Auth hardening (identity/session lifecycle across web + API)  
  Move from static API key for clients to signed player session tokens and enforce room membership/reconnect authorization.
- [x] Production telemetry dashboards and alerting  
  Instrument matchmaking latency, move validation latency, reconnect success, and protocol error rates; wire alerts for SLO breaches.
- [x] End-to-end multiplayer tests in CI  
  Add deterministic 2-player flows (matchmaking, join, move, disconnect/reconnect, rematch, finish) as release-gating checks.

## Connecting AstraChess (C++) + arcade-link (Rust) to this TypeScript stack

### Target architecture

1. **Web app (TypeScript/React)** talks to Worker API + WebSocket endpoints.
2. **Worker + Durable Objects (TypeScript)** remain the control plane for matchmaking, room lifecycle, auth, and orchestration.
3. **AstraChess service (C++)** runs as an external authoritative chess engine service.
4. **arcade-link service (Rust)** runs as an external multiplayer transport/session service.
5. Worker/DO calls both native services through versioned contracts.

### Step-by-step integration

1. **Run the native services separately**
   - Deploy `crucueiv/AstraChess` as a network service (HTTP/gRPC/WebSocket RPC).
   - Deploy `serg-cs/arcade-link` as a network service for room transport/session fanout.

2. **Add environment variables to the Worker**
   - `ASTRACHESS_ENGINE_URL=<engine endpoint>`
   - `ARCADE_LINK_URL=<arcade-link endpoint>`
   - `PROTOCOL_VERSION=v1`
   - `API_KEY=<bootstrap key for /auth/session>`
   - `SESSION_TOKEN_SECRET=<token signing secret for client sessions>`

3. **Define and freeze shared contracts**
   - Keep TS contracts in `packages/contracts`.
   - Add protocol envelope fields (`version`, `type`, `requestId`, `roomId`, `playerId`) used by Worker, web app, C++, and Rust services.

4. **Wire matchmaking and room lifecycle**
   - Matchmaking remains in DO.
   - On match: create room metadata in DO, call AstraChess `POST /games/create` for that `roomId`, open/attach session channel in arcade-link, then return room/session info to clients.

5. **Make AstraChess authoritative for moves**
   - On `move` event, DO sends move request to AstraChess `POST /moves/validate` with `roomId`, `playerId`, `seq`, and move coordinates.
   - AstraChess validates and returns next state/legal moves/terminal state.
   - DO persists snapshot and broadcasts state updates to clients.
   - Optional sync/debug endpoint: use AstraChess `GET /games/state?roomId=...` to inspect authoritative room state.

6. **Handle disconnect/reconnect**
   - DO owns reconnect tokens/session ownership.
   - Reconnected clients rebind through arcade-link and receive latest DO snapshot.

7. **Secure service-to-service calls**
   - Use signed service tokens/mTLS between Worker and native services.
   - Keep client identity/session auth separate from service auth.

8. **Add observability**
   - Trace each move path: `client -> Worker/DO -> AstraChess -> DO -> arcade-link -> clients`.
   - Emit request IDs in all logs/metrics for correlation.

9. **Validate locally before production**
   - Start order: `AstraChess` -> `arcade-link` -> Worker (`npm run dev`) -> Web (`npm run web:dev`).
   - Run `npm run typecheck` and `npm test`, then run multiplayer e2e smoke tests.

10. **Release**
    - Publish frontend to Pages and backend to Cloudflare only after all gates pass.
