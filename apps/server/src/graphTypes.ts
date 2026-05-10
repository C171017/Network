/** Aligned with docs/agents/data-model-and-github-mapping.md */

export type NodeDTO = {
  githubId: number;
  login: string;
  avatarUrl: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  profileUrl: string;
  isRoot: boolean;
  /** Graph hop depth from crawl or SQLite row (legend / color-by). */
  depth: number;
  /** 1 if this node had its following list fetched during crawl. */
  expanded: 0 | 1;
  /** Full `GET /users/{login}` payload when crawled (also stored as JSON in SQLite). */
  profile: Record<string, unknown> | null;
};

export type EdgeDTO = {
  sourceGithubId: number;
  targetGithubId: number;
  kind: "follows";
};

export type GraphDTO = {
  rootLogin: string;
  generatedAt: string;
  caps: { maxFollowers: number; maxFollowing: number };
  truncation: {
    followersTotal: number | null;
    followingTotal: number | null;
    followersReturned: number;
    followingReturned: number;
  };
  nodes: NodeDTO[];
  edges: EdgeDTO[];
};
