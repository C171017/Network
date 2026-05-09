# Mobile app migration plan (later)

## Principle

Treat the **backend + domain model + GitHub integration** as the product core. The hackathon delivers a **web client**. A future native app is another **client** of the same APIs.

## Why web first (18-hour reality)

- OAuth and redirect flows are well trodden in browsers.
- One codebase hits demo laptops and phones via responsive layout.
- Graph interaction is faster to validate in web canvas/WebGL/SVG than app store submission.

## What to do now so mobile is not painful

1. **Backend-for-frontend (BFF) or small API layer** — with **Vite + a Node API**, keep “GitHub talking” logic in server modules that do not assume `window` (same idea as a single Next.js route namespace, but explicit).
2. **Stable JSON shapes** for `Node`, `Edge`, `ExpansionRequest`, `ExpansionResponse` (documented in `docs/agents/data-model-and-github-mapping.md`).
3. **Token storage** — never ship GitHub client secret to mobile; use the same server-mediated OAuth or a mobile-safe OAuth PKCE flow later.
4. **Pagination contracts** — every list that can explode (followers) should already be cursor-based internally.

## Later mobile options (high level)

| Approach | Pros | Cons |
|----------|------|------|
| **Responsive PWA** | Cheapest; reuses all UI | Less “native feel”; graph perf on low-end devices |
| **React Native / Expo** | Reuse React mental model | Graph lib choices differ; more glue |
| **Flutter** | Strong custom rendering | Rewrite UI layer |

Recommendation after hackathon: ship **PWA + responsive** first; revisit native if you need push, offline-first graph, or App Store distribution.
