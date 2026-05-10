import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const PUBLIC_GRAPH_OWNER_ID = "public";
const LEGACY_OWNER_PURGE_FLAG = "legacy_owner_depth_purged_v1";
const OWNER_DEGREE_BASELINE_FLAG = "owner_degree_baseline_v1";

function tableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function ensureNodeColumns(db: Database.Database): void {
  const cols = tableColumns(db, "nodes");
  const addCol = (name: string, decl: string) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE nodes ADD COLUMN ${name} ${decl}`);
  };
  addCol("profile_json", "TEXT");
  addCol("twitter_username", "TEXT");
  addCol("email", "TEXT");
  addCol("hireable", "INTEGER");
  addCol("public_repos", "INTEGER");
  addCol("public_gists", "INTEGER");
  addCol("followers_count", "INTEGER");
  addCol("following_count", "INTEGER");
  addCol("github_created_at", "TEXT");
  addCol("github_updated_at", "TEXT");
  addCol("user_type", "TEXT");
  addCol("site_admin", "INTEGER");
}

function ensureOwnerScopedSchema(db: Database.Database): void {
  const nodeCols = tableColumns(db, "nodes");
  const edgeCols = tableColumns(db, "edges");
  if (nodeCols.has("owner_user_id") && edgeCols.has("owner_user_id")) return;

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE nodes_v2 (
        owner_user_id TEXT NOT NULL,
        github_id INTEGER NOT NULL,
        login TEXT NOT NULL,
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
        twitter_username TEXT,
        email TEXT,
        hireable INTEGER,
        public_repos INTEGER,
        public_gists INTEGER,
        followers_count INTEGER,
        following_count INTEGER,
        github_created_at TEXT,
        github_updated_at TEXT,
        user_type TEXT,
        site_admin INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_user_id, github_id),
        UNIQUE (owner_user_id, login)
      );

      CREATE INDEX idx_nodes_owner_expanded ON nodes_v2(owner_user_id, expanded);
      CREATE INDEX idx_nodes_owner_depth ON nodes_v2(owner_user_id, depth);
      CREATE INDEX idx_nodes_owner_login_lc ON nodes_v2(owner_user_id, lower(login));
    `);

    db.exec(`
      INSERT INTO nodes_v2 (
        owner_user_id, github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url,
        profile_json, twitter_username, email, hireable, public_repos, public_gists, followers_count, following_count,
        github_created_at, github_updated_at, user_type, site_admin, updated_at
      )
      SELECT
        '${PUBLIC_GRAPH_OWNER_ID}', github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url,
        profile_json, twitter_username, email, hireable, public_repos, public_gists, followers_count, following_count,
        github_created_at, github_updated_at, user_type, site_admin, updated_at
      FROM nodes
    `);

    db.exec(`
      CREATE TABLE edges_v2 (
        owner_user_id TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'follows',
        PRIMARY KEY (owner_user_id, source_id, target_id, kind)
      );
      CREATE INDEX idx_edges_owner_source_kind ON edges_v2(owner_user_id, source_id, kind);
      CREATE INDEX idx_edges_owner_target_kind ON edges_v2(owner_user_id, target_id, kind);
    `);

    db.exec(`
      INSERT INTO edges_v2 (owner_user_id, source_id, target_id, kind)
      SELECT '${PUBLIC_GRAPH_OWNER_ID}', source_id, target_id, kind
      FROM edges
    `);

    db.exec(`
      DROP TABLE edges;
      DROP TABLE nodes;
      ALTER TABLE nodes_v2 RENAME TO nodes;
      ALTER TABLE edges_v2 RENAME TO edges;
    `);

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function ensureAugmentTables(db: Database.Database): void {
  const socialCols = tableColumns(db, "node_social_accounts");
  if (socialCols.size > 0 && !socialCols.has("owner_user_id")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE node_social_accounts_v2 (
          owner_user_id TEXT NOT NULL,
          user_github_id INTEGER NOT NULL,
          provider TEXT NOT NULL,
          url TEXT NOT NULL,
          PRIMARY KEY (owner_user_id, user_github_id, provider, url)
        );
        INSERT INTO node_social_accounts_v2 (owner_user_id, user_github_id, provider, url)
        SELECT '${PUBLIC_GRAPH_OWNER_ID}', user_github_id, provider, url
        FROM node_social_accounts;
        DROP TABLE node_social_accounts;
        ALTER TABLE node_social_accounts_v2 RENAME TO node_social_accounts;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  const orgCols = tableColumns(db, "node_org_memberships");
  if (orgCols.size > 0 && !orgCols.has("owner_user_id")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE node_org_memberships_v2 (
          owner_user_id TEXT NOT NULL,
          user_github_id INTEGER NOT NULL,
          org_id INTEGER NOT NULL,
          org_login TEXT NOT NULL,
          avatar_url TEXT,
          description TEXT,
          html_url TEXT,
          PRIMARY KEY (owner_user_id, user_github_id, org_id)
        );
        INSERT INTO node_org_memberships_v2 (
          owner_user_id, user_github_id, org_id, org_login, avatar_url, description, html_url
        )
        SELECT
          '${PUBLIC_GRAPH_OWNER_ID}', user_github_id, org_id, org_login, avatar_url, description, html_url
        FROM node_org_memberships;
        DROP TABLE node_org_memberships;
        ALTER TABLE node_org_memberships_v2 RENAME TO node_org_memberships;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS node_social_accounts (
      owner_user_id TEXT NOT NULL,
      user_github_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      url TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, user_github_id, provider, url)
    );
    CREATE INDEX IF NOT EXISTS idx_node_social_owner_user ON node_social_accounts(owner_user_id, user_github_id);

    CREATE TABLE IF NOT EXISTS node_org_memberships (
      owner_user_id TEXT NOT NULL,
      user_github_id INTEGER NOT NULL,
      org_id INTEGER NOT NULL,
      org_login TEXT NOT NULL,
      avatar_url TEXT,
      description TEXT,
      html_url TEXT,
      PRIMARY KEY (owner_user_id, user_github_id, org_id)
    );
    CREATE INDEX IF NOT EXISTS idx_node_org_owner_user ON node_org_memberships(owner_user_id, user_github_id);
    CREATE INDEX IF NOT EXISTS idx_node_org_owner_login ON node_org_memberships(owner_user_id, org_login);
  `);
}

/**
 * One-time cleanup for legacy owner-scoped data that used pre-migration depth semantics.
 * Public demo graph rows are preserved.
 */
function purgeLegacyOwnerDataOnce(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const alreadyPurged = db
    .prepare(`SELECT value FROM app_meta WHERE key = ? LIMIT 1`)
    .get(LEGACY_OWNER_PURGE_FLAG) as { value: string } | undefined;
  if (alreadyPurged?.value === "1") return;

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM edges WHERE owner_user_id <> ?`).run(PUBLIC_GRAPH_OWNER_ID);
    db.prepare(`DELETE FROM nodes WHERE owner_user_id <> ?`).run(PUBLIC_GRAPH_OWNER_ID);
    db.prepare(`DELETE FROM node_social_accounts WHERE owner_user_id <> ?`).run(PUBLIC_GRAPH_OWNER_ID);
    db.prepare(`DELETE FROM node_org_memberships WHERE owner_user_id <> ?`).run(PUBLIC_GRAPH_OWNER_ID);
    db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, '1')`).run(LEGACY_OWNER_PURGE_FLAG);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * One-time migration to 1-based owner-relative degree for owner-scoped rows.
 * If an owner still has any depth=0 rows from legacy 0-based writes, shift all
 * rows for that owner by +1 so relative ordering remains intact.
 */
function normalizeOwnerDegreeBaselineOnce(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const alreadyNormalized = db
    .prepare(`SELECT value FROM app_meta WHERE key = ? LIMIT 1`)
    .get(OWNER_DEGREE_BASELINE_FLAG) as { value: string } | undefined;
  if (alreadyNormalized?.value === "1") return;

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE nodes
       SET depth = depth + 1
       WHERE owner_user_id IN (
         SELECT owner_user_id
         FROM nodes
         WHERE owner_user_id <> ? AND depth = 0
         GROUP BY owner_user_id
       )`,
    ).run(PUBLIC_GRAPH_OWNER_ID);
    db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, '1')`).run(OWNER_DEGREE_BASELINE_FLAG);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function replaceNodeSocialAccounts(
  db: Database.Database,
  ownerUserId: string,
  userGithubId: number,
  accounts: Array<{ provider?: string | null; url?: string | null }>,
): void {
  const del = db.prepare(`DELETE FROM node_social_accounts WHERE owner_user_id = ? AND user_github_id = ?`);
  const ins = db.prepare(
    `INSERT INTO node_social_accounts (owner_user_id, user_github_id, provider, url) VALUES (?, ?, ?, ?)`,
  );
  db.transaction(() => {
    del.run(ownerUserId, userGithubId);
    for (const a of accounts) {
      const p = typeof a.provider === "string" ? a.provider.trim() : "";
      const u = typeof a.url === "string" ? a.url.trim() : "";
      if (!p || !u) continue;
      ins.run(ownerUserId, userGithubId, p, u);
    }
  })();
}

function replaceNodeOrgMemberships(
  db: Database.Database,
  ownerUserId: string,
  userGithubId: number,
  orgs: Array<{
    id?: number;
    login?: string | null;
    avatar_url?: string | null;
    description?: string | null;
    html_url?: string | null;
  }>,
): void {
  const del = db.prepare(`DELETE FROM node_org_memberships WHERE owner_user_id = ? AND user_github_id = ?`);
  const ins = db.prepare(
    `INSERT INTO node_org_memberships (
      owner_user_id, user_github_id, org_id, org_login, avatar_url, description, html_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    del.run(ownerUserId, userGithubId);
    for (const o of orgs) {
      if (typeof o.id !== "number") continue;
      const login = typeof o.login === "string" ? o.login : "";
      if (!login) continue;
      ins.run(ownerUserId, userGithubId, o.id, login, o.avatar_url ?? null, o.description ?? null, o.html_url ?? null);
    }
  })();
}

