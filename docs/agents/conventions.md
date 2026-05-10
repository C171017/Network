# Conventions for this repo

## Documentation

- **Humans** path: `docs/humans/` — short, intent-first.
- **Agents** path: `docs/agents/` — contracts and algorithms.
- Any change to user-visible behavior: touch **both** if the humans doc describes that behavior.

## Code (to be created; preliminary)

- **Stack:** Vite + React + TypeScript (web), Node API server (TS), **Supabase Auth** (GitHub) + hosted Postgres for the growth path, **SQLite** graph file on the API server today, **Skia** (`@shopify/react-native-skia`) for the graph UI, **Prisma** (default) or **Drizzle** when you add Postgres migrations. Source of truth: `chosen-tech-stack.md`.
- **Package manager:** **pnpm** recommended; override in root README if the team picks npm or bun.
- **Secrets:** `.env` locally; never commit. Document required keys in root README only by **name**, not values (see `chosen-tech-stack.md` for the variable list).
- **GitHub integration:** isolate in a module like `apps/server/github/` or `packages/github-client/` so a future mobile client hits the same server API.

## API naming (suggested)

- `POST /api/graph/expand` — body: `{ rootLogin: string, maxFollowers?: number, maxFollowing?: number }`
- `GET /api/me` — session user summary (optional if folded into expand)

Adjust in `architecture-target-state.md` if we pick a framework with different idioms (tRPC, server actions only, etc.).
