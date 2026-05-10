import Database from "better-sqlite3";
import { githubProfilePageUrl } from "./githubProfileUrl.js";
import type { EdgeDTO, GraphDTO, NodeDTO } from "./graphTypes.js";

/**
 * Initial-screen node budget. Each read endpoint randomly samples up to this many
 * nodes (signed-in reads always pin the user's root). Override at runtime with
 * `GRAPH_READ_MAX_NODES`.
 */
const DEFAULT_MAX_NODES = 400;

/** No row cap on edges when unset; set `GRAPH_READ_MAX_EDGES` to a positive integer to limit. */
function parseMaxEdges(): number | null {
  const raw = process.env.GRAPH_READ_MAX_EDGES?.trim();
  if (raw === undefined || raw === "") return null;
  const lower = raw.toLowerCase();
  if (raw === "0" || lower === "unlimited" || lower === "none" || lower === "off") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(Math.floor(n), 1), 500_000);
}

function readCaps(): { maxNodes: number; maxEdges: number | null } {
  const maxNodes = Math.min(
    Math.max(Number(process.env.GRAPH_READ_MAX_NODES ?? DEFAULT_MAX_NODES) || DEFAULT_MAX_NODES, 1),
    100_000,
  );
  const maxEdges = parseMaxEdges();
  return { maxNodes, maxEdges };
}

type NodeRow = {
  owner_user_id: string;
  github_id: number;
  login: string;
  depth: number;
  expanded: number;
  avatar_url: string | null;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  html_url: string | null;
  profile_json: string | null;
};

function parseProfileJson(raw: string | null): Record<string, unknown> | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rowToNode(row: NodeRow, isRoot: boolean, degreeOverride?: number): NodeDTO {
  const degree = Math.max(1, degreeOverride ?? row.depth);
  return {
    githubId: row.github_id,
    login: row.login,
    avatarUrl: row.avatar_url ?? "",
    name: row.name,
    bio: row.bio,
    company: row.company,
    location: row.location,
    websiteUrl: row.blog,
    profileUrl: githubProfilePageUrl(row.login, row.html_url),
    isRoot,
    degree,
    expanded: row.expanded ? 1 : 0,
    profile: parseProfileJson(row.profile_json),
  };
}

function emptyGraph(rootLogin: string): GraphDTO {
  const now = new Date().toISOString();
  return {
    rootLogin,
    generatedAt: now,
    caps: { maxFollowers: 0, maxFollowing: 0 },
    truncation: {
      followersTotal: null,
      followingTotal: null,
      followersReturned: 0,
      followingReturned: 0,
    },
    nodes: [],
    edges: [],
  };
}

const NODE_SELECT =
  `owner_user_id, github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url, profile_json`;

const NODE_SELECT_N =
  `n.owner_user_id, n.github_id, n.login, n.depth, n.expanded, n.avatar_url, n.name, n.bio, n.company, n.location, n.blog, n.html_url, n.profile_json`;

/**
 * Random sample of up to `maxNodes` rows from `nodes`, then follows edges whose
 * **both** endpoints fall in that sampled set. Sampling is uniform across the
 * full table so the graph the user sees on initial load is a representative
 * slice rather than the first N by `github_id`.
 */
export function readFullGraph(db: Database.Database): GraphDTO {
  return readFullGraphWithOptions(db);
}

function clampRequestedMaxNodes(n: number, defaultMaxNodes: number): number {
  if (!Number.isFinite(n) || n <= 0) return defaultMaxNodes;
  return Math.min(Math.max(Math.floor(n), 1), 100_000);
}

