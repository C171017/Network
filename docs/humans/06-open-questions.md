# Open questions (please answer to lock architecture)

**Stack (web + DB + auth shape) is locked** in [`08-chosen-tech-stack.md`](08-chosen-tech-stack.md) and [`../agents/chosen-tech-stack.md`](../agents/chosen-tech-stack.md) (Vite, React, TypeScript, **Supabase Auth** with GitHub, **Hono** API, **Skia** graph UI, **SQLite** graph file on the server today, **Supabase Postgres** + **Prisma or Drizzle** for future durable app tables beyond the file).

Copy answers inline or reply in chat; we will propagate decisions into `docs/agents/`.

## Product

1. **Primary demo persona:** Who is the one-sentence story for judges — *founders hiring*, *OSS contributors*, or *general curiosity*? That affects which side panel fields matter most.
2. **Cold start without login:** Do you want username exploration **without** OAuth? (Public API only → strict rate limits unless we add server caching or proxied token.)
3. **“LinkedIn” expectation:** Is it acceptable if v0 only shows **raw bio + website** with no special LinkedIn detection?

## Data volume

4. **First-hop caps:** What default **N** for max followers and max following per expansion (for example 50 / 100 / 200)?
5. **Second hop in v0:** Do we ever load **friends-of-friends** in the hackathon, or strictly one hop from the active root?

## Legal and branding

6. **OAuth app ownership:** Personal GitHub OAuth app vs org; who holds **client secret** in deployment?
7. **Data retention:** After hackathon, do we plan to **store** graph snapshots per user? (Affects DB choice and privacy copy.)

## Team and ops

8. **Deploy target:** Vercel, Railway, Fly.io, or “local only” for judging? (Stack is chosen; **host** is still open — record in `docs/agents/chosen-tech-stack.md` when decided.)
9. **Monorepo tooling:** npm, pnpm, or bun? (**Docs default:** pnpm — change root README and agent stack doc if you standardize on npm or bun.)

---

When the remaining items are answered, propagate them into `docs/agents/chosen-tech-stack.md`, `architecture-target-state.md`, and any env templates in the root README.
