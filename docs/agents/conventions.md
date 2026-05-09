# Conventions for this repo

## Documentation

- **Humans** path: `docs/humans/` — short, intent-first.
- **Agents** path: `docs/agents/` — contracts and algorithms.
- Any change to user-visible behavior: touch **both** if the humans doc describes that behavior.

## Code (to be created; preliminary)

- **Package manager:** TBD (see open questions); lock in root README when chosen.
- **Secrets:** `.env` locally; never commit. Document required keys in root README only by **name**, not values.
- **GitHub integration:** isolate in a module like `server/github/` or `packages/github-client/` so a future mobile client hits the same server API.

## API naming (suggested)

- `POST /api/graph/expand` — body: `{ rootLogin: string, maxFollowers?: number, maxFollowing?: number }`
- `GET /api/me` — session user summary (optional if folded into expand)

Adjust in `architecture-target-state.md` if we pick a framework with different idioms (tRPC, server actions only, etc.).
