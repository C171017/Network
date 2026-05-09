# User journeys (prototype)

## Journey A — “Start from me”

1. User clicks **Sign in with GitHub** and approves the OAuth app.
2. The app shows the user as a **root node** and loads a **bounded** set of connections (for example: up to N followers and N following, with pagination or “load more” deferred if time runs out).
3. User pans/zooms the graph, clicks a person, reads **public** profile summary in a side panel (avatar, name, bio snippet, location if set, link to GitHub profile, optional website field).
4. User clicks **Make root** on that person; the client requests a **new** bounded subgraph centered on that login (same limits as step 2).

## Journey B — “Explore someone else”

1. User types a GitHub **username** (no login strictly required for *public* data reads if we use unauthenticated requests only — but rate limits are harsh; see open questions).
2. Same graph + panel behavior as Journey A.

## Journey C — “Find a project angle” (stretch)

1. From a selected user, user opens a **Repos** tab (public repos only), sorted by stars or recency, capped count.
2. User opens a repo on GitHub in a new tab. (Deep integration with “contribute” flows is post-hackathon.)

## Failure modes we should design for

- **Rate limited:** friendly message + backoff, never silent empty graph if we can explain why.
- **Private / empty profile:** show what we have; do not fabricate fields.
- **Huge accounts:** always cap; show “showing first N of M” when counts are available.
