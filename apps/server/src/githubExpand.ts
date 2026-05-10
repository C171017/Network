import type { Database } from "better-sqlite3";
import {
  expandProfileRecord,
  type GithubPublicOrganization,
  type GithubPublicUser,
  type GithubSocialAccount,
} from "@network/crawler";
import { githubProfilePageUrl } from "./githubProfileUrl.js";
import type { EdgeDTO, GraphDTO, NodeDTO } from "./graphTypes.js";
import { persistFollowsEdge, persistNode, type NodeRowInput } from "./graphStore.js";

const API = "https://api.github.com";

/** Target neighbors to keep per side (following / followers) after tiered selection. */
export const DEFAULT_FOLLOWING_BRANCH = 2;
/** Max `per_page` for list endpoints (GitHub allows up to 100). */
export const DEFAULT_LIST_PER_PAGE = 100;
/**
 * List pages to fetch before the first selection pass (strict → location → any within that pool).
 * Stays on a small first budget so we prefer not to over-fetch when the first page is enough.
 */
export const DEFAULT_FIRST_BUDGET_PAGES = 1;
/**
 * Max cumulative list pages per side. After pages 1…firstBudget are exhausted without filling
 * `branch*` targets, we fetch additional pages up to this cap before falling back to tier 3 on pool.
 */
export const DEFAULT_SECOND_BUDGET_PAGES = 3;
/**
 * Max `GET /users/{login}` calls per side when turning list “simple users” into full profiles
 * so tier 1–2 (location / company / avatar fields) can use real values. Lists omit location/company.
 */
export const DEFAULT_PROFILE_ENRICH_PER_SIDE = 45;
/** Expand nodes at depths 0 … maxHopDepth - 1; deepest discovered users sit at `maxHopDepth`. */
export const DEFAULT_MAX_HOP_DEPTH = 3;

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

const MAX_PUBLIC_LIST_PAGES = 10;

