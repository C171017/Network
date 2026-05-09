# Implementation phases (checklist)

## Phase D0 — Docs locked

- [x] `tech-stack-options.md` decision table filled (see also `chosen-tech-stack.md`)
- [ ] Answers recorded for remaining items in `docs/humans/06-open-questions.md` (caps, persona, deploy host, etc.)
- [ ] Edge direction policy chosen in `data-model-and-github-mapping.md`
- [ ] Default pull caps aligned with `data-pulling-storage-and-formats.md` and open questions

## Phase D0.5 — Stack onboarding (you / first contributor)

Mirrors the checklist in `docs/humans/08-chosen-tech-stack.md`; keep one source updated.

- [ ] Supabase project created; GitHub Auth provider enabled; OAuth callback URLs set
- [ ] GitHub OAuth credentials configured (per Supabase + GitHub docs)
- [ ] `.env` / `.env.example` wired for `DATABASE_URL`, Supabase keys, and any server secrets (`chosen-tech-stack.md`)
- [ ] Vite + React + TypeScript app runs locally (`apps/web` or equivalent)
- [ ] Node API server runs locally and is reachable from the web app (proxy or explicit API base URL)
- [ ] Prisma (or Drizzle) connects to Supabase; first migration applied (pooler vs direct URL per `chosen-tech-stack.md`)
- [ ] Sign-in flow completes in the browser; user visible in Supabase **Authentication** dashboard

## Phase D1 — Scaffold

- [ ] Repo boots locally; lint/format baseline
- [ ] Env template documented in root README
- [ ] GitHub OAuth works to completion (callback → session)

## Phase D2 — Expand API

- [ ] `POST /api/graph/expand` returns valid `GraphDTO` for test user
- [ ] Caps enforced; truncation counts in DTO
- [ ] Errors mapped to stable client shape `{ code, message, retryAfter? }`

## Phase D3 — UI

- [ ] Graph renders from DTO
- [ ] Node selection shows panel
- [ ] Actions: re-root, explore by username
- [ ] Rate limit / error UI

## Phase D4 — Demo hardening

- [ ] Seed instructions for judges
- [ ] Responsive layout smoke-tested on phone browser
- [ ] No secrets in git history

## Acceptance criteria (hackathon)

1. Fresh clone → `.env` → `pnpm dev` (or chosen PM) → demo works.
2. Two distinct GitHub users expandable without server crash.
3. Caps visible in UI or easily explainable verbally.

## Post-hackathon (tracked, not scheduled here)

- DB-backed sessions + snapshot cache
- GraphQL batching
- Second-hop with strict global budget
- PWA polish
