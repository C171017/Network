# Chosen tech stack (implementation source of truth)

**Status:** locked for scaffold work as of **2026-05-09**. Broader product questions remain in `docs/humans/06-open-questions.md`.

Human summary: [`../humans/08-chosen-tech-stack.md`](../humans/08-chosen-tech-stack.md).

## Locked decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Web UI | **Vite + React + TypeScript** | Fast dev server; explicit split from API; strong TS ecosystem for graph DTOs |
| API / BFF | **Dedicated Node HTTP server** (TypeScript), e.g. **Hono** or **Express** | GitHub OAuth token handling and `POST /api/graph/expand` must not live in the Vite client bundle |
| Database | **Supabase (PostgreSQL)** | Hosted Postgres, dashboard, backups; aligns with SQL + growth path in `tech-stack-options.md` |
| ORM | **Prisma** (default) or **Drizzle** | Prefer Prisma for minimal raw SQL early; either supports migrations against Supabase |
| Auth | **Supabase Auth**, **GitHub** provider | Fewer moving parts than separate Auth.js for a Supabase-first stack; session JWT usable from API |
| Graph renderer | **TBD** | `react-force-graph-2d` vs `sigma.js` — pick at Phase D3 |
| Package manager | **pnpm** (recommended) | Matches `implementation-phases.md` acceptance wording; override in root README if the team picks npm/bun |
| Host | **TBD** | Vercel / Railway / Fly / other — pick when deploying |

## Repository shape (recommended when scaffolding)

```text
apps/
  web/          # Vite + React + TS (browser)
  server/       # Hono or Express + Prisma client; GitHub expand; auth verification
```

A flat `client/` + `server/` layout is equivalent; keep **all secrets and Prisma usage** in `server` only.

## Environment variables (names only; never commit values)

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Prisma (runtime) | Supabase **pooled** Postgres URI (transaction mode / pooler) |
| `DIRECT_URL` | Prisma Migrate (optional) | Supabase **direct** connection if migrations require non-pooled access |
| `SUPABASE_URL` | Server and/or web | Supabase project URL |
| `SUPABASE_ANON_KEY` | Web (if using `@supabase/supabase-js` in browser) | Public anon key; RLS applies |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypass RLS for admin tasks — **never** ship to Vite |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Supabase dashboard GitHub provider config | Often configured in Supabase UI rather than app env; mirror here only if your server needs them |
| `AUTH_SECRET` or framework equivalent | Server | Session signing if not fully delegated to Supabase JWT verification |

Exact names should be reconciled with `github-api-and-auth.md` and Supabase’s current GitHub provider docs when implementing.

## Auth + GitHub API note

- The **browser** talks to **Supabase Auth** for sign-in.
- The **expand** endpoint must call **GitHub** with a **user access token** (or a carefully scoped alternative). Follow Supabase guidance for accessing the **provider token** (GitHub) server-side after validating the user’s JWT. Do not expose long-lived secrets to the client.

## SQL experience level

Contributors may be new to SQL. Policy:

1. Model tables in **Prisma schema** (or Drizzle); review generated SQL in logs occasionally.
2. Use the Supabase dashboard **SQL Editor** for ad-hoc read-only learning.
3. Add hand-written SQL only when the ORM is insufficient; document invariants in `data-model-and-github-mapping.md` or adjacent agent docs.

## Graph crawl seeding (hackathon + reuse)

- **`packages/crawler`** implements **`runStochasticCrawl`**: stochastic BFS (random **6** first-degree neighbors per node, **`MAX_DEPTH` default 5**), GitHub REST, **SQLite** output for local demo seeding.
- **Same module** should be imported from **`apps/server`** later for post-login background jobs; swap SQLite writes for Prisma/Postgres tables when you wire persistence (see `stochastic-crawl-mechanism.md`).

## Related docs

- Tradeoffs not repeated here: `tech-stack-options.md`
- HTTP API sketch: `architecture-target-state.md`
- Phased checklist: `implementation-phases.md`
- Stochastic crawl: `stochastic-crawl-mechanism.md`
