# Features

Statuses: **v0** (hackathon target), **v1** (soon after), **later**.

## Authentication and identity

| Feature | Status | Notes |
|--------|--------|--------|
| GitHub OAuth | v0 | Prefer server-side token exchange; never expose client secret |
| Session handling | v0 | HTTP-only cookie or equivalent |
| “Start from me” | v0 | Uses OAuth identity |

## Graph data

| Feature | Status | Notes |
|--------|--------|--------|
| Fetch followers | v0 | Hard cap + cursor pagination internally |
| Fetch following | v0 | Same |
| User profile enrichment | v0 | login, name, avatar, bio, location, company, blog URL, public profile URL |
| Parse LinkedIn from bio | later | Heuristics only; low precision is OK if labeled “guess” |

## Visualization and interaction

| Feature | Status | Notes |
|--------|--------|--------|
| Force-directed or similar layout | v0 | Pick one library; see agent stack doc |
| Select node, detail panel | v0 | |
| Re-root expansion from any node | v0 | New bounded fetch from that login |
| Explore by username | v0 | |
| Persist layout between sessions | v1 | Needs small DB or local cache policy |
| Community detection / clustering | later | |

## Performance and fairness

| Feature | Status | Notes |
|--------|--------|--------|
| Global expansion cap | v0 | Per-refresh and per-user |
| Server-side caching of graph JSON | v1 | Redis or DB TTL |
| Job queue for big expansions | later | |

## Mobile

| Feature | Status | Notes |
|--------|--------|--------|
| Responsive web layout | v0 | Enough for demo on phone browser |
| Native app | later | See [05-mobile-later.md](05-mobile-later.md) |
