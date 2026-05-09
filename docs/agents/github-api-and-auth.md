# GitHub API and authentication

## OAuth scopes (minimal)

For public-only prototype:

- Start with **no extra scopes** beyond read implied by default, if using standard GitHub OAuth App read patterns for **public** data.
- If using endpoints that require `read:user` or similar, add explicitly and document why.

Always prefer **least privilege**.

## Rate limiting (high level)

- **Authenticated** REST primary limit: **5,000 requests/hour** per user/app context on GitHub.com (standard; Enterprise differs) — see [GitHub docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- **Unauthenticated**: **60 requests/hour** per IP — not suitable for multi-user demo unless heavily cached.

For pull volume, request math, wall-clock estimates, and storage format choices, read [`data-pulling-storage-and-formats.md`](data-pulling-storage-and-formats.md).

**Agent rule:** centralize GitHub calls; log status codes; on `403` with rate limit headers, surface structured error to UI.

## Endpoints (REST v0)

| Purpose | Endpoint |
|---------|----------|
| Current user | `GET /user` |
| Public user | `GET /users/{login}` |
| Followers | `GET /users/{login}/followers` |
| Following | `GET /users/{login}/following` |

Use `If-None-Match` / caching headers opportunistically post-hackathon.

## Security

- `GITHUB_CLIENT_SECRET` only on server.
- Do not forward user access tokens to browser.
- CSRF protection for OAuth callback (framework middleware usually handles).

## Compliance pointers for docs/UI

Link GitHub’s terms and clarify the app shows **public** data only in v0.
