import type { EdgeDTO, GraphDTO, NodeDTO } from "./graphTypes.js";

const API = "https://api.github.com";

type GithubUserApi = {
  id: number;
  login: string;
  avatar_url: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  html_url: string;
};

function toNode(d: GithubUserApi, isRoot: boolean): NodeDTO {
  return {
    githubId: d.id,
    login: d.login,
    avatarUrl: d.avatar_url,
    name: d.name,
    bio: d.bio,
    company: d.company,
    location: d.location,
    websiteUrl: d.blog,
    profileUrl: d.html_url,
    isRoot,
  };
}

async function ghFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 403 || res.status === 429) {
    const retry = res.headers.get("retry-after");
    throw new Error(
      `GitHub rate limit or forbidden (${res.status}). ${retry ? `retry-after: ${retry}` : ""} ${await res.text()}`,
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${path}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function listUsers(
  token: string,
  login: string,
  kind: "followers" | "following",
  maxItems: number,
): Promise<GithubUserApi[]> {
  const out: GithubUserApi[] = [];
  for (let page = 1; page <= 20 && out.length < maxItems; page += 1) {
    const chunk = await ghFetch<GithubUserApi[]>(
      token,
      `/users/${encodeURIComponent(login)}/${kind}?per_page=100&page=${page}`,
    );
    if (chunk.length === 0) break;
    for (const u of chunk) {
      out.push(u);
      if (out.length >= maxItems) break;
    }
    if (chunk.length < 100) break;
  }
  return out;
}

/**
 * Star graph: edges only between root and first-hop neighbors.
 * Directed "follows": follower -> root for followers; root -> followee for following.
 */
export async function expandStarGraph(params: {
  token: string;
  rootLogin: string;
  maxFollowers: number;
  maxFollowing: number;
}): Promise<GraphDTO> {
  const { token, rootLogin, maxFollowers, maxFollowing } = params;

  const root = await ghFetch<GithubUserApi>(
    token,
    `/users/${encodeURIComponent(rootLogin)}`,
  );

  const [followers, following] = await Promise.all([
    listUsers(token, root.login, "followers", maxFollowers),
    listUsers(token, root.login, "following", maxFollowing),
  ]);

  const nodeById = new Map<number, NodeDTO>();
  const rootNode = toNode(root, true);
  nodeById.set(rootNode.githubId, rootNode);

  const edges: EdgeDTO[] = [];

  for (const f of followers) {
    const n = toNode(f, false);
    nodeById.set(n.githubId, n);
    edges.push({ sourceGithubId: n.githubId, targetGithubId: rootNode.githubId, kind: "follows" });
  }
  for (const t of following) {
    const n = toNode(t, false);
    nodeById.set(n.githubId, n);
    edges.push({ sourceGithubId: rootNode.githubId, targetGithubId: n.githubId, kind: "follows" });
  }

  return {
    rootLogin: root.login,
    generatedAt: new Date().toISOString(),
    caps: { maxFollowers, maxFollowing },
    truncation: {
      followersTotal: null,
      followingTotal: null,
      followersReturned: followers.length,
      followingReturned: following.length,
    },
    nodes: [...nodeById.values()],
    edges,
  };
}
