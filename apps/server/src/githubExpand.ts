import type { Database } from "better-sqlite3";
import type { EdgeDTO, GraphDTO, NodeDTO } from "./graphTypes.js";
import { persistFollowsEdge, persistNode, type NodeRowInput } from "./graphStore.js";

const API = "https://api.github.com";

/** First `per_page` page of “following” (GitHub order ≈ recently followed first). */
export const DEFAULT_FOLLOWING_BRANCH = 5;
/** Expand nodes at depths 0 … maxHopDepth - 1; deepest discovered users sit at `maxHopDepth`. */
export const DEFAULT_MAX_HOP_DEPTH = 3;

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

function toNode(user: GithubUserApi, isRoot: boolean, depth: number, expanded: 0 | 1): NodeDTO {
  return {
    githubId: user.id,
    login: user.login,
    avatarUrl: user.avatar_url,
    name: user.name ?? null,
    bio: user.bio ?? null,
    company: user.company ?? null,
    location: user.location ?? null,
    websiteUrl: user.blog ?? null,
    profileUrl: user.html_url,
    isRoot,
    depth,
    expanded,
  };
}

function toNodeRow(n: NodeDTO, depth: number, expanded: 0 | 1): NodeRowInput {
  return {
    githubId: n.githubId,
    login: n.login,
    depth,
    expanded,
    avatarUrl: n.avatarUrl,
    name: n.name,
    bio: n.bio,
    company: n.company,
    location: n.location,
    blog: n.websiteUrl,
    htmlUrl: n.profileUrl,
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

async function listFollowingFirstN(token: string, login: string, n: number): Promise<GithubUserApi[]> {
  const chunk = await ghFetch<GithubUserApi[]>(
    token,
    `/users/${encodeURIComponent(login)}/following?per_page=${n}&page=1`,
  );
  return chunk.slice(0, n);
}

/**
 * BFS on **following** only: from the root, take the first `branchPerNode` followees per user,
 * up to graph hop depth `maxHopDepth` (root at 0). Each discovered node and directed `follows`
 * edge is appended to SQLite (`nodes`, `edges`) for accumulation across requests.
 */
export async function expandFollowingDepthGraph(params: {
  token: string;
  rootLogin: string;
  db: Database;
  branchPerNode?: number;
  maxHopDepth?: number;
}): Promise<GraphDTO> {
  const { token, rootLogin, db } = params;
  const branchPerNode = params.branchPerNode ?? DEFAULT_FOLLOWING_BRANCH;
  const maxHopDepth = params.maxHopDepth ?? DEFAULT_MAX_HOP_DEPTH;

  const rootUser = await ghFetch<GithubUserApi>(token, `/users/${encodeURIComponent(rootLogin)}`);
  const rootNode = toNode(rootUser, true, 0, 0);
  persistNode(db, toNodeRow(rootNode, 0, 0));

  const nodeById = new Map<number, NodeDTO>();
  nodeById.set(rootNode.githubId, rootNode);

  const edges: EdgeDTO[] = [];

  const queue: Array<{ id: number; login: string; depth: number }> = [
    { id: rootNode.githubId, login: rootNode.login, depth: 0 },
  ];
  const expandedIds = new Set<number>();

  while (queue.length > 0) {
    const u = queue.shift()!;
    if (u.depth >= maxHopDepth) continue;
    if (expandedIds.has(u.id)) continue;
    expandedIds.add(u.id);

    const following = await listFollowingFirstN(token, u.login, branchPerNode);

    const parentDto = nodeById.get(u.id)!;
    persistNode(db, toNodeRow(parentDto, u.depth, 1));
    parentDto.expanded = 1;

    for (const raw of following) {
      const isNew = !nodeById.has(raw.id);
      const child = isNew ? toNode(raw, false, u.depth + 1, 0) : nodeById.get(raw.id)!;
      if (isNew) nodeById.set(child.githubId, child);
      persistNode(db, toNodeRow(child, u.depth + 1, 0));
      persistFollowsEdge(db, u.id, child.githubId);
      edges.push({ sourceGithubId: u.id, targetGithubId: child.githubId, kind: "follows" });
      queue.push({ id: child.githubId, login: child.login, depth: u.depth + 1 });
    }
  }

  return {
    rootLogin: rootNode.login,
    generatedAt: new Date().toISOString(),
    caps: { maxFollowers: 0, maxFollowing: branchPerNode },
    truncation: {
      followersTotal: null,
      followingTotal: null,
      followersReturned: 0,
      followingReturned: edges.length,
    },
    nodes: [...nodeById.values()],
    edges,
  };
}
