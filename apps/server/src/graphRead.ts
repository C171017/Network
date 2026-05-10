import Database from "better-sqlite3";
import { githubProfilePageUrl } from "./githubProfileUrl.js";
import type { EdgeDTO, GraphDTO, NodeDTO } from "./graphTypes.js";

const DEFAULT_MAX_NODES = 8000;

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

function rowToNode(row: NodeRow, isRoot: boolean): NodeDTO {
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
    depth: row.depth,
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

const NODE_SELECT = `github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url, profile_json`;

const NODE_SELECT_N = `n.github_id, n.login, n.depth, n.expanded, n.avatar_url, n.name, n.bio, n.company, n.location, n.blog, n.html_url, n.profile_json`;

/**
 * All nodes (row-capped), then follows edges whose endpoints lie in that capped node set (edge-capped).
 * Uses CTEs to avoid huge `IN (...)` parameter lists.
 */
export function readFullGraph(db: Database.Database): GraphDTO {
  const { maxNodes, maxEdges } = readCaps();
  const now = new Date().toISOString();

  const nodeRows = db
    .prepare(
      `WITH capped AS (
         SELECT ${NODE_SELECT} FROM nodes ORDER BY github_id LIMIT ?
       )
       SELECT * FROM capped`,
    )
    .all(maxNodes) as NodeRow[];

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

  const edgeRows = db
    .prepare(
      `WITH capped AS (SELECT github_id FROM nodes ORDER BY github_id LIMIT ?)
       SELECT e.source_id, e.target_id
       FROM edges e
       JOIN capped cs ON cs.github_id = e.source_id
       JOIN capped ct ON ct.github_id = e.target_id
       WHERE e.kind = 'follows'
       LIMIT ?`,
    )
    .all(maxNodes, maxEdges ?? -1) as Array<{ source_id: number; target_id: number }>;

  const idSet = new Set(nodeRows.map((r) => r.github_id));
  const edges: EdgeDTO[] = [];
  for (const e of edgeRows) {
    if (!idSet.has(e.source_id) || !idSet.has(e.target_id)) continue;
    edges.push({
      sourceGithubId: e.source_id,
      targetGithubId: e.target_id,
      kind: "follows",
    });
  }

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
}

function ensureReachTemp(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS _graph_reach_ids (id INTEGER PRIMARY KEY);
    DELETE FROM _graph_reach_ids;
  `);
}

function insertReachIds(db: Database.Database, ids: number[]): void {
  const stmt = db.prepare(`INSERT OR IGNORE INTO _graph_reach_ids (id) VALUES (?)`);
  const run = db.transaction((list: number[]) => {
    for (const id of list) stmt.run(id);
  });
  run(ids);
}

/**
 * Directed reachable set from `rootLogin` along follows edges (source → target), BFS.
 */
export function readReachableGraph(db: Database.Database, rootLogin: string): GraphDTO {
  const normalized = rootLogin.trim().toLowerCase();
  if (!normalized) return emptyGraph(rootLogin);

  const { maxNodes, maxEdges } = readCaps();
  const now = new Date().toISOString();

  const rootRow = db
    .prepare(
      `SELECT ${NODE_SELECT} FROM nodes WHERE lower(login) = ? LIMIT 1`,
    )
    .get(normalized) as NodeRow | undefined;

  if (!rootRow) {
    return emptyGraph(rootLogin.trim());
  }

  const visited = new Set<number>([rootRow.github_id]);
  const queue = [rootRow.github_id];
  const followStmt = db.prepare(`SELECT target_id FROM edges WHERE kind = 'follows' AND source_id = ?`);

  while (queue.length > 0 && visited.size < maxNodes) {
    const u = queue.shift()!;
    const targets = followStmt.all(u) as Array<{ target_id: number }>;
    for (const { target_id: t } of targets) {
      if (visited.has(t)) continue;
      visited.add(t);
      queue.push(t);
      if (visited.size >= maxNodes) break;
    }
  }

  const ids = [...visited];
  ensureReachTemp(db);
  insertReachIds(db, ids);

  try {
    const nodeRows = db
      .prepare(
        `SELECT ${NODE_SELECT_N}
         FROM nodes n
         INNER JOIN _graph_reach_ids g ON g.id = n.github_id`,
      )
      .all() as NodeRow[];

    const edgeRows = db
      .prepare(
        `SELECT e.source_id, e.target_id
         FROM edges e
         INNER JOIN _graph_reach_ids s ON s.id = e.source_id
         INNER JOIN _graph_reach_ids t ON t.id = e.target_id
         WHERE e.kind = 'follows'
         LIMIT ?`,
      )
      .all(maxEdges ?? -1) as Array<{ source_id: number; target_id: number }>;

    const nodes: NodeDTO[] = nodeRows.map((r) => rowToNode(r, r.github_id === rootRow.github_id));
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
    db.exec(`DELETE FROM _graph_reach_ids`);
  }
}
