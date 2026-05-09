import Database from "better-sqlite3";
import type { GithubUserFull, GithubUserSlim } from "./types.js";

export type OpenStoreOptions = {
  reset?: boolean;
};

export function openStore(dbPath: string, options?: OpenStoreOptions): Database.Database {
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

  if (options?.reset) {
    db.exec(`DELETE FROM edges; DELETE FROM nodes;`);
  }

  return db;
}

export function upsertSlimNode(
  db: Database.Database,
  user: GithubUserSlim,
  depth: number,
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO nodes (github_id, login, depth, expanded, avatar_url, updated_at)
    VALUES (@github_id, @login, @depth, 0, @avatar_url, @updated_at)
    ON CONFLICT(github_id) DO UPDATE SET
      depth = MIN(nodes.depth, excluded.depth),
      avatar_url = COALESCE(excluded.avatar_url, nodes.avatar_url),
      updated_at = excluded.updated_at
  `);
  stmt.run({
    github_id: user.id,
    login: user.login,
    depth,
    avatar_url: user.avatar_url,
    updated_at: now,
  });
}

export function markExpandedFullProfile(
  db: Database.Database,
  user: GithubUserFull,
  depth: number,
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO nodes (
      github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url, updated_at
    ) VALUES (
      @github_id, @login, @depth, 1, @avatar_url, @name, @bio, @company, @location, @blog, @html_url, @updated_at
    )
    ON CONFLICT(github_id) DO UPDATE SET
      depth = MIN(nodes.depth, excluded.depth),
      expanded = 1,
      avatar_url = excluded.avatar_url,
      name = excluded.name,
      bio = excluded.bio,
      company = excluded.company,
      location = excluded.location,
      blog = excluded.blog,
      html_url = excluded.html_url,
      updated_at = excluded.updated_at
  `);
  stmt.run({
    github_id: user.id,
    login: user.login,
    depth,
    avatar_url: user.avatar_url,
    name: user.name,
    bio: user.bio,
    company: user.company,
    location: user.location,
    blog: user.blog,
    html_url: user.html_url,
    updated_at: now,
  });
}

export function insertFollowsEdge(
  db: Database.Database,
  sourceId: number,
  targetId: number,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO edges (source_id, target_id, kind) VALUES (?, ?, 'follows')`,
  ).run(sourceId, targetId);
}
