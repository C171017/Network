# Stochastic crawl mechanism (single reusable core)

## Answers the product question

- **Is it possible to have “all information” on GitHub?** No. The graph is enormous, rate-limited, and mostly irrelevant for a demo. We intentionally pull **a bounded, random sample** of **first-degree** edges per node.
- **Should the demo start from your account?** Yes for early testing (`SEED_LOGIN=<you>`). For the pitch, run the same mechanism for **volunteer accounts** into a shared SQLite file (or later Postgres).

## One mechanism, two runners (same code)

| Runner | How it gets a token | When |
|--------|----------------------|------|
| **Local CLI** (`packages/crawler`) | `GITHUB_TOKEN` env (PAT or OAuth token pasted for dev) | Hackathon night: seed `data/network.db` from a few logins |
| **Product backend** (later) | OAuth session → user access token | After login, enqueue job that calls `runStochasticCrawl` (or a thin wrapper writing to Postgres instead of SQLite) |

The crawl logic lives in **`runStochasticCrawl`** (`packages/crawler/src/stochasticCrawl.ts`). Storage is pluggable later by swapping the store; v0 uses **SQLite** for speed and file handoff.

## Algorithm (current defaults)

Parameters (env in CLI, fields in `StochasticCrawlConfig` in code):

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `branchSample` | **6** | Random neighbors drawn from each node’s **first degree** (4–8 supported later) |
| `maxDepth` | **5** | Expand nodes at depths `0 … maxDepth - 1` (five sampling waves from the seed) |
| `maxPagesPerSide` | **3** | When building the pool, read at most this many **100-user** pages for **followers** and again for **following** |
| `maxExpansions` | **200** | Hard stop on how many distinct users we fully expand (API safety) |

Steps:

1. BFS queue starts at `{ login: seed, depth: 0 }`.
2. Pop a node with `depth < maxDepth` that has not been expanded yet.
3. `GET /users/{login}` → full public profile stored, node marked `expanded`.
4. `GET` followers + following lists (paginated, capped by `maxPagesPerSide`).
5. Merge lists uniquely by `github_id`, classify edge direction (`incoming` / `outgoing` / `mutual`).
6. Shuffle and take **`branchSample`** neighbors.
7. Upsert neighbor rows at `depth + 1`, insert directed `follows` edges, enqueue neighbors if `depth + 1 < maxDepth`.

**Important limitation:** randomness is **not uniform over the entire follower set** unless you paginate through everyone (expensive). We document **early-page bias**; increase `maxPagesPerSide` if you want a wider pool (more API calls).

## Storage format

- **Runtime:** GitHub JSON → normalized rows in **SQLite** (`nodes`, `edges`).
- **Same mechanism in production:** swap SQLite for **Postgres** JSONB snapshots or relational tables using the same columns.

## Accumulating runs (no wipe by default)

- Omit `RESET_DB` so the SQLite file **grows over time** across multiple crawls.
- **Duplicate users** discovered again as slim neighbors: **ignored** (`INSERT OR IGNORE` on `github_id`).
- **Duplicate edges**: **ignored** (`INSERT OR IGNORE` on primary key).
- `RESET_DB=1` is only for intentional “empty the DB before this run” demos.

## Related implementation

- Package: [`packages/crawler/README.md`](../../packages/crawler/README.md)
- Prior cap-only star algorithm (superseded for crawl mode): [`graph-expansion-algorithm.md`](graph-expansion-algorithm.md)
