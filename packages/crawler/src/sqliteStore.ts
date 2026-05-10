import Database from "better-sqlite3";
import { applyGraphSqlMigrations, persistNodeNormalizedAugments } from "./graphSqlSchema.js";
import { crawlScalarsFromGithubUser } from "./githubUserScalars.js";
import type { GithubPublicUser, GithubUserSlim } from "./types.js";
import { expandProfileRecord, type GithubProfileAugments } from "./profileAugment.js";

function ensureProfileJsonColumn(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(nodes)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "profile_json")) {
    db.exec(`ALTER TABLE nodes ADD COLUMN profile_json TEXT`);
  }
}

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
      profile_json TEXT,
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

  ensureProfileJsonColumn(db);
  applyGraphSqlMigrations(db);

  if (options?.reset) {
    db.exec(`DELETE FROM edges; DELETE FROM nodes;`);
  }

  return db;
}

/**
 * Inserts a “slim” neighbor row. If this `github_id` already exists, **does nothing**
 * so the database **accumulates** across runs and first-seen rows win.
 */
export function insertSlimNodeIfMissing(
  db: Database.Database,
  user: GithubUserSlim,
  depth: number,
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO nodes (github_id, login, depth, expanded, avatar_url, updated_at)
    VALUES (@github_id, @login, @depth, 0, @avatar_url, @updated_at)
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
  user: GithubPublicUser,
  depth: number,
  augments?: GithubProfileAugments,
): void {
  const now = new Date().toISOString();
  const profileJson = JSON.stringify(expandProfileRecord(user, augments));
  const s = crawlScalarsFromGithubUser(user);
  const stmt = db.prepare(`
    INSERT INTO nodes (
      github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url, profile_json,
      twitter_username, email, hireable, public_repos, public_gists, followers_count, following_count,
      github_created_at, github_updated_at, user_type, site_admin,
      updated_at
    ) VALUES (
      @github_id, @login, @depth, 1, @avatar_url, @name, @bio, @company, @location, @blog, @html_url, @profile_json,
      @twitter_username, @email, @hireable, @public_repos, @public_gists, @followers_count, @following_count,
      @github_created_at, @github_updated_at, @user_type, @site_admin,
      @updated_at
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
      profile_json = excluded.profile_json,
      twitter_username = COALESCE(excluded.twitter_username, nodes.twitter_username),
      email = COALESCE(excluded.email, nodes.email),
      hireable = COALESCE(excluded.hireable, nodes.hireable),
      public_repos = COALESCE(excluded.public_repos, nodes.public_repos),
      public_gists = COALESCE(excluded.public_gists, nodes.public_gists),
      followers_count = COALESCE(excluded.followers_count, nodes.followers_count),
      following_count = COALESCE(excluded.following_count, nodes.following_count),
      github_created_at = COALESCE(excluded.github_created_at, nodes.github_created_at),
      github_updated_at = COALESCE(excluded.github_updated_at, nodes.github_updated_at),
      user_type = COALESCE(excluded.user_type, nodes.user_type),
      site_admin = COALESCE(excluded.site_admin, nodes.site_admin),
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
    profile_json: profileJson,
    twitter_username: s.twitterUsername,
    email: s.email,
    hireable: s.hireable,
    public_repos: s.publicRepos,
    public_gists: s.publicGists,
    followers_count: s.followersCount,
    following_count: s.followingCount,
    github_created_at: s.githubCreatedAt,
    github_updated_at: s.githubUpdatedAt,
    user_type: s.userType,
    site_admin: s.siteAdmin,
    updated_at: now,
  });
  if (augments?.social_accounts != null || augments?.organizations != null) {
    persistNodeNormalizedAugments(db, user.id, {
      socialAccounts: augments.social_accounts ?? [],
      organizations: augments.organizations ?? [],
    });
  }
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
