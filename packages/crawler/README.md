# @network/crawler

Single reusable mechanism: **stochastic BFS** on GitHub’s public follow graph.

## What you need to provide (so you or the agent can run it)

| Item | Where | Notes |
|------|--------|--------|
| **GitHub token** | `GITHUB_TOKEN` or `GH_TOKEN` in `.env` (see repo root [`.env.example`](../.env.example)) | Classic **personal access token** (fine-grained or PAT) or an **OAuth user access token** with scopes that allow public `users` + follower list reads (`read:user` if GitHub requires it for your account). **Do not paste tokens into chat**; put them only in local `.env`. |
| **Seed username** | `SEED_LOGIN` | The login you want as the root (e.g. yours for testing). |
| **Network permission** | Your machine | `npm install` must reach the registry; crawl calls `https://api.github.com`. |

**Can the agent run it for you here?** Only if **you** create `.env` in this repo with a real token (still **never commit** it). The agent will not ask you to paste a secret into the conversation. Without a token in the environment, runs will fail at startup by design.

## Where results go

| Output | Default path | Contents |
|--------|----------------|----------|
| **SQLite database** | `./data/network.db` (from repo root when you run via workspace; override with `DB_PATH`) | Tables `nodes` (profiles + depth + `expanded`) and `edges` (directed `follows`). WAL files may appear next to it (`*.db-wal`, `*.db-shm`). |

Create the folder once: `mkdir -p data`.

## Accumulating over time (duplicates ignored)

- **By default** `RESET_DB` is **off**: each new crawl **adds** to the same DB.
- **New user row** that already exists (`github_id`): **ignored** (`INSERT OR IGNORE` on slim inserts).
- **New follow edge** that already exists: **ignored** (`INSERT OR IGNORE`).
- **Expanded profile** for a user we already stored: still **upserts** on expand so slim rows can become full profiles; re-running may **refresh** fields for people we expand again (API truth). If you want a strict “never touch existing rows” policy, say so and we can tighten that.
- To **wipe** and start over for one demo only, set `RESET_DB=1` for that single run.

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