export function readFullGraphWithOptions(
  db: Database.Database,
  options?: { maxNodes?: number; includeLogin?: string },
): GraphDTO {
  const caps = readCaps();
  const maxNodes =
    options?.maxNodes != null ? clampRequestedMaxNodes(options.maxNodes, caps.maxNodes) : caps.maxNodes;
  const maxEdges = caps.maxEdges;
  const now = new Date().toISOString();
  const includeLogin = options?.includeLogin?.trim().toLowerCase() ?? "";
  let pinnedRow: NodeRow | undefined;
  if (includeLogin) {
    pinnedRow = db
      .prepare(
        `SELECT ${NODE_SELECT}
         FROM nodes
         WHERE lower(login) = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(includeLogin) as NodeRow | undefined;
  }
  // Sample from the entire accumulated SQL pool (all owners), then de-duplicate by
  // GitHub id so public mode reflects globally available data instead of one namespace.
  const poolRows = db
    .prepare(
      `SELECT ${NODE_SELECT}
       FROM nodes
       ORDER BY RANDOM()
       LIMIT ?`,
    )
    .all(Math.min(maxNodes * 4, 200_000)) as NodeRow[];
  const dedupedRows: NodeRow[] = [];
  const seenGithubIds = new Set<number>();
  if (pinnedRow) {
    dedupedRows.push(pinnedRow);
    seenGithubIds.add(pinnedRow.github_id);
  }
  for (const row of poolRows) {
    if (seenGithubIds.has(row.github_id)) continue;
    seenGithubIds.add(row.github_id);
    dedupedRows.push(row);
    if (dedupedRows.length >= maxNodes) break;
  }
  const nodeRows = dedupedRows;

  if (nodeRows.length === 0) {
    return {
      rootLogin: "",
      generatedAt: now,
      caps: { maxFollowers: 0, maxFollowing: 0 },
      truncation: {
        followersTotal: null,
        followingTotal: null,
        followersReturned: 0,
        followingReturned: 0,
      },
      nodes: [],
      edges: [],
    };
  }

  const pinnedGithubId = pinnedRow?.github_id;
  const nodes: NodeDTO[] = nodeRows.map((r) => rowToNode(r, r.github_id === pinnedGithubId));
  const ids = nodeRows.map((r) => r.github_id);

  ensureNodeSubsetTemp(db);
  insertNodeSubsetIds(db, ids);

  try {
    const edgeRows = db
      .prepare(
        `SELECT DISTINCT e.source_id, e.target_id
         FROM edges e
         INNER JOIN _graph_node_subset s ON s.id = e.source_id
         INNER JOIN _graph_node_subset t ON t.id = e.target_id
         WHERE e.kind = 'follows'
         LIMIT ?`,
      )
      .all(maxEdges ?? -1) as Array<{ source_id: number; target_id: number }>;

    const edges: EdgeDTO[] = edgeRows.map((e) => ({
      sourceGithubId: e.source_id,
      targetGithubId: e.target_id,
      kind: "follows" as const,
    }));

    return {
      rootLogin: pinnedRow?.login ?? "",
      generatedAt: now,
      caps: { maxFollowers: 0, maxFollowing: 0 },
      truncation: {
        followersTotal: null,
        followingTotal: null,
        followersReturned: 0,
        followingReturned: edges.length,
      },
      nodes,
      edges,
    };
  } finally {
    db.exec(`DELETE FROM _graph_node_subset`);
  }
}

function ensureNodeSubsetTemp(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS _graph_node_subset (id INTEGER PRIMARY KEY);
    DELETE FROM _graph_node_subset;
  `);
}

function insertNodeSubsetIds(db: Database.Database, ids: number[]): void {
  const stmt = db.prepare(`INSERT OR IGNORE INTO _graph_node_subset (id) VALUES (?)`);
  const run = db.transaction((list: number[]) => {
    for (const id of list) stmt.run(id);
  });
  run(ids);
}

/**
 * Directed reachable set from `rootLogin` along follows edges (source → target),
 * collected via BFS. If the reachable set exceeds `maxNodes`, the result is
 * uniformly random-sampled down to that size — except the root is always
 * included, so the visualization stays anchored.
 */
export function readReachableGraph(db: Database.Database, ownerUserId: string, rootLogin: string): GraphDTO {
  const normalized = rootLogin.trim().toLowerCase();
  if (!normalized) return emptyGraph(rootLogin);

  const { maxNodes, maxEdges } = readCaps();
  const now = new Date().toISOString();

  const rootRow = db
    .prepare(
      `SELECT ${NODE_SELECT} FROM nodes WHERE owner_user_id = ? AND lower(login) = ? LIMIT 1`,
    )
    .get(ownerUserId, normalized) as NodeRow | undefined;

  if (!rootRow) {
    return emptyGraph(rootLogin.trim());
  }

  const degreeById = new Map<number, number>([[rootRow.github_id, 1]]);
  const queue = [rootRow.github_id];
  const followStmt = db.prepare(
    `SELECT target_id FROM edges WHERE owner_user_id = ? AND kind = 'follows' AND source_id = ?`,
  );

  while (queue.length > 0) {
    const u = queue.shift()!;
    const degreeU = degreeById.get(u);
    if (degreeU === undefined) continue;
    const targets = followStmt.all(ownerUserId, u) as Array<{ target_id: number }>;
    for (const { target_id: t } of targets) {
      if (degreeById.has(t)) continue;
      degreeById.set(t, degreeU + 1);
      queue.push(t);
    }
  }

  const ids = sampleIdsKeepingRoot([...degreeById.keys()], rootRow.github_id, maxNodes);
  ensureNodeSubsetTemp(db);
  insertNodeSubsetIds(db, ids);

  try {
    const nodeRows = db
      .prepare(
        `SELECT ${NODE_SELECT_N}
         FROM nodes n
         INNER JOIN _graph_node_subset g ON g.id = n.github_id
         WHERE n.owner_user_id = ?`,
      )
      .all(ownerUserId) as NodeRow[];

    const edgeRows = db
      .prepare(
        `SELECT e.source_id, e.target_id
         FROM edges e
         INNER JOIN _graph_node_subset s ON s.id = e.source_id
         INNER JOIN _graph_node_subset t ON t.id = e.target_id
         WHERE e.kind = 'follows' AND e.owner_user_id = ?
         LIMIT ?`,
      )
      .all(ownerUserId, maxEdges ?? -1) as Array<{ source_id: number; target_id: number }>;

    const nodes: NodeDTO[] = nodeRows.map((r) =>
      rowToNode(r, r.github_id === rootRow.github_id, degreeById.get(r.github_id) ?? r.depth),
    );
    const edges: EdgeDTO[] = edgeRows.map((e) => ({
      sourceGithubId: e.source_id,
      targetGithubId: e.target_id,
      kind: "follows" as const,
    }));

    return {
      rootLogin: rootRow.login,
      generatedAt: now,
      caps: { maxFollowers: 0, maxFollowing: 0 },
      truncation: {
        followersTotal: null,
        followingTotal: null,
        followersReturned: 0,
        followingReturned: edges.length,
      },
      nodes,
      edges,
    };
  } finally {
    db.exec(`DELETE FROM _graph_node_subset`);
  }
}

/**
 * Deterministic owner-scoped graph read for continuity across sessions.
 * Unlike `readReachableGraph`, this does not anchor to one root login.
 */
export function readOwnerGraph(db: Database.Database, ownerUserId: string): GraphDTO {
  const { maxNodes, maxEdges } = readCaps();
  const now = new Date().toISOString();

  const nodeRows = db
    .prepare(
      `SELECT ${NODE_SELECT}
       FROM nodes
       WHERE owner_user_id = ?
       ORDER BY updated_at DESC, github_id ASC
       LIMIT ?`,
    )
    .all(ownerUserId, maxNodes) as NodeRow[];

  if (nodeRows.length === 0) {
    return {
      rootLogin: "",
      generatedAt: now,
      caps: { maxFollowers: 0, maxFollowing: 0 },
      truncation: {
        followersTotal: null,
        followingTotal: null,
        followersReturned: 0,
        followingReturned: 0,
      },
      nodes: [],
      edges: [],
    };
  }

  const nodes: NodeDTO[] = nodeRows.map((r) => rowToNode(r, false));
  const ids = nodeRows.map((r) => r.github_id);
  ensureNodeSubsetTemp(db);
  insertNodeSubsetIds(db, ids);

  try {
    const edgeRows = db
      .prepare(
        `SELECT e.source_id, e.target_id
         FROM edges e
         INNER JOIN _graph_node_subset s ON s.id = e.source_id
         INNER JOIN _graph_node_subset t ON t.id = e.target_id
         WHERE e.kind = 'follows' AND e.owner_user_id = ?
         LIMIT ?`,
      )
      .all(ownerUserId, maxEdges ?? -1) as Array<{ source_id: number; target_id: number }>;

    const edges: EdgeDTO[] = edgeRows.map((e) => ({
      sourceGithubId: e.source_id,
      targetGithubId: e.target_id,
      kind: "follows" as const,
    }));

    return {
      rootLogin: "",
      generatedAt: now,
      caps: { maxFollowers: 0, maxFollowing: 0 },
      truncation: {
        followersTotal: null,
        followingTotal: null,
        followersReturned: 0,
        followingReturned: edges.length,
      },
      nodes,
      edges,
    };
  } finally {
    db.exec(`DELETE FROM _graph_node_subset`);
  }
}

/**
 * Uniform partial Fisher–Yates: returns up to `limit` ids from `all`, always
 * including `keepId`. If the set is already within the cap, returns it as-is.
 */
function sampleIdsKeepingRoot(all: number[], keepId: number, limit: number): number[] {
  if (all.length <= limit) return all;
  const others = all.filter((id) => id !== keepId);
  const want = Math.max(0, limit - 1);
  for (let i = 0; i < want && i < others.length; i++) {
    const j = i + Math.floor(Math.random() * (others.length - i));
    [others[i], others[j]] = [others[j]!, others[i]!];
  }
  return [keepId, ...others.slice(0, want)];
}
