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
- `.github/workflows/ci.yml`: repo validation (typecheck, tests, frontend build)
- `.github/workflows/pages.yml`: frontend deploy to GitHub Pages

## Commands

```bash
npm install
npm run dev           # backend dev (wrangler)
npm run typecheck     # backend typecheck
npm test              # backend automated tests
npm run web:dev       # frontend dev
npm run web:build     # frontend production build
npm run web:preview   # frontend preview
npm run deploy        # backend deploy
```

## Frontend plan in this repo

Current frontend is a scaffold in `apps/web` with environment-based API target:
- `VITE_API_BASE_URL` for backend base URL
- automatic GitHub Pages base path when `GITHUB_PAGES=true`

Next frontend implementation steps:
1. Build matchmaking and room screens
2. Integrate websocket state flow
3. Add reconnect UX and error states

## Backend status

Completed backend milestones:
- [x] Message contract alignment with AstraChess/arcade conventions
- [x] Authoritative room command handling
- [x] Matchmaking expansion (timeout, cancel, rematch)
- [x] Room persistence/recovery strategy
- [x] Automated Durable Object behavior tests
- [x] Minimal auth + observability scaffolding

## Auth and observability

- Protected routes (`/matchmaking/*`, `/room/*`) require `x-api-key` matching Worker `API_KEY`.
- `/health` remains public.
- Structured logs are emitted for matchmaking and room lifecycle events.
- Room and matchmaking `/health` responses include basic counters.
- Configure key locally via `.dev.vars` (`API_KEY=...`) and in production via `wrangler secret put API_KEY`.

## Deploy model

### Frontend (GitHub Pages)
- Workflow: `.github/workflows/pages.yml`
- Builds `apps/web` and publishes `apps/web/dist`

### Backend (Cloudflare)
- Deploy with `npm run deploy`
- Keep Worker secrets/config in Cloudflare (not in repo)

## Post-TypeScript roadmap

- [ ] Stabilize HTTP/WebSocket contracts and API versioning
- [ ] CI/CD hardening (preview environments + release gates)
- [ ] Load/resilience validation for DO contention and reconnect storms
- [ ] Gameplay UX polish (lobby, game HUD, reconnect states)
- [ ] Auth hardening (identity/session lifecycle across web + API)
- [ ] Production telemetry dashboards and alerting
- [ ] End-to-end multiplayer tests in CI
