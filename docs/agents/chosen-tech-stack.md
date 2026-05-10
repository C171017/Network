# Chosen tech stack (implementation source of truth)

**Status:** locked for scaffold work as of **2026-05-09**. Broader product questions remain in `docs/humans/06-open-questions.md`.

Human summary: [`../humans/08-chosen-tech-stack.md`](../humans/08-chosen-tech-stack.md).

## Locked decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Web UI | **Vite + React + TypeScript** | Fast dev server; explicit split from API; strong TS ecosystem for graph DTOs |
| API / BFF | **Hono** on Node (`apps/server`) | `POST /api/graph/expand` verifies Supabase JWT and calls GitHub; secrets stay off the Vite client |
| Database | **Supabase (PostgreSQL)** for auth and future app tables; **SQLite file** (`better-sqlite3`) in `apps/server` for graph read/expand in the current slice | Hosted Postgres for growth; local file keeps the hackathon vertical slice fast |
| ORM | **Prisma** (default) or **Drizzle** (planned) | Use when wiring `DATABASE_URL` and migrations for Postgres-backed features beyond the SQLite graph file |
| Auth | **Supabase Auth**, **GitHub** provider | Fewer moving parts than separate Auth.js for a Supabase-first stack; session JWT usable from API |
| Graph renderer | **`@shopify/react-native-skia`** (CanvasKit on web) | Shipped under `apps/web/src/graph/columbia/` (`NetworkGraphSkia`, layout, gestures) |
| Package manager | **pnpm** (recommended) | Matches `implementation-phases.md` acceptance wording; override in root README if the team picks npm/bun (**this repo uses npm workspaces** today) |
| Host | **TBD** | Vercel / Railway / Fly / other — pick when deploying |

## Repository shape (recommended when scaffolding)

```text
apps/
  web/          # Vite + React + TS (browser) + Supabase GitHub OAuth + graph UI
  server/       # Hono: verifies Supabase JWT; GitHub expand; no secrets in Vite bundle
```

A flat `client/` + `server/` layout is equivalent; keep **all secrets** in `server` only; keep **ORM / `DATABASE_URL` usage** in `server` only when you add Prisma or Drizzle.

## Environment variables (names only; never commit values)

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Prisma / Drizzle (when added) | Supabase **pooled** Postgres URI (transaction mode / pooler) |
| `DIRECT_URL` | Prisma Migrate (optional) | Supabase **direct** connection if migrations require non-pooled access |
| `SUPABASE_URL` | Server and/or web | Supabase project URL |
| `SUPABASE_ANON_KEY` | Web (`VITE_SUPABASE_ANON_KEY`) + server (`SUPABASE_ANON_KEY`) | Public **anon** JWT **or** newer **`sb_publishable_…`** client key from Supabase **Project Settings → API**, whichever your project exposes for browser clients |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypass RLS for admin tasks — **never** ship to Vite |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Supabase dashboard GitHub provider config | Often configured in Supabase UI rather than app env; mirror here only if your server needs them |
| `AUTH_SECRET` or framework equivalent | Server | Session signing if not fully delegated to Supabase JWT verification |

Exact names should be reconciled with `github-api-and-auth.md` and Supabase’s current GitHub provider docs when implementing.

## Implemented: env file loading (`apps/server`)

At startup, `apps/server` loads environment variables from:

1. **`<repo>/.env`** (optional shared vars such as crawler tokens), then  
2. **`apps/server/.env`** with **`override: true`** so server-specific keys win.

Paths are resolved from **`import.meta.url`** (not `process.cwd()`), so `npm` / `tsx` working directory does not skip `apps/server/.env`.

## Auth + GitHub API note

- The **browser** talks to **Supabase Auth** for sign-in.
- The **expand** endpoint calls **GitHub** with the user’s **GitHub OAuth access token** (`session.provider_token` on the client). The client sends it as **`X-GitHub-Access-Token`** only after `Authorization: Bearer <supabase_access_token>` succeeds server-side verification. This is a pragmatic hackathon bridge; tighten storage/exchange later (do not log tokens).

## SQL experience level

Contributors may be new to SQL. Policy:

1. When you add Postgres app tables, model them in **Prisma schema** (or Drizzle); review generated SQL in logs occasionally.
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
