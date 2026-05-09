# Vision and scope

## One sentence

A **web** tool that lets a signed-in GitHub user **explore a social graph** built from **public** GitHub relationships (following / followers), enriched with **public profile fields** (for example location, bio, website), rendered as an **interactive network map** with **bounded** expansion so the demo stays fast and respectful of API limits.

## Why GitHub

Many professional graphs are closed. GitHub exposes follow relationships and rich public profiles, which is enough to prototype **discovery**: co-maintainers, interesting repos, potential collaborators — without claiming completeness or private data.

## In scope for the hackathon prototype (intent)

- GitHub OAuth login (so we have a token with higher rate limits and a clear “start from me”).
- Load the authenticated user as the first node; optionally load a **limited** neighborhood (followers and following, capped).
- Graph view: pan, zoom, select node, see side panel with public fields we chose to show.
- Actions: **Explore from this node** (re-root expansion), **Explore by GitHub username** (cold start).
- Clear UX for **“this is a sample of the network, not the full graph”**.

## Explicitly out of scope for v0 (can return later)

- Loading entire follower graphs or unbounded crawling.
- Storing private messages, emails, or non-public data.
- Guaranteed discovery of LinkedIn URLs (bios are unstructured; we can **surface** `blog` / bio text, not promise parsing quality).
- Native mobile apps (see [05-mobile-later.md](05-mobile-later.md)).

## Non-goals (ethics and product honesty)

- This is a **discovery aid**, not background check software.
- Respect [GitHub Terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) and API policies; document what we call and how often.

## Reference project (insights only)

The [Columbia/Barnard social network viz](https://github.com/C171017/Social-Network-Columbia-Barnard) reinforces a few lessons that transfer here:

- **Separate** “data shaping” from “rendering” so the UI stays responsive.
- **Precompute** hop or depth labels if we need readable layers (optional for GitHub v0).
- Watch **label density** and **layout performance** early; a pretty graph that is unreadable loses the demo.
