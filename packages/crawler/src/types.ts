export type GithubUserSlim = {
  id: number;
  login: string;
  avatar_url: string;
};

/**
 * Public user payload from `GET /users/{username}` (GitHub REST).
 * Stored as JSON in SQLite `nodes.profile_json` for full-fidelity crawl records.
 */
export type GithubPublicUser = GithubUserSlim & {
  node_id?: string;
  gravatar_id?: string | null;
  url?: string;
  html_url: string;
  followers_url?: string;
  following_url?: string;
  gists_url?: string;
  starred_url?: string;
  subscriptions_url?: string;
  organizations_url?: string;
  repos_url?: string;
  events_url?: string;
  received_events_url?: string;
  type?: string;
  site_admin?: boolean;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  hireable: boolean | null;
  bio: string | null;
  twitter_username?: string | null;
  public_repos?: number;
  public_gists?: number;
  followers?: number;
  following?: number;
  created_at?: string;
  updated_at?: string;
};

/** @deprecated Use GithubPublicUser — kept for older imports */
export type GithubUserFull = GithubPublicUser;

/** One row from `GET /users/{username}/social_accounts` (LinkedIn, X, etc.). */
export type GithubSocialAccount = {
  provider: string;
  url: string;
};

/** Subset of `GET /users/{username}/orgs` entries (public org memberships). */
export type GithubPublicOrganization = {
  login: string;
  id: number;
  node_id?: string;
  url?: string;
  repos_url?: string;
  events_url?: string;
  hooks_url?: string;
  issues_url?: string;
  members_url?: string;
  public_members_url?: string;
  avatar_url: string;
  description: string | null;
  html_url?: string;
};

export type NeighborEdge = "incoming" | "outgoing" | "mutual";

export type NeighborPick = {
  user: GithubUserSlim;
  edge: NeighborEdge;
};

export type StochasticCrawlConfig = {
  token: string;
  seedLogin: string;
  /** Random neighbors sampled per expanded node (you chose 6; range 4–8 supported). */
  branchSample: number;
  /** How many hops from seed to expand (seed depth 0 expands if maxDepth > 0). */
  maxDepth: number;
  /** Max GitHub list pages per side (followers / following) when building the pool to sample from. */
  maxPagesPerSide: number;
  /** Stop after expanding this many distinct logins (API budget guard). */
  maxExpansions: number;
  /** SQLite path for nodes/edges. */
  dbPath: string;
  /** When true, clears `nodes` and `edges` before crawling (fresh demo seed). */
  reset?: boolean;
};

export type CrawlStats = {
  nodesUpserted: number;
  edgesUpserted: number;
  expansions: number;
  apiRequests: number;
  stoppedReason: "complete" | "max_expansions" | "empty_frontier" | "rate_limited";
};
