# Chosen tech stack (locked for this repo)

This is the **human-readable** summary. Implementation details, environment variables, and folder layout live in [`../agents/chosen-tech-stack.md`](../agents/chosen-tech-stack.md).

## What we picked

| Area | Choice |
|------|--------|
| **UI** | **Vite** + **React** + **TypeScript** |
| **Database** | **Supabase** (managed **PostgreSQL**) |
| **Talking to SQL** | **Prisma** (recommended) or **Drizzle** — use an ORM first so you ship with TypeScript types and migrations; learn raw SQL in parallel |
| **Auth** | **Supabase Auth** with the **GitHub** provider (same “sign in with GitHub” story; tokens stay server-aware via Supabase’s session model — see agent doc) |
| **API shape** | A **small backend** next to the Vite app (not “GitHub from the browser”) for `POST /api/graph/expand` and any privileged work — exact runtime is in the agent doc |

## Why Supabase if you are new to SQL

- You get a **real Postgres** database, backups, and a **dashboard** to run queries and inspect tables.
- **Supabase Auth** reduces OAuth wiring compared to rolling everything by hand.
- **Prisma** (or Drizzle) lets you define tables in code, run **migrations**, and query with **TypeScript** instead of memorizing SQL on day one.

You should still learn SQL basics over time (`SELECT`, `INSERT`, `WHERE`, `JOIN`, primary keys) — they map directly to what the ORM generates.

## Graph visualization

Not locked here yet; options remain **react-force-graph-2d** or **sigma.js** (see [`../agents/tech-stack-options.md`](../agents/tech-stack-options.md)). Pick one when you start the graph UI.

## Your onboarding to-do list

Use this as a personal checklist before writing feature code. Check boxes as you go.

### Accounts and keys

- [ ] Create a **Supabase** project (save the project URL and anon/service keys where the agent doc says to).
- [ ] In Supabase, enable **Auth → Providers → GitHub** and follow Supabase’s callback URL instructions.
- [ ] Create a **GitHub OAuth App** (or GitHub App, per Supabase docs for your setup) so GitHub login works end-to-end.
- [ ] Create a **`.env`** (and `.env.example` without secrets) listing every variable name the agent doc requires.

### Tooling

- [ ] Install **Node.js** (LTS) and pick **pnpm** or **npm**; use the same one in README when the repo is scaffolded.
- [ ] Scaffold **Vite + React + TypeScript** for the browser UI.
- [ ] Add a **small TypeScript API server** (see agent doc) and confirm `POST /api/graph/expand` can be called from the Vite dev proxy or configured `fetch` base URL.

### Database

- [ ] Add **Prisma** (or Drizzle), point `DATABASE_URL` at Supabase’s **connection pooler** string for the app runtime.
- [ ] For Prisma migrations, use Supabase’s **direct** connection string when their docs say to (poolers and DDL do not always mix).
- [ ] Run your first migration (even a trivial table) to prove the pipeline works.

### Auth and vertical slice

- [ ] From the UI, complete **GitHub sign-in** and confirm Supabase shows the user.
- [ ] Confirm the server can **identify the current user** and read a **GitHub access token** (or equivalent) needed to call GitHub’s API on their behalf — without putting secrets in the Vite bundle.

### Learning (parallel, low pressure)

- [ ] Skim one beginner **SQL** intro focused on: tables, rows, primary keys, `SELECT`/`WHERE`, and one simple `JOIN`.
- [ ] In Supabase **SQL Editor**, run a `SELECT` against `auth.users` or your own `public` table (respect RLS; use dashboard roles as documented).

### Still to decide later

Deploy host (Vercel, Railway, Fly.io, etc.) and default follower/following caps remain in [`06-open-questions.md`](06-open-questions.md) until you answer them.

---

When code exists, update **root `README.md`** with exact `dev` commands and env var names so a fresh clone can run.
