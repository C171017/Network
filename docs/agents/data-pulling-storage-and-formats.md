# Data pulling, volume, timing, formats, and storage

Official reference: [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) (verify while implementing; limits can change).

## How we pull data (v0)

| Step | Mechanism |
|------|-----------|
| Transport | **HTTPS** to `api.github.com` |
| Auth | **OAuth user access token** on the server (recommended) or **PAT** for dev only |
| API style | **REST** with **cursor or page** pagination (`per_page`, `page`, or Link header — follow GitHub docs per endpoint) |
| Orchestration | One **expand** action runs a short scripted sequence: profile → followers pages → following pages → build `GraphDTO` |

GraphQL is a valid alternative later (fewer round trips, different rate limit accounting). v0 stays REST for simplicity.

## How much we pull (bounded expansion)

Controlled by **caps** (defaults TBD in [`../humans/06-open-questions.md`](../humans/06-open-questions.md)):

| Knob | Meaning |
|------|---------|
| `maxFollowers` | Stop after this many unique follower **users** collected |
| `maxFollowing` | Stop after this many unique following **users** collected |
| `per_page` | Usually **100** (GitHub max for many list endpoints) |

**Requests per expansion (rough, REST, serial worst case):**

| Piece | Requests (approx.) |
|-------|---------------------|
| Root profile | 1 |
| Followers list | `ceil(min(followerCount, maxFollowers) / per_page)` |
| Following list | `ceil(min(followingCount, maxFollowing) / per_page)` |
| Extra profile fetches (optional v0.5) | 0 in v0 shortcut; up to **N** if you fetch full profile per neighbor |

**Example:** `maxFollowers = maxFollowing = 100`, `per_page = 100` → often **1 + 1 + 1 = 3** list requests + **0** optional enrich = **3** REST calls per expansion (plus auth/session overhead outside GitHub).

## How realistic is this?

| Constraint | Implication |
|------------|-------------|
| **Authenticated primary limit** | **5,000 REST requests/hour** per user+app context (standard GitHub.com; Enterprise differs). |
| **Unauthenticated** | **60 requests/hour** per egress IP — **not** viable for multi-user “type any username” without login or server cache. |
| **Large accounts** | A user with 50k followers: we only pull **first pages until cap**; UI must say “showing N of many”. |
| **Slim list payloads** | Follower/following list items may omit bio/location; full profile needs extra `GET /users/{login}` calls — trade quality for quota. |

**Bottom line:** Pulling **one hop**, **capped** (e.g. 100+100 neighbors), with **OAuth**, is **standard and realistic** for a hackathon demo. Pulling **full** graphs or **deep** hops without caching is **not** realistic.

## How long will it take? (wall-clock)

Depends on RTT and pagination depth, not CPU.

| Scenario | Typical wall-clock (order of magnitude) |
|----------|----------------------------------------|
| v0 star expansion, 100+100, 3 REST calls, good Wi‑Fi | **~0.5–2 s** |
| Same with parallel follower + following fetches | Often **~0.3–1 s** |
| Caps 500+500 (multiple pages each) | **~2–8 s** unless parallelized |
| Rate limited / retries | **+seconds to minutes**; must show UI feedback |

Treat these as **planning estimates**; measure with real `fetch` in deployment region.

## Available data representations

GitHub’s HTTP APIs return **JSON**. What varies is **which API** and **which fields** you select.

### Format / layer comparison