async function ghFetchAllPages<T>(token: string, pathWithoutQuery: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PUBLIC_LIST_PAGES; page++) {
    const chunk = await ghFetch<T[]>(token, `${pathWithoutQuery}?per_page=100&page=${page}`);
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

/**
 * Public supplemental data merged into `profile_json` (alongside full `GET /users/{login}` payload).
 */
async function fetchProfileAugments(token: string, login: string): Promise<{
  social_accounts: GithubSocialAccount[];
  organizations: GithubPublicOrganization[];
}> {
  const enc = encodeURIComponent(login);
  const [social_accounts, organizations] = await Promise.all([
    ghFetchAllPages<GithubSocialAccount>(token, `/users/${enc}/social_accounts`),
    ghFetchAllPages<GithubPublicOrganization>(token, `/users/${enc}/orgs`),
  ]);
  return { social_accounts, organizations };
}

function hasPresent(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

function hasProfilePic(u: GithubPublicUser): boolean {
  return hasPresent(u.avatar_url);
}

function matchesTier1(u: GithubPublicUser): boolean {
  return hasPresent(u.location) && hasPresent(u.company) && hasProfilePic(u);
}

function matchesTier2(u: GithubPublicUser): boolean {
  return hasPresent(u.location);
}

function dedupeByGithubId(users: GithubPublicUser[]): GithubPublicUser[] {
  const seen = new Set<number>();
  const out: GithubPublicUser[] = [];
  for (const u of users) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Merge full-profile responses (`GET /users/{login}`) over list payloads for neighbor scoring. */
function materializePool(
  pool: GithubPublicUser[],
  enriched: Map<number, GithubPublicUser>,
): GithubPublicUser[] {
  return pool.map((u) => enriched.get(u.id) ?? u);
}

/** Lists return Simple User objects; fetch full profiles for up to `budget` not-yet-enriched pool members. */
async function enrichUpToBudget(
  token: string,
  pool: GithubPublicUser[],
  enriched: Map<number, GithubPublicUser>,
  budget: number,
): Promise<number> {
  if (budget <= 0) return 0;
  let used = 0;
  const pending = shuffleInPlace(pool.filter((u) => !enriched.has(u.id)));
  for (const u of pending) {
    if (used >= budget) break;
    const full = await ghFetch<GithubPublicUser>(token, `/users/${encodeURIComponent(u.login)}`);
    enriched.set(full.id, full);
    used += 1;
  }
  return used;
}

/**
 * Pick up to `target` users: prefer location+company+avatar, then any with location, then anyone.
 * Order within each tier is random (shuffle of pool at start, then linear passes preserve that order).
 */
export function selectNeighborsTiered(pool: GithubPublicUser[], target: number): GithubPublicUser[] {
  if (target <= 0 || pool.length === 0) return [];

  const shuffled = shuffleInPlace([...pool]);
  const picked: GithubPublicUser[] = [];
  const pickedIds = new Set<number>();

  for (const u of shuffled) {
    if (picked.length >= target) break;
    if (matchesTier1(u)) {
      picked.push(u);
      pickedIds.add(u.id);
    }
  }

  for (const u of shuffled) {
    if (picked.length >= target) break;
    if (pickedIds.has(u.id)) continue;
    if (matchesTier2(u)) {
      picked.push(u);
      pickedIds.add(u.id);
    }
  }

  for (const u of shuffled) {
    if (picked.length >= target) break;
    if (pickedIds.has(u.id)) continue;
    picked.push(u);
    pickedIds.add(u.id);
  }

  return picked;
}

async function collectNeighborsFromSide(
  token: string,
  login: string,
  side: "following" | "followers",
  target: number,
  firstBudgetPages: number,
  secondBudgetPages: number,
  perPage: number,
  maxProfileEnrichments: number,
): Promise<{
  selected: GithubPublicUser[];
  pagesFetched: number;
  enriched: Map<number, GithubPublicUser>;
}> {
  const path =
    side === "following"
      ? `/users/${encodeURIComponent(login)}/following`
      : `/users/${encodeURIComponent(login)}/followers`;

  let pool: GithubPublicUser[] = [];
  let pagesFetched = 0;
  const enriched = new Map<number, GithubPublicUser>();
  let profileBudgetLeft = maxProfileEnrichments;

  const fetchPage = async (page: number) => {
    const chunk = await ghFetch<GithubPublicUser[]>(token, `${path}?per_page=${perPage}&page=${page}`);
    pagesFetched = page;
    return chunk;
  };

  for (let p = 1; p <= firstBudgetPages; p++) {
    pool.push(...(await fetchPage(p)));
  }
  pool = dedupeByGithubId(pool);
  profileBudgetLeft -= await enrichUpToBudget(token, pool, enriched, profileBudgetLeft);
  let selected = selectNeighborsTiered(materializePool(pool, enriched), target);
  if (selected.length >= target) {
    return { selected: selected.slice(0, target), pagesFetched, enriched };
  }

  for (let p = firstBudgetPages + 1; p <= secondBudgetPages; p++) {
    pool.push(...(await fetchPage(p)));
    pool = dedupeByGithubId(pool);
    profileBudgetLeft -= await enrichUpToBudget(token, pool, enriched, profileBudgetLeft);
    selected = selectNeighborsTiered(materializePool(pool, enriched), target);
    if (selected.length >= target) {
      return { selected: selected.slice(0, target), pagesFetched, enriched };
    }
  }

  selected = selectNeighborsTiered(materializePool(pool, enriched), target);
  return { selected: selected.slice(0, target), pagesFetched, enriched };
}

function toNode(
  user: GithubPublicUser,
  isRoot: boolean,
  depth: number,
  expanded: 0 | 1,
  augments?: { social_accounts: GithubSocialAccount[]; organizations: GithubPublicOrganization[] },
): NodeDTO {
  const profile = expandProfileRecord(user, augments);
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
    profile,
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
    profileJson: n.profile != null ? JSON.stringify(n.profile) : null,
  };
}

async function mergeNeighborFromGithub(
  token: string,
  raw: GithubPublicUser,
  sideEnriched: Map<number, GithubPublicUser>,
  hopDepth: number,
  nodeById: Map<number, NodeDTO>,
): Promise<NodeDTO> {
  const full =
    sideEnriched.get(raw.id) ??
    (await ghFetch<GithubPublicUser>(token, `/users/${encodeURIComponent(raw.login)}`));
  const augments = await fetchProfileAugments(token, full.login);
  const prev = nodeById.get(full.id);
  const depth = prev ? Math.min(prev.depth, hopDepth + 1) : hopDepth + 1;
  const expanded: 0 | 1 = prev?.expanded ?? 0;
  const isRoot = prev?.isRoot ?? false;
  return toNode(full, isRoot, depth, expanded, augments);
}

/**
 * BFS using **both** directions per user: up to `branchFollowing` accounts they follow (outgoing)
 * and up to `branchFollowers` followers (incoming). Neighbors are chosen with tiered rules
 * (location+company+avatar → location → anyone) over paginated lists; see `firstBudgetPages` /
 * `secondBudgetPages`. Edges stay canonical: `source → target` means source follows target.
 * Depth is hop count from the root in this mixed graph. All nodes and edges are written to SQLite
 * (`nodes`, `edges`) for accumulation across requests.
 */
export async function expandFollowingDepthGraph(params: {
  token: string;
  rootLogin: string;
  db: Database;
  /** Target count of following neighbors per expanded user after tiered selection. */
  branchFollowing?: number;
  /** Target count of follower neighbors per expanded user (defaults to `branchFollowing`). */
  branchFollowers?: number;
  maxHopDepth?: number;
  /** GitHub list `per_page` (1–100). Larger = fewer requests per candidate pool. */
  listPerPage?: number;
  /** List pages fetched before widening to `secondBudgetPages` when targets aren’t filled. */
  firstBudgetPages?: number;
  /** Max cumulative list pages per side (must be ≥ `firstBudgetPages`). */
  secondBudgetPages?: number;
  /** Cap `GET /users/{login}` calls per side per expanded node for location/company (lists omit them). */
  maxProfileEnrichmentsPerSide?: number;
}): Promise<GraphDTO> {
  const { token, rootLogin, db } = params;
  const branchFollowing = params.branchFollowing ?? DEFAULT_FOLLOWING_BRANCH;
  const branchFollowers = params.branchFollowers ?? branchFollowing;
  const maxHopDepth = params.maxHopDepth ?? DEFAULT_MAX_HOP_DEPTH;
  const listPerPage = Math.min(Math.max(params.listPerPage ?? DEFAULT_LIST_PER_PAGE, 1), 100);
  const firstBudgetPages = Math.max(params.firstBudgetPages ?? DEFAULT_FIRST_BUDGET_PAGES, 1);
  const secondBudgetPages = Math.max(params.secondBudgetPages ?? DEFAULT_SECOND_BUDGET_PAGES, firstBudgetPages);
  const maxProfileEnrichmentsPerSide = Math.min(
    Math.max(params.maxProfileEnrichmentsPerSide ?? DEFAULT_PROFILE_ENRICH_PER_SIDE, 0),
    500,
  );

  const normalizedRoot = rootLogin.trim();
  const [rootUser, rootAugments] = await Promise.all([
    ghFetch<GithubPublicUser>(token, `/users/${encodeURIComponent(normalizedRoot)}`),
    fetchProfileAugments(token, normalizedRoot),
  ]);
  const rootNode = toNode(rootUser, true, 0, 0, rootAugments);
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

    const [freshSelf, expandAugments] = await Promise.all([
      ghFetch<GithubPublicUser>(token, `/users/${encodeURIComponent(u.login)}`),
      fetchProfileAugments(token, u.login),
    ]);
    const isRootUser = u.id === rootNode.githubId;
    const parentDto = toNode(freshSelf, isRootUser, u.depth, 1, expandAugments);
    nodeById.set(u.id, parentDto);
    persistNode(db, toNodeRow(parentDto, parentDto.depth, 1));

    const [followingPick, followersPick] = await Promise.all([
      collectNeighborsFromSide(
        token,
        u.login,
        "following",
        branchFollowing,
        firstBudgetPages,
        secondBudgetPages,
        listPerPage,
        maxProfileEnrichmentsPerSide,
      ),
      collectNeighborsFromSide(
        token,
        u.login,
        "followers",
        branchFollowers,
        firstBudgetPages,
        secondBudgetPages,
        listPerPage,
        maxProfileEnrichmentsPerSide,
      ),
    ]);
    const following = followingPick.selected;
    const followers = followersPick.selected;

    for (const raw of following) {
      const child = await mergeNeighborFromGithub(token, raw, followingPick.enriched, u.depth, nodeById);
      nodeById.set(child.githubId, child);
      persistNode(db, toNodeRow(child, child.depth, child.expanded));
      addFollowsEdge(u.id, child.githubId);
      followingReturned += 1;
      queue.push({ id: child.githubId, login: child.login, depth: u.depth + 1 });
    }

    for (const raw of followers) {
      // GitHub: raw is a follower of u → raw follows u
      const follower = await mergeNeighborFromGithub(token, raw, followersPick.enriched, u.depth, nodeById);
      nodeById.set(follower.githubId, follower);
      persistNode(db, toNodeRow(follower, follower.depth, follower.expanded));
      addFollowsEdge(follower.githubId, u.id);
      followersReturned += 1;
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
