# Implementation phases (checklist)

## Phase D0 — Docs locked

- [ ] Answers recorded for `docs/humans/06-open-questions.md`
- [ ] `tech-stack-options.md` decision table filled
- [ ] Edge direction policy chosen in `data-model-and-github-mapping.md`

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
