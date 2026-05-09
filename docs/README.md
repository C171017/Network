# Documentation map

This repository splits documentation into two parallel trees so hackathon work stays fast while post-hackathon scaling stays honest.

| Audience | Folder | Purpose |
|----------|--------|---------|
| People (you, judges, collaborators) | [`humans/`](humans/README.md) | Vision, features, roadmap, mobile-later story, open questions |
| Coding agents / future you | [`agents/`](agents/README.md) | Contracts, APIs, data shapes, algorithms, stack rationale, phased checklists |

**Convention:** When behavior or architecture changes, update the relevant file in **both** trees if it affects product meaning (humans) or implementation truth (agents).

**Reference only:** [Social-Network-Columbia-Barnard](https://github.com/C171017/Social-Network-Columbia-Barnard) — useful patterns: deterministic data prep, graph JSON (`nodes` / `links`), hop-depth ideas, cycle compression for metrics, and the reminder to budget **computation and label readability** early.

---

## Suggested reading order

1. [`humans/01-vision-and-scope.md`](humans/01-vision-and-scope.md)
2. [`humans/07-data-pull-and-storage.md`](humans/07-data-pull-and-storage.md) — how we pull, how much, formats, DB in plain language
3. [`humans/03-features.md`](humans/03-features.md)
4. [`agents/data-pulling-storage-and-formats.md`](agents/data-pulling-storage-and-formats.md) — detailed tables, timing, format comparison
5. [`agents/tech-stack-options.md`](agents/tech-stack-options.md) (skim tables; details when you pick a stack)
6. [`agents/architecture-target-state.md`](agents/architecture-target-state.md)
7. [`humans/06-open-questions.md`](humans/06-open-questions.md) — answer these to lock v0

---

## Hackathon time budget (rough)

Assume ~13 hours of build time if ~5 hours are sleep or travel. Docs here assume **documentation first**, then a **vertical slice**: login → seed graph from “me” → limited expansion → interactive graph → “set as root” / “explore by username”.
