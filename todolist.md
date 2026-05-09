## user login

# Network project — data, formats, storage, and todos

Detailed specs live in [`docs/agents/data-pulling-storage-and-formats.md`](docs/agents/data-pulling-storage-and-formats.md) and [`docs/humans/07-data-pull-and-storage.md`](docs/humans/07-data-pull-and-storage.md). This file keeps **answers in one place** plus an **organized todo list**.

---

## How we pull data (summary)

| Question | Answer |
|----------|--------|
| **How?** | Server calls **GitHub REST** over **HTTPS** to `api.github.com` with **OAuth user token** (or PAT for dev). Pagination via `per_page` / `page` or Link header. v0: one scripted flow — profile → followers pages → following pages → build `GraphDTO`. |
| **How much?** | **Bounded:** caps like `maxFollowers`, `maxFollowing`, usually `per_page = 100`. We do **not** pull full giant lists; UI shows “N of many” when capped. |
| **How realistic?** | **Yes** for one-hop, capped graphs with auth (**~5,000 REST req/hour** per user+app). Unauthenticated (~60/hour per IP) is **not** viable for a public demo without sign-in or cache. Deep/full graphs without caching are **not** realistic. |
| **How long?** | Wall-clock is mostly **RTT + pages**. Rough orders: **~0.5–2 s** for a small star expansion (e.g. 100+100, ~3 REST calls); **~2–8 s** for larger caps unless parallelized; rate limits add **seconds to minutes** — UI must show progress / retry. |

---

## Available data formats — comparison

What you **receive from GitHub** is **JSON** only. “Formats” below include **our** layers and **exports**.

| Layer / artifact | Format | Source | Best for | Notes |
|------------------|--------|--------|----------|-------|
| GitHub REST | **JSON** | GitHub | Live ingestion | Official REST reference |
| GitHub GraphQL | **JSON** (`data` / `errors`) | GitHub | Batched reads later | Different rate-limit accounting |
| App → browser | **JSON** (`GraphDTO`) | Our server | **Stable UI contract** | Map GitHub JSON → our shape |
| Event / audit log | **JSONL** (optional) | Our server | Append-only logs, analytics | Post-hackathon optional |
| Offline / research | **CSV** | **Our** ETL / export | Spreadsheets, batch analysis | **Not** from GitHub raw |
| Graph snapshot cache | **JSON** file or **JSONB** in DB | Our server | Demos, reproducibility, TTL cache | |
| Sessions, users, TTL | **SQL** tables | Postgres / SQLite | **Transactional** multi-user | OAuth/session must survive deploy restarts |

**We do not** get CSV from GitHub for social graphs; CSV is only if **we** export.

---

## What to pull from GitHub — priority (cost = naive REST requests)

| Data | Typical REST surface | v0? | Cost / notes |
|------|----------------------|-----|----------------|
| Identity + avatar | `GET /users/{login}` | Yes | Low |
| Bio, location, company, blog | same user object | Yes if single root profile | Low for root; **high** if per-neighbor |
| Followers list | `GET /users/{login}/followers` | Yes | ~1 req per 100 users |
| Following list | `GET /users/{login}/following` | Yes | ~1 req per 100 users |
| Public repos (metadata) | `GET /users/{login}/repos` | Stretch | Extra pagination |
| Starred repos, social accounts, events | various | Later | Heavier / not needed for v0 graph |

**v0 recommendation:** root **full** profile + capped follower/following **lists**; **no** per-neighbor profile burst unless “enrich node on demand” is in scope.

---

## Database / storage — SQL vs JSON vs CSV

| Approach | Hackathon v0 | Scales after? | When to use |
|----------|--------------|----------------|---------------|
| **SQL** (Postgres, SQLite) | Yes | Yes | **Sessions**, OAuth tokens, **cached snapshots**, audit |
| **JSON / JSONB in SQL** | Yes | Yes | Store `GraphDTO` or raw payload + TTL |
| **JSON files on disk** | Quick demo | Poor concurrent multi-user | Local only |
| **CSV as primary store** | **No** | **No** for online app | **Exports / offline pipelines** only |
| **Redis** (optional) | Optional | Yes | Hot cache; pair with SQL if durable accounts matter |

**Recommendation:** **SQL** for OAuth/session (durable across restarts). Optional **JSONB** graph snapshot + TTL post-hackathon. **CSV** = optional export only, not the live path.

---

## Todo list (organized)

### A. Decisions & open questions

- [ ] Finalize default caps: `maxFollowers`, `maxFollowing`, `per_page` (track in `docs/humans/06-open-questions.md` if present)
- [ ] Choose session store: **hosted Postgres** vs **single-instance SQLite**
- [ ] Confirm v0: REST only vs allow GraphQL spike later
- [ ] Decide whether v0 persists graph snapshots or regenerates each visit

### B. Pull path & reliability

- [ ] Single server module owns all `api.github.com` calls
- [ ] Enforce caps **before** pagination loops
- [ ] Parse rate-limit headers; surface `retry_after` (or equivalent) to UI
- [ ] Optional: parallelize followers + following fetches
- [ ] Verify current [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) at implementation time

### C. Formats & contracts

- [ ] Treat GitHub JSON as external; map into internal **`GraphDTO`** for the client
- [ ] Document `GraphDTO` vs GitHub fields (`docs/agents/data-model-and-github-mapping.md`)
- [ ] (Optional later) JSONL logging for debugging / analytics

### D. Storage & exports

- [ ] Implement OAuth/session persistence in chosen **SQL** store
- [ ] If caching graphs: JSONB column + TTL policy + privacy copy in UI
- [ ] (Optional) “Export CSV” from last `GraphDTO` for spreadsheets — **not** primary store

### E. UX & honesty about data

- [ ] UI copy: capped counts (“showing N of many”), loading time expectations
- [ ] UI feedback when rate-limited or retrying

### F. Measurement

- [ ] Measure real wall-clock `fetch` latency in target deployment region for documented estimates

---

## Quick reference links

- [`docs/agents/data-pulling-storage-and-formats.md`](docs/agents/data-pulling-storage-and-formats.md) — tables, request math, checklist
- [`docs/humans/07-data-pull-and-storage.md`](docs/humans/07-data-pull-and-storage.md) — plain-language summary
- [`docs/agents/graph-expansion-algorithm.md`](docs/agents/graph-expansion-algorithm.md) — caps, star graph, dedupe


