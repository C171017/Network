import type { Database } from "better-sqlite3";
import {
  crawlScalarsFromGithubUser,
  expandProfileRecord,
  type GithubPublicOrganization,
  type GithubPublicUser,
  type GithubSocialAccount,
} from "@network/crawler";
import { githubProfilePageUrl } from "./githubProfileUrl.js";
import type { EdgeDTO, GraphDTO, NodeDTO } from "./graphTypes.js";

/** NDJSON stream payloads for `POST /api/graph/expand-stream`. */
export type ExpandProgressEvent =
  | { type: "node"; node: NodeDTO }
  | { type: "edge"; edge: EdgeDTO }
  | { type: "done"; summary: GraphDTO }
  | { type: "error"; message: string };
import { persistFollowsEdge, persistNode, type NodeRowInput } from "./graphStore.js";

const API = "https://api.github.com";

/** How often to call paginated `/social_accounts` and `/orgs` during an expand run. */
export type GithubProfileAugmentsMode = "none" | "root" | "all";

const EMPTY_AUGMENTS: { social_accounts: GithubSocialAccount[]; organizations: GithubPublicOrganization[] } = {
  social_accounts: [],
  organizations: [],
};

function normalizeLoginKey(login: string): string {
  return login.trim().toLowerCase();
}

export function shouldFetchAugmentsForLogin(
  login: string,
  rootLoginTrimmed: string,
  mode: GithubProfileAugmentsMode,
): boolean {
  if (mode === "none") return false;
  if (mode === "all") return true;
  return normalizeLoginKey(login) === normalizeLoginKey(rootLoginTrimmed);
}

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
export const DEFAULT_PROFILE_ENRICH_PER_SIDE = 12;
/** Max paginated pages per augment list (`/social_accounts`, `/orgs`) when augments are fetched. */
export const DEFAULT_AUGMENTS_MAX_PAGES = 2;
/** Default: org/social list endpoints only for the seed user (fewer API calls). */
export const DEFAULT_PROFILE_AUGMENTS_MODE: GithubProfileAugmentsMode = "root";
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

