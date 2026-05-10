import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

/**
 * SQLite persistence for graph crawls. Schema matches `packages/crawler` so
 * `data/network.db` can be shared and accumulates across CLI + API runs.
 */
export function resolveGraphDbPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverDir = resolve(here, "..");
  const repoRoot = resolve(serverDir, "..", "..");
  const raw = process.env.DB_PATH?.trim();
  if (!raw) return resolve(repoRoot, "data", "network.db");
  if (raw.startsWith("/")) return raw;
  return resolve(repoRoot, raw);
}

export function openGraphDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      github_id INTEGER PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      depth INTEGER NOT NULL,
      expanded INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT,
      name TEXT,
      bio TEXT,
      company TEXT,
      location TEXT,
      blog TEXT,
      html_url TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edges (
      source_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'follows',
      PRIMARY KEY (source_id, target_id, kind),
      FOREIGN KEY (source_id) REFERENCES nodes(github_id),
      FOREIGN KEY (target_id) REFERENCES nodes(github_id)
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_expanded ON nodes(expanded);
    CREATE INDEX IF NOT EXISTS idx_nodes_depth ON nodes(depth);
  `);

  return db;
}

export type NodeRowInput = {
  githubId: number;
  login: string;
  depth: number;
  expanded: 0 | 1;
  avatarUrl: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  htmlUrl: string;
};

export function persistNode(db: Database.Database, row: NodeRowInput): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO nodes (
      github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url, updated_at
    ) VALUES (
      @github_id, @login, @depth, @expanded, @avatar_url, @name, @bio, @company, @location, @blog, @html_url, @updated_at
    )
    ON CONFLICT(github_id) DO UPDATE SET
      depth = MIN(nodes.depth, excluded.depth),
      expanded = MAX(nodes.expanded, excluded.expanded),
      avatar_url = COALESCE(excluded.avatar_url, nodes.avatar_url),
      name = COALESCE(excluded.name, nodes.name),
      bio = COALESCE(excluded.bio, nodes.bio),
      company = COALESCE(excluded.company, nodes.company),
      location = COALESCE(excluded.location, nodes.location),
      blog = COALESCE(excluded.blog, nodes.blog),
      html_url = COALESCE(excluded.html_url, nodes.html_url),
      updated_at = excluded.updated_at
  `);
  stmt.run({
    github_id: row.githubId,
    login: row.login,
    depth: row.depth,
    expanded: row.expanded,
    avatar_url: row.avatarUrl,
    name: row.name,
    bio: row.bio,
    company: row.company,
    location: row.location,
    blog: row.blog,
    html_url: row.htmlUrl,
    updated_at: now,
  });
}

export function persistFollowsEdge(db: Database.Database, sourceId: number, targetId: number): void {
  db.prepare(`INSERT OR IGNORE INTO edges (source_id, target_id, kind) VALUES (?, ?, 'follows')`).run(
    sourceId,
    targetId,
  );
}
