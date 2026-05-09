# Roadmap and phases

## Phase 0 — Documentation (now)

- Lock vision, v0 features, stack choice, and API boundaries.
- Answer [06-open-questions.md](06-open-questions.md).

## Phase 1 — Hackathon vertical slice

**Goal:** judges can log in, see a real subgraph, click nodes, re-root, try a username.

- OAuth + session.
- One backend surface: “expand this user with these caps.”
- One frontend: graph + panel + controls.
- Basic error and rate-limit messaging.

Exit criteria: stable demo on stable Wi‑Fi, no secrets in the repo, README with run instructions.

## Phase 2 — Post-hackathon hardening

- Persistence (users, cached subgraphs, audit of API calls).
- Better graph readability (label rules, level-of-detail).
- Observability (logging, metrics).

## Phase 3 — Scale and product

- Async jobs for large neighborhoods.
- Recommendation hints (“repos you might contribute to”) using public activity.
- Team orgs, optional private scopes only if legally clear and user-consented.

## Phase 4 — Mobile

See [05-mobile-later.md](05-mobile-later.md). Web API and domain model should stay the contract so mobile becomes a new client, not a rewrite.
