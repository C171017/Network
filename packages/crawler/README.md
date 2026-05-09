# @network/crawler

Single reusable mechanism: **stochastic BFS** on GitHub’s public follow graph.

- From each expanded user, pull **first-degree** connections (followers **and** following), build a pool from the first `MAX_PAGES_PER_SIDE` pages on each side, then **randomly sample `BRANCH_SAMPLE` (default 6)** neighbors.
- Repeat up to **`MAX_DEPTH` (default 5)** layers: expand every node whose `depth` is `0 … maxDepth - 1`.
- Persist nodes + directed `follows` edges to **SQLite** (WAL) for local pitch seeding or future backend jobs.

## Why this exists

You cannot (and should not) mirror all of GitHub. This module is the **same function** whether you:

1. Run it **locally** during the hackathon to pre-seed a `network.db` from volunteers’ tokens, or  
2. Call it from the **product backend** after OAuth (possibly in a background worker with the user’s access token).

## Requirements

- Node **20+** (uses global `fetch`).
- A **classic** personal access token or OAuth user token with scopes sufficient for public endpoints (`read:user` if GitHub requires it for your calls—test with your token).

## Run locally

From repo root:

```bash
npm install
mkdir -p data
SEED_LOGIN=your_github_login GITHUB_TOKEN=ghp_xxx npm run crawl
```

Environment variables:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SEED_LOGIN` | (required) | Starting GitHub username |
| `GITHUB_TOKEN` or `GH_TOKEN` | (required) | Token for `api.github.com` |
| `DB_PATH` | `./data/network.db` | SQLite output path |
| `BRANCH_SAMPLE` | `6` | Random neighbors per expansion (your 4–8 range; 6 now) |
| `MAX_DEPTH` | `5` | Expand nodes at depths `0 … maxDepth-1` (5 waves with default 5) |
| `MAX_PAGES_PER_SIDE` | `3` | Max list pages per side when pooling first-degree (300 users max per side) |
| `MAX_EXPANSIONS` | `200` | Safety cap on distinct expansions (API budget) |
| `RESET_DB` | unset | Set to `1` or `true` to **truncate** `nodes`/`edges` before this run (accurate counts) |

## Programmatic use

```ts
import { runStochasticCrawl } from "@network/crawler";

await runStochasticCrawl({
  token: process.env.GITHUB_TOKEN!,
  seedLogin: "octocat",
  branchSample: 6,
  maxDepth: 5,
  maxPagesPerSide: 3,
  maxExpansions: 200,
  dbPath: "./data/network.db",
});
```

## Honest limitations

- **Sampling bias:** neighbors are drawn from **early API pages** unless you increase `MAX_PAGES_PER_SIDE` (more requests, slower).
- **Rate limits:** large `maxDepth` / `branchSample` can exhaust quota; the client throws `GithubRateLimitError` with optional `retry-after`.
- **Not scraping HTML:** this uses the official JSON API only.
