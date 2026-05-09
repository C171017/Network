# Docs for agents (code generation)

These files are **implementation-oriented**: contracts, algorithms, stack tradeoffs, and checklists. They should stay synchronized with product meaning in `docs/humans/` when features change.

## Index

| File | Use when |
|------|----------|
| [conventions.md](conventions.md) | Repo layout, naming, doc update rule |
| [chosen-tech-stack.md](chosen-tech-stack.md) | **Locked** stack: Vite, React, TS, Supabase, ORM, env vars, repo shape |
| [tech-stack-options.md](tech-stack-options.md) | Choosing and defending stack; pros/cons |
| [architecture-target-state.md](architecture-target-state.md) | Components, boundaries, deployment sketch |
| [data-model-and-github-mapping.md](data-model-and-github-mapping.md) | JSON types, REST/GraphQL field map |
| [github-api-and-auth.md](github-api-and-auth.md) | OAuth, scopes, rate limits, endpoints |
| [data-pulling-storage-and-formats.md](data-pulling-storage-and-formats.md) | How/when we pull, volume, timing, format & DB comparison tables |
| [graph-expansion-algorithm.md](graph-expansion-algorithm.md) | Caps, pagination, merge, dedupe |
| [stochastic-crawl-mechanism.md](stochastic-crawl-mechanism.md) | Random-6 first-degree sample per node, multi-wave crawl, SQLite seed |
| [implementation-phases.md](implementation-phases.md) | Ordered tasks + acceptance criteria |

## Agent workflow

1. Read `chosen-tech-stack.md`, `architecture-target-state.md`, and `data-model-and-github-mapping.md` before generating code.
2. Implement against **frozen JSON contracts**; if you must change a contract, update this folder and the human feature doc in the same change set.
3. Prefer **server-side** GitHub token usage for OAuth-based flows.
