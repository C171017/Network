# Data model and GitHub field mapping

## Canonical identifiers

- **`githubId`** (number): stable user id from GitHub.
- **`login`** (string): primary human-facing key; can change rarely — still treat `githubId` as merge key when present.

## Graph DTO (server → client)

```typescript
// Pseudotypes for agents — align with actual Zod/io-ts types in implementation
type GraphDTO = {
  rootLogin: string;
  generatedAt: string; // ISO-8601
  caps: { maxFollowers: number; maxFollowing: number };
  truncation: {
    followersTotal?: number | null; // if known from API
    followingTotal?: number | null;
    followersReturned: number;
    followingReturned: number;
  };
  nodes: NodeDTO[];
  edges: EdgeDTO[];
};

type NodeDTO = {
  githubId: number;
  login: string;
  avatarUrl: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null; // blog / site from profile if available
  profileUrl: string; // https://github.com/{login}
  isRoot: boolean;
};

type EdgeDTO = {
  sourceGithubId: number;
  targetGithubId: number;
  kind: "follows"; // directed: source follows target if GitHub meaning is "follower graph"
};
```

**Direction policy (pick one and keep consistent):**

- Option A (recommended for “who can I reach?”): Edge `a → b` means **a follows b** (a is follower of b).
- Option B: invert for visualization preference.

Document the chosen option in code comments once implemented.

## GitHub REST mapping (v0)

| NodeDTO field | REST source |
|---------------|-------------|
| `githubId` | `user.id` |
| `login` | `user.login` |
| `avatarUrl` | `user.avatar_url` |
| `name` | `user.name` |
| `bio` | `user.bio` |
| `company` | `user.company` |
| `location` | `user.location` |
| `websiteUrl` | `user.blog` |
| `profileUrl` | `user.html_url` |

Follow lists: `GET /users/{username}/followers` and `/following` with `per_page` and `page` or Link header pagination.

## LinkedIn

No stable GitHub field. Optional post-v0 heuristic: regex on `bio` and `blog` — return `signals: { possibleLinkedInUrls: string[] }` without pretending certainty.

## Persistence (v1 sketch)

Tables: `users`, `sessions`, `graph_snapshots` (JSONB), `api_usage_events`.

Not required for hackathon if in-memory + cookie session is acceptable risk for demo.
