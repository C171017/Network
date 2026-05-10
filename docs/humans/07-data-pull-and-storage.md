# How we get data (simple version)

## Pull

- The **server** calls GitHub’s **JSON** APIs over HTTPS using the user’s **OAuth** login (or a dev token). The browser does not hold your GitHub secret.
- For each “explore this person,” we load **only a slice**: their profile plus up to **N** followers and **N** people they follow (numbers we still pick as a team). We do **not** download whole giant follower lists.

## Realism and speed

- With login, GitHub allows **thousands** of API calls per hour per user context — plenty for a **capped** one-hop map.
- Without login, limits are tiny — **not** good for a public “try any username” demo unless we add caching or require sign-in.
- A typical one-hop load is often **about one to a few seconds** on good Wi‑Fi if we keep caps modest.

## Formats (plain English)

- **GitHub → us:** always **JSON** over the network.
- **Us → browser:** our own **JSON** shape (the graph package the UI draws).
- **CSV:** not from GitHub; we’d only add CSV if **we** export data for spreadsheets (optional, later).
- **Database:** **Supabase** covers **accounts and sessions** (Auth + hosted **PostgreSQL** for the product’s long-term path). The **live hackathon slice** stores expanded **nodes and edges in a local SQLite file** on the API server (`better-sqlite3`). Later we can mirror graph snapshots into **Postgres** (for example **JSONB**) and use an **ORM** (Prisma or Drizzle) for typed access — see [`08-chosen-tech-stack.md`](08-chosen-tech-stack.md).

Tables, exact request counts, and storage tradeoffs: [`../agents/data-pulling-storage-and-formats.md`](../agents/data-pulling-storage-and-formats.md).