async function ghFetchAugmentPages<T>(
  token: string,
  pathWithoutQuery: string,
  maxPages: number,
): Promise<T[]> {
  const cap = Math.min(Math.max(maxPages, 1), 100);
  const out: T[] = [];
  for (let page = 1; page <= cap; page++) {
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
async function fetchProfileAugments(
  token: string,
  login: string,
  maxPages: number,
): Promise<{
  social_accounts: GithubSocialAccount[];
  organizations: GithubPublicOrganization[];
}> {
  const enc = encodeURIComponent(login);
  const [social_accounts, organizations] = await Promise.all([
    ghFetchAugmentPages<GithubSocialAccount>(token, `/users/${enc}/social_accounts`, maxPages),
    ghFetchAugmentPages<GithubPublicOrganization>(token, `/users/${enc}/orgs`, maxPages),
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

function toNodeRow(
  n: NodeDTO,
  user: GithubPublicUser,
  depth: number,
  expanded: 0 | 1,
): Omit<NodeRowInput, "ownerUserId"> {
  const s = crawlScalarsFromGithubUser(user);
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
    twitterUsername: s.twitterUsername,
    email: s.email,
    hireable: s.hireable,
    publicRepos: s.publicRepos,
    publicGists: s.publicGists,
    followersCount: s.followersCount,
    followingCount: s.followingCount,
    githubCreatedAt: s.githubCreatedAt,
    githubUpdatedAt: s.githubUpdatedAt,
    userType: s.userType,
    siteAdmin: s.siteAdmin,
  };
}

type NeighborPersistBundle = {
  dto: NodeDTO;
  fullUser: GithubPublicUser;
  profileAugments: { social_accounts: GithubSocialAccount[]; organizations: GithubPublicOrganization[] };
};

async function mergeNeighborFromGithub(
  token: string,
  raw: GithubPublicUser,
  sideEnriched: Map<number, GithubPublicUser>,
  hopDepth: number,
  nodeById: Map<number, NodeDTO>,
  opts: {
    rootLoginTrimmed: string;
    profileAugmentsMode: GithubProfileAugmentsMode;
    augmentsMaxPages: number;
  },
): Promise<NeighborPersistBundle> {
  const full =
    sideEnriched.get(raw.id) ??
    (await ghFetch<GithubPublicUser>(token, `/users/${encodeURIComponent(raw.login)}`));
  const augments = shouldFetchAugmentsForLogin(full.login, opts.rootLoginTrimmed, opts.profileAugmentsMode)
    ? await fetchProfileAugments(token, full.login, opts.augmentsMaxPages)
    : EMPTY_AUGMENTS;
  const prev = nodeById.get(full.id);
  const depth = prev ? Math.min(prev.depth, hopDepth + 1) : hopDepth + 1;
  const expanded: 0 | 1 = prev?.expanded ?? 0;
  const isRoot = prev?.isRoot ?? false;
  return {
    dto: toNode(full, isRoot, depth, expanded, augments),
    fullUser: full,
    profileAugments: augments,
  };
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
  ownerUserId: string;
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
  /** Whether to load paginated org/social lists; default `root` (seed user only). */
  profileAugments?: GithubProfileAugmentsMode;
  /** Max pages per augment list when augments are fetched (default 2). */
  augmentsMaxPages?: number;
  /** Fire after each persisted node/edge and once with `done` (full graph) at the end. */
  onProgress?: (event: ExpandProgressEvent) => void;
}): Promise<GraphDTO> {
  const { ownerUserId, token, rootLogin, db } = params;
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
  const profileAugmentsMode = params.profileAugments ?? DEFAULT_PROFILE_AUGMENTS_MODE;
  const augmentsMaxPages = Math.min(
    Math.max(params.augmentsMaxPages ?? DEFAULT_AUGMENTS_MAX_PAGES, 1),
    100,
  );
  const onProgress = params.onProgress;

  const normalizedRoot = rootLogin.trim();
  const rootUser = await ghFetch<GithubPublicUser>(token, `/users/${encodeURIComponent(normalizedRoot)}`);
  const rootAugments = shouldFetchAugmentsForLogin(rootUser.login, normalizedRoot, profileAugmentsMode)
    ? await fetchProfileAugments(token, rootUser.login, augmentsMaxPages)
    : EMPTY_AUGMENTS;
  const rootNode = toNode(rootUser, true, 0, 0, rootAugments);
  persistNode(db, { ...toNodeRow(rootNode, rootUser, 0, 0), ownerUserId }, {
    socialAccounts: rootAugments.social_accounts,
    organizations: rootAugments.organizations,
  });
  onProgress?.({ type: "node", node: rootNode });

  const nodeById = new Map<number, NodeDTO>();
  nodeById.set(rootNode.githubId, rootNode);

  type WarmEntry = {
    user: GithubPublicUser;
    augments: { social_accounts: GithubSocialAccount[]; organizations: GithubPublicOrganization[] };
  };
  const warmCache = new Map<number, WarmEntry>();
  warmCache.set(rootNode.githubId, { user: rootUser, augments: rootAugments });

  const edges: EdgeDTO[] = [];
  const edgeKeySeen = new Set<string>();

  const queue: Array<{ id: number; login: string; depth: number }> = [
    { id: rootNode.githubId, login: rootNode.login, depth: 0 },
  ];
  const expandedIds = new Set<number>();

  const neighborAugmentOpts = {
    rootLoginTrimmed: normalizedRoot,
    profileAugmentsMode,
    augmentsMaxPages,
  };

  let followingReturned = 0;
  let followersReturned = 0;

  function addFollowsEdge(sourceId: number, targetId: number): void {
    const key = `${sourceId}->${targetId}`;
    if (edgeKeySeen.has(key)) return;
    edgeKeySeen.add(key);
    persistFollowsEdge(db, ownerUserId, sourceId, targetId);
    const edge: EdgeDTO = { sourceGithubId: sourceId, targetGithubId: targetId, kind: "follows" };
    edges.push(edge);
    onProgress?.({ type: "edge", edge });
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    if (u.depth >= maxHopDepth) continue;
    if (expandedIds.has(u.id)) continue;
    expandedIds.add(u.id);

    const warmed = warmCache.get(u.id);
    let freshSelf: GithubPublicUser;
    let expandAugments: WarmEntry["augments"];
    if (warmed) {
      freshSelf = warmed.user;
      expandAugments = warmed.augments;
    } else {
      freshSelf = await ghFetch<GithubPublicUser>(token, `/users/${encodeURIComponent(u.login)}`);
      expandAugments = shouldFetchAugmentsForLogin(freshSelf.login, normalizedRoot, profileAugmentsMode)
        ? await fetchProfileAugments(token, freshSelf.login, augmentsMaxPages)
        : EMPTY_AUGMENTS;
      warmCache.set(u.id, { user: freshSelf, augments: expandAugments });
    }
    const isRootUser = u.id === rootNode.githubId;
    const parentDto = toNode(freshSelf, isRootUser, u.depth, 1, expandAugments);
    nodeById.set(u.id, parentDto);
    persistNode(db, { ...toNodeRow(parentDto, freshSelf, parentDto.depth, 1), ownerUserId }, {
      socialAccounts: expandAugments.social_accounts,
      organizations: expandAugments.organizations,
    });
    onProgress?.({ type: "node", node: parentDto });

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
      const child = await mergeNeighborFromGithub(
        token,
        raw,
        followingPick.enriched,
        u.depth,
        nodeById,
        neighborAugmentOpts,
      );
      warmCache.set(child.dto.githubId, { user: child.fullUser, augments: child.profileAugments });
      nodeById.set(child.dto.githubId, child.dto);
      persistNode(db, { ...toNodeRow(child.dto, child.fullUser, child.dto.depth, child.dto.expanded), ownerUserId }, {
        socialAccounts: child.profileAugments.social_accounts,
        organizations: child.profileAugments.organizations,
      });
      onProgress?.({ type: "node", node: child.dto });
      addFollowsEdge(u.id, child.dto.githubId);
      followingReturned += 1;
      queue.push({ id: child.dto.githubId, login: child.dto.login, depth: u.depth + 1 });
    }

    for (const raw of followers) {
      // GitHub: raw is a follower of u → raw follows u
      const follower = await mergeNeighborFromGithub(
        token,
        raw,
        followersPick.enriched,
        u.depth,
        nodeById,
        neighborAugmentOpts,
      );
      warmCache.set(follower.dto.githubId, { user: follower.fullUser, augments: follower.profileAugments });
      nodeById.set(follower.dto.githubId, follower.dto);
      persistNode(db, {
        ...toNodeRow(follower.dto, follower.fullUser, follower.dto.depth, follower.dto.expanded),
        ownerUserId,
      }, {
        socialAccounts: follower.profileAugments.social_accounts,
        organizations: follower.profileAugments.organizations,
      });
      onProgress?.({ type: "node", node: follower.dto });
      addFollowsEdge(follower.dto.githubId, u.id);
      followersReturned += 1;
      queue.push({ id: follower.dto.githubId, login: follower.dto.login, depth: u.depth + 1 });
    }
  }

  const graph: GraphDTO = {
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
  onProgress?.({ type: "done", summary: graph });
  return graph;
}
