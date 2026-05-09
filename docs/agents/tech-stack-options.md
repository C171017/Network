# Tech stack options (prototype speed vs future scale)

Assumptions: **18-hour-class hackathon**, **web-first**, **GitHub OAuth**, **bounded graph**, you will keep building after.

## Recommended default (balanced)

**Next.js (App Router) + TypeScript + React** on the frontend, **Route Handlers / server actions** for OAuth and GitHub calls, **PostgreSQL** (Neon, Supabase, or RDS) for sessions and future cache, **react-force-graph-2d** or **sigma.js** for the graph.

**Why this default:** one deployable unit on Vercel-like hosts, clear server boundary for secrets, PostgreSQL grows cleanly into cache + user data + audit logs.

---

## Frontend framework

| Option | Pros | Cons |
|--------|------|------|
| **Next.js (App Router)** | OAuth and API routes colocated; huge ecosystem; easy deploy | Some “where does code run” footguns if you leak server imports into client |
| **Remix** | Excellent data loading and forms; clear server/client split | Slightly less default mindshare for “tiny SaaS on Vercel” than Next (still fine) |
| **SvelteKit** | Fast to build small UIs; pleasant DX | Hiring pool / agent codegen familiarity often lower than React |
| **Vite + React SPA + separate Express** | Very explicit boundaries | Two deployables or custom glue; more wiring in 18h |

**Future-proof note:** Pick **one** UI framework you will tolerate maintaining; the long-term lock-in is **data contracts**, not the SPA framework.

---

## Graph rendering

| Option | Pros | Cons |
|--------|------|------|
| **react-force-graph** | Fastest path to a “wow” force layout in React | Many nodes → perf tuning needed; labels need custom work |
| **sigma.js (WebGL)** | Strong for medium/large graphs | More setup; less “drop in” than react-force-graph |
| **Cytoscape.js** | Great for stylized networks and algorithms | Heavier; learning curve |
| **D3 (custom)** | Maximum control | Slowest for hackathon unless you already know D3 |

**Insight from prior project:** readability and label logic dominate perceived quality; budget time for **LOD** (hide labels until zoom) even in v0 if possible.

---

## Backend shape

| Option | Pros | Cons |
|--------|------|------|
| **Next route handlers (BFF)** | Single repo; secrets on server only | Must discipline imports so tokens never hit client bundles |
| **Separate small Fastify/Hono service** | Crystal-clear boundary for future mobile | Extra deploy + CORS for hackathon |
| **Serverless functions only** | Scales to zero | Cold starts; OAuth token refresh patterns need care |

**Future-proof:** Keep “GitHub expand user” as a **pure function** of `(token | anon), rootLogin, caps` returning a graph DTO. UI only renders DTOs.

---

## Database

| Option | Pros | Cons |
|--------|------|------|
| **PostgreSQL** | Standard for growth; JSONB for flexible graph snapshots; good hosted options | Slightly more setup than “no DB” |
| **SQLite (Turso/libSQL)** | Very fast hackathon start; edge-friendly | Operational model differs from classic Postgres; still viable at scale with Turso |
| **Redis only** | Great cache | Weak as primary store for durable user data unless paired |

**Hackathon shortcut:** start with **Postgres** if you already have a Neon/Supabase account; otherwise **SQLite file** for session store only, accepting a migration task post-hackathon.

---

## Auth

| Option | Pros | Cons |
|--------|------|------|
| **NextAuth.js / Auth.js** | OAuth providers built-in | Config learning curve |
| **Lucia + Arctic** | Lightweight, explicit | More manual wiring |
| **Manual OAuth** | Full control | Easy to get wrong; not ideal in 18h unless you know it |

Recommendation: **Auth.js** with GitHub provider unless the team strongly prefers something else.

---

## GitHub API surface

| Option | Pros | Cons |
|--------|------|------|
| **REST** (`/user`, `/users/{login}/followers`, pagination) | Straightforward for follow lists | More round trips unless batched carefully |
| **GraphQL** | Flexible field selection; can combine some queries | Rate limit model differs; caching strategy must be explicit |

**Pragmatic v0:** REST for follower/following lists + REST user profile; revisit GraphQL when optimizing round trips.

---

## Monorepo vs single package

| Option | Pros | Cons |
|--------|------|------|
| **Single Next app** | Fastest | Can get messy without folders discipline |
| **Turborepo (web + packages/github)** | Clean extraction for future mobile client | Extra boilerplate in 18h |

Recommendation: **single app** for hackathon; create `src/lib/github/` and `src/lib/graph/` as if they were packages.

---

## Decision log (fill when locked)

| Decision | Choice | Date | Rationale |
|----------|--------|------|-----------|
| Web framework | TBD | | |
| Graph library | TBD | | |
| DB | TBD | | |
| Auth library | TBD | | |
| Host | TBD | | |