function persistNodeAugments(
  db: Database.Database,
  ownerUserId: string,
  userGithubId: number,
  crawlAugments?: NodePersistAugments | null,
): void {
  if (!crawlAugments) return;
  replaceNodeSocialAccounts(db, ownerUserId, userGithubId, crawlAugments.socialAccounts);
  replaceNodeOrgMemberships(db, ownerUserId, userGithubId, crawlAugments.organizations);
}

export type NodePersistAugments = {
  socialAccounts: Array<{ provider?: string | null; url?: string | null }>;
  organizations: Array<{
    id?: number;
    login?: string | null;
    avatar_url?: string | null;
    description?: string | null;
    html_url?: string | null;
  }>;
};

export function publicGraphOwnerId(): string {
  return PUBLIC_GRAPH_OWNER_ID;
}

/**
 * SQLite persistence for graph crawls with owner-scoped graph namespaces.
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
  `);

  ensureNodeColumns(db);
  ensureOwnerScopedSchema(db);
  ensureAugmentTables(db);
  purgeLegacyOwnerDataOnce(db);
  normalizeOwnerDegreeBaselineOnce(db);

  return db;
}

export type NodeRowInput = {
  ownerUserId: string;
  githubId: number;
  login: string;
  degree: number;
  expanded: 0 | 1;
  avatarUrl: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  htmlUrl: string;
  /** Stringified `GET /users/{login}` JSON; null for legacy slim rows. */
  profileJson: string | null;
  twitterUsername: string | null;
  email: string | null;
  hireable: number | null;
  publicRepos: number | null;
  publicGists: number | null;
  followersCount: number | null;
  followingCount: number | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  userType: string | null;
  siteAdmin: number | null;
};

