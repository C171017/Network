# Graph expansion algorithm (bounded)

## Stochastic multi-hop crawl (preferred for hackathon seed + backend jobs)

For **random 6 of first-degree** per node, **multiple waves** (default depth 5), and **SQLite persistence**, use the shared crawler documented in [`stochastic-crawl-mechanism.md`](stochastic-crawl-mechanism.md) and implemented in `packages/crawler/`. That path is the **single mechanism** meant for:

- local pre-seeding before demos, and  
- future server-side jobs after OAuth.

The sections below describe the older **star + numeric caps** approach (still valid for a minimal live API response without DB crawl).

## Inputs (star-cap mode)

- `rootLogin: string`
- `maxFollowers`, `maxFollowing` (hard caps)
- Optional: `authToken` for higher quotas

## Output

`GraphDTO` with nodes for:

- `root` (always)
- Each unique user returned in follower and following pages up to caps

Edges: follow relationships among nodes **present in this response** (optional v0 simplification: edges only from root ↔ neighbors; see below).

## Pagination strategy

1. Fetch root profile (`GET /users/{login}`).
2. Iterate followers with `per_page = 100` until `maxFollowers` unique users collected or list exhausted.
3. Same for following.
4. For each neighbor user object returned in list endpoints, GitHub often returns slim user objects; **batch profile enrichment** if bios/locations missing:
   - v0 shortcut: skip extra profile fetches to save time; show avatars + logins only.
   - v0.5: `GET /users/{login}` for K highest-degree or selected node only.

## Edge construction modes

| Mode | Complexity | Demo quality |
|------|------------|--------------|
| **Star** | Only edges between root and neighbors | Fast; misses cliques between neighbors |
| **Clique attempt** | Also fetch follow relationships between neighbors | Too heavy for v0 |

**Recommendation v0:** star graph edges only; document truncation clearly in UI.

## Deduping

- Merge nodes by `githubId`.
- If collision on login (should not happen with id), prefer id.

## Re-rooting

When user selects `newRootLogin`, discard or **fade** previous graph (UX choice) and call expand again. Optional: merge into super-graph client-side — only if time; can confuse layout.

## Optional: hop labels (from prior project insight)

If we need “layers”, compute BFS depth from root on the **star** graph (everyone depth 1). Skip Tarjan/SCC unless we add neighbor-neighbor edges later.