| Layer | Format | Produced by | Best for |
|-------|--------|-------------|----------|
| GitHub REST response | **JSON** | GitHub | Live app input; schema in [REST reference](https://docs.github.com/en/rest) |
| GitHub GraphQL response | **JSON** (`data` / `errors`) | GitHub | Batched reads; different rate limit model |
| App wire DTO | **JSON** (`GraphDTO`) | Our server | **Stable contract** to the browser |
| Event / audit log | **JSONL** (optional) | Our server | Append-only logs, analytics pipelines |
| Offline / research export | **CSV** | Our **ETL script** (not from GitHub raw) | Batch analysis (like your Columbia pipeline: CSV → `network_data.json`) |
| Serialized graph snapshot | **JSON** file or **JSONB** in DB | Our server | Cache, reproducible demos |
| Relational store | **SQL tables** | Postgres, etc. | **Sessions**, users, **TTL cache**, audit |

**We do not** get CSV from GitHub directly for user graphs; **CSV is optional** only if **we** export.

### What to pull from GitHub (priority matrix)

Use this to decide v0 vs later. “Cost” = REST requests if done naively.

| Data | REST surface (typical) | In v0? | Cost / notes |
|------|------------------------|--------|----------------|
| Identity + avatar | `GET /users/{login}`, `GET /user` | **Yes** | Low |
| Bio, location, company, blog | same user object | **Yes** if single profile fetch | Low for root; **high** if per-neighbor |
| Followers (list) | `GET /users/{login}/followers` | **Yes** | ~1 req per 100 users |
| Following (list) | `GET /users/{login}/following` | **Yes** | ~1 req per 100 users |
| Public repos (metadata) | `GET /users/{login}/repos` | **Stretch** | Extra pagination; scope for “projects to contribute” |
| Starred repos | list endpoints | Later | Nice for taste; not needed for social graph |
| Social accounts | GraphQL `socialAccounts` or profile | Later | LinkedIn rarely structured in REST |
| Events / activity | `GET /users/{login}/events/public` | Later | Noisy; heavier |

**v0 recommendation:** root **full** profile + follower/following **lists** up to caps; **no** per-neighbor profile burst unless time allows “enrich selected node only”.

## Database / storage management — SQL vs JSON vs CSV

| Approach | Fits hackathon v0? | Scales after? | When to use |
|----------|-------------------|---------------|-------------|
| **SQL (Postgres, SQLite)** | Yes (minimal tables) | **Yes** | **Sessions**, OAuth tokens, **cached graph snapshots**, audit |
| **JSON / JSONB in SQL** | Yes | Yes | Store each `GraphDTO` or raw GitHub payload with TTL |
| **JSON files on disk** | Fastest “no DB” | Poor for concurrent multi-user | Local demo only |
| **CSV as primary store** | **No** | **No** for online app | **Offline** pipelines / exports only (great for analysis, not transactional) |
| **Redis** | Optional | Yes | Hot cache; still pair with SQL if you need durable accounts |

**Recommendation:**

- **Hackathon:** OAuth session store **must** be durable if deploy restarts → **SQL** (hosted Postgres or SQLite if single-instance). Optional: skip graph persistence; regenerate each visit.
- **Post-hackathon:** **Postgres** with **JSONB** column for `graph_snapshot` + indexed `root_login`, `created_at`, TTL job.

**CSV:** keep for **optional export** or **batch research**, not the live request path.

## Related docs

- [`graph-expansion-algorithm.md`](graph-expansion-algorithm.md) — caps, star graph, dedupe
- [`data-model-and-github-mapping.md`](data-model-and-github-mapping.md) — `GraphDTO` fields
- [`github-api-and-auth.md`](github-api-and-auth.md) — OAuth and limits overview

---

## Checklist (sync with project todos)

### Pull path

- [ ] Single server module owns all `api.github.com` calls
- [ ] Caps enforced before pagination loops
- [ ] Parse and respect rate-limit response headers; surface `retry_after` to UI
- [ ] Optional: parallelize followers + following fetches

### Formats

- [ ] Treat GitHub JSON as **external**; map into **our** `GraphDTO` JSON for the client
- [ ] (Optional post-hackathon) JSONL logging for debugging

### Storage

- [ ] Pick SQL vs SQLite for session (see open questions)
- [ ] If caching graphs: JSONB column + TTL policy + privacy copy in UI
- [ ] (Optional) “Export CSV” from last `GraphDTO` for spreadsheets — **not** primary store