export function persistNode(
  db: Database.Database,
  row: NodeRowInput,
  crawlAugments?: NodePersistAugments | null,
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO nodes (
      owner_user_id, github_id, login, depth, expanded, avatar_url, name, bio, company, location, blog, html_url, profile_json,
      twitter_username, email, hireable, public_repos, public_gists, followers_count, following_count,
      github_created_at, github_updated_at, user_type, site_admin,
      updated_at
    ) VALUES (
      @owner_user_id, @github_id, @login, @depth, @expanded, @avatar_url, @name, @bio, @company, @location, @blog, @html_url, @profile_json,
      @twitter_username, @email, @hireable, @public_repos, @public_gists, @followers_count, @following_count,
      @github_created_at, @github_updated_at, @user_type, @site_admin,
      @updated_at
    )
    ON CONFLICT(owner_user_id, github_id) DO UPDATE SET
      login = excluded.login,
      depth = MIN(nodes.depth, excluded.depth),
      expanded = MAX(nodes.expanded, excluded.expanded),
      avatar_url = COALESCE(excluded.avatar_url, nodes.avatar_url),
      name = COALESCE(excluded.name, nodes.name),
      bio = COALESCE(excluded.bio, nodes.bio),
      company = COALESCE(excluded.company, nodes.company),
      location = COALESCE(excluded.location, nodes.location),
      blog = COALESCE(excluded.blog, nodes.blog),
      html_url = COALESCE(excluded.html_url, nodes.html_url),
      profile_json = COALESCE(excluded.profile_json, nodes.profile_json),
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
    owner_user_id: row.ownerUserId,
    github_id: row.githubId,
    login: row.login,
    depth: row.degree,
    expanded: row.expanded,
    avatar_url: row.avatarUrl,
    name: row.name,
    bio: row.bio,
    company: row.company,
    location: row.location,
    blog: row.blog,
    html_url: row.htmlUrl,
    profile_json: row.profileJson,
    twitter_username: row.twitterUsername,
    email: row.email,
    hireable: row.hireable,
    public_repos: row.publicRepos,
    public_gists: row.publicGists,
    followers_count: row.followersCount,
    following_count: row.followingCount,
    github_created_at: row.githubCreatedAt,
    github_updated_at: row.githubUpdatedAt,
    user_type: row.userType,
    site_admin: row.siteAdmin,
    updated_at: now,
  });
  persistNodeAugments(db, row.ownerUserId, row.githubId, crawlAugments);
}

export function persistFollowsEdge(
  db: Database.Database,
  ownerUserId: string,
  sourceId: number,
  targetId: number,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO edges (owner_user_id, source_id, target_id, kind) VALUES (?, ?, ?, 'follows')`,
  ).run(ownerUserId, sourceId, targetId);
}
