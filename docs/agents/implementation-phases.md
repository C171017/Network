# Implementation phases (checklist)

## Phase D0 — Docs locked

- [x] `tech-stack-options.md` decision table filled (see also `chosen-tech-stack.md`)
- [ ] Answers recorded for remaining items in `docs/humans/06-open-questions.md` (caps, persona, deploy host, etc.)
- [ ] Edge direction policy chosen in `data-model-and-github-mapping.md`
- [ ] Default pull caps aligned with `data-pulling-storage-and-formats.md` and open questions

## Phase D0.5 — Stack onboarding (you / first contributor)

Mirrors the checklist in `docs/humans/08-chosen-tech-stack.md`; keep one source updated.

- [x] Supabase project + keys wired in **`apps/web/.env`** (`VITE_*`) and **`apps/server/.env`** (`SUPABASE_*`)
- [x] GitHub OAuth App callback → Supabase; GitHub provider enabled in Supabase dashboard
- [x] `.env.example` files under `apps/web` and `apps/server`; real `.env` files gitignored
- [x] Vite + React + TypeScript app runs locally (`apps/web`)
- [x] Hono API runs locally (`apps/server`); Vite dev proxy `/api` → `:8787`
- [ ] Prisma (or Drizzle) + `DATABASE_URL` migrations (optional for first graph slice)
- [x] Sign-in flow in browser; user visible in Supabase **Authentication** when configured

## Phase D1 — Scaffold

- [x] Repo boots locally (`npm install`, `npm run dev` / `dev:server` / `dev:all`)
- [x] Env templates + root README document variable names
- [x] GitHub OAuth via Supabase completes (callback → session)

## Phase D2 — Expand API

- [x] `POST /api/graph/expand` returns `GraphDTO` (star graph: root + followers + following, capped)
- [x] Caps enforced server-side (`maxFollowers` / `maxFollowing`)
- [ ] Errors mapped consistently to `{ code, message, retryAfter? }` (currently plain JSON errors)

## Phase D3 — UI

- [x] Graph renders from DTO (`@shopify/react-native-skia` / CanvasKit web — `apps/web/src/graph/columbia/`)
- [ ] Node selection + side panel (not built yet)
- [x] Explore by username via **Root GitHub login** input + load
- [ ] Dedicated rate-limit / retry UI (errors surface as banner text today)

## Phase D4 — Demo hardening

- [ ] Seed instructions for judges
- [ ] Responsive layout smoke-tested on phone browser
- [ ] No secrets in git history

## Acceptance criteria (hackathon)

1. Fresh clone → `apps/web/.env` + `apps/server/.env` → `npm run dev:all` (or `dev` + `dev:server`) → demo works.
2. Two distinct GitHub users expandable without server crash.
3. Caps visible in UI or easily explainable verbally.

## Post-hackathon (tracked, not scheduled here)

- DB-backed sessions + snapshot cache
- GraphQL batching
- Second-hop with strict global budget
- PWA polish
