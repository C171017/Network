import type { Database } from "better-sqlite3";
import { githubProfilePageUrl } from "./githubProfileUrl.js";
import type { EdgeDTO, GraphDTO, NodeDTO } from "./graphTypes.js";
import { persistFollowsEdge, persistNode, type NodeRowInput } from "./graphStore.js";

const API = "https://api.github.com";

/** First `per_page` page per side (following / followers); GitHub order ≈ recent first. */
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
    profileUrl: githubProfilePageUrl(user.login, user.html_url),
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

async function listFollowersFirstN(token: string, login: string, n: number): Promise<GithubUserApi[]> {
  const chunk = await ghFetch<GithubUserApi[]>(
    token,
    `/users/${encodeURIComponent(login)}/followers?per_page=${n}&page=1`,
  );
  return chunk.slice(0, n);
}

/**
 * BFS using **both** directions per user: up to `branchFollowing` accounts they follow (outgoing)
 * and up to `branchFollowers` followers (incoming). Edges stay canonical: `source → target` means
 * source follows target. Depth is hop count from the root in this mixed graph. All nodes and
 * edges are written to SQLite (`nodes`, `edges`) for accumulation across requests.
 */
export async function expandFollowingDepthGraph(params: {
  token: string;
  rootLogin: string;
  db: Database;
  /** Cap on outgoing “following” fetches per expanded user. */
  branchFollowing?: number;
  /** Cap on incoming “followers” fetches per expanded user (defaults to `branchFollowing`). */
  branchFollowers?: number;
  maxHopDepth?: number;
}): Promise<GraphDTO> {
  const { token, rootLogin, db } = params;
  const branchFollowing = params.branchFollowing ?? DEFAULT_FOLLOWING_BRANCH;
  const branchFollowers = params.branchFollowers ?? branchFollowing;
  const maxHopDepth = params.maxHopDepth ?? DEFAULT_MAX_HOP_DEPTH;

  const rootUser = await ghFetch<GithubUserApi>(token, `/users/${encodeURIComponent(rootLogin)}`);
  const rootNode = toNode(rootUser, true, 0, 0);
  persistNode(db, toNodeRow(rootNode, 0, 0));

  const nodeById = new Map<number, NodeDTO>();
  nodeById.set(rootNode.githubId, rootNode);

  const edges: EdgeDTO[] = [];
  const edgeKeySeen = new Set<string>();

  const queue: Array<{ id: number; login: string; depth: number }> = [
    { id: rootNode.githubId, login: rootNode.login, depth: 0 },
  ];
  const expandedIds = new Set<number>();

  let followingReturned = 0;
  let followersReturned = 0;

  function addFollowsEdge(sourceId: number, targetId: number): void {
    const key = `${sourceId}->${targetId}`;
    if (edgeKeySeen.has(key)) return;
    edgeKeySeen.add(key);
    persistFollowsEdge(db, sourceId, targetId);
    edges.push({ sourceGithubId: sourceId, targetGithubId: targetId, kind: "follows" });
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    if (u.depth >= maxHopDepth) continue;
    if (expandedIds.has(u.id)) continue;
    expandedIds.add(u.id);

    const [following, followers] = await Promise.all([
      listFollowingFirstN(token, u.login, branchFollowing),
      listFollowersFirstN(token, u.login, branchFollowers),
    ]);

    const parentDto = nodeById.get(u.id)!;
    persistNode(db, toNodeRow(parentDto, u.depth, 1));
    parentDto.expanded = 1;

    for (const raw of following) {
      const isNew = !nodeById.has(raw.id);
      const child = isNew ? toNode(raw, false, u.depth + 1, 0) : nodeById.get(raw.id)!;
      if (isNew) nodeById.set(child.githubId, child);
      persistNode(db, toNodeRow(child, u.depth + 1, 0));
      addFollowsEdge(u.id, child.githubId);
      followingReturned++;
      queue.push({ id: child.githubId, login: child.login, depth: u.depth + 1 });
    }

    for (const raw of followers) {
      // GitHub: raw is a follower of u → raw follows u
      const isNew = !nodeById.has(raw.id);
      const follower = isNew ? toNode(raw, false, u.depth + 1, 0) : nodeById.get(raw.id)!;
      if (isNew) nodeById.set(follower.githubId, follower);
      persistNode(db, toNodeRow(follower, u.depth + 1, 0));
      addFollowsEdge(follower.githubId, u.id);
      followersReturned++;
      queue.push({ id: follower.githubId, login: follower.login, depth: u.depth + 1 });
    }
  }

  return {
    rootLogin: rootNode.login,
    generatedAt: new Date().toISOString(),
    caps: { maxFollowers: branchFollowers, maxFollowing: branchFollowing },
    truncation: {
      followersTotal: null,
      followingTotal: null,
      followersReturned,
      followingReturned,
    },
    nodes: [...nodeById.values()],
    edges,
  };
}
