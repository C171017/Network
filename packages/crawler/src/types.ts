export type GithubUserSlim = {
  id: number;
  login: string;
  avatar_url: string;
};

export type GithubUserFull = GithubUserSlim & {
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  html_url: string;
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
