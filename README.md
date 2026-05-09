# Network (GitHub social graph explorer)

Hackathon prototype: visualize **public** GitHub follow/follower relationships from a chosen root user, with **bounded** expansion for performance and API fairness.

**All design and architecture docs live under [`docs/`](docs/README.md).**

- **Human-readable:** [`docs/humans/`](docs/humans/README.md)
- **Agent / codegen-oriented:** [`docs/agents/`](docs/agents/README.md)
- **Chosen tech stack:** [`docs/humans/08-chosen-tech-stack.md`](docs/humans/08-chosen-tech-stack.md) (summary) · [`docs/agents/chosen-tech-stack.md`](docs/agents/chosen-tech-stack.md) (implementation details)

**Locked stack:** Vite, React, TypeScript, **Supabase** (PostgreSQL + Auth with GitHub), Node API server, **Prisma** (default) or **Drizzle**.

**Stochastic GitHub crawl (SQLite seed, reusable in backend later):** [`packages/crawler/README.md`](packages/crawler/README.md) · human summary [`docs/humans/09-stochastic-crawl-and-demo-seed.md`](docs/humans/09-stochastic-crawl-and-demo-seed.md).

The web app scaffold described in docs may land next; the crawler package is runnable today (`npm run crawl` from root after `npm install`).
