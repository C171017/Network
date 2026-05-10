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
