# Network (GitHub social graph explorer)

Hackathon prototype: visualize **public** GitHub follow/follower relationships from a chosen root user, with **bounded** expansion for performance and API fairness.

**All design and architecture docs live under [`docs/`](docs/README.md).**

- **Human-readable:** [`docs/humans/`](docs/humans/README.md)
- **Agent / codegen-oriented:** [`docs/agents/`](docs/agents/README.md)
- **Chosen tech stack:** [`docs/humans/08-chosen-tech-stack.md`](docs/humans/08-chosen-tech-stack.md) (summary) · [`docs/agents/chosen-tech-stack.md`](docs/agents/chosen-tech-stack.md) (implementation details)

**Locked stack:** Vite, React, TypeScript, **Supabase** (PostgreSQL + Auth with GitHub), **Hono** Node API server, **`react-force-graph-2d`**, **Prisma** (default) or **Drizzle** when persistence lands.

**Stochastic GitHub crawl (SQLite seed, reusable in backend later):** [`packages/crawler/README.md`](packages/crawler/README.md) · human summary [`docs/humans/09-stochastic-crawl-and-demo-seed.md`](docs/humans/09-stochastic-crawl-and-demo-seed.md).

## Web + API (Supabase GitHub sign-in → bounded graph)

1. **Supabase:** create a project, enable **Auth → Providers → GitHub**, paste **GitHub OAuth App** Client ID + Secret, and add redirect URL **`http://localhost:5173/`** (and your deployed URL later).  
2. **Env files:** copy `apps/web/.env.example` → **`apps/web/.env`** and `apps/server/.env.example` → **`apps/server/.env`**. Use the same **project URL** and **public client key** in both: web uses `VITE_SUPABASE_*`; server uses `SUPABASE_*`. (Supabase may show a legacy JWT **anon** key or a newer **`sb_publishable_…`** key — either works in `createClient` if Supabase documents it for your project.)  
3. **Run both processes** (two terminals, or one combined command):

```bash
npm install
npm run dev:all
```

Or manually:

```bash
npm run dev:server   # API :8787
npm run dev          # Vite :5173, proxies /api → API
```

Open **`http://localhost:5173`**, click **Sign in with GitHub**, then **Load graph**.

### If the UI says “Missing SUPABASE_URL or SUPABASE_ANON_KEY”

That error is from the **API**. Ensure **`apps/server/.env`** exists with `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then **restart** `npm run dev:server`. The server loads **`<repo>/.env` then `apps/server/.env`** (later file wins) using paths relative to the server package so a mismatched `cwd` still finds `apps/server/.env`.

The crawler package remains available (`npm run crawl`) for offline SQLite seeding.
