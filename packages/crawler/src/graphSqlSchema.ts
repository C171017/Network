import Database from "better-sqlite3";
import type { GithubPublicOrganization, GithubSocialAccount } from "./types.js";

export type PersistNodeAugments = {
  socialAccounts: GithubSocialAccount[];
  organizations: GithubPublicOrganization[];
};

function nodeColumnNames(db: InstanceType<typeof Database>): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(nodes)`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/**
 * Applies additive SQLite migrations shared by the API server graph DB and crawler CLI DB.
 */
export function applyGraphSqlMigrations(db: InstanceType<typeof Database>): void {
  const cols = nodeColumnNames(db);
  const addCol = (name: string, decl: string) => {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE nodes ADD COLUMN ${name} ${decl}`);
      cols.add(name);
    }
  };

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS node_social_accounts (
      user_github_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      url TEXT NOT NULL,
      PRIMARY KEY (user_github_id, provider, url),
      FOREIGN KEY (user_github_id) REFERENCES nodes(github_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_node_social_user ON node_social_accounts(user_github_id);

    CREATE TABLE IF NOT EXISTS node_org_memberships (
      user_github_id INTEGER NOT NULL,
      org_id INTEGER NOT NULL,
      org_login TEXT NOT NULL,
      avatar_url TEXT,
      description TEXT,
      html_url TEXT,
      PRIMARY KEY (user_github_id, org_id),
      FOREIGN KEY (user_github_id) REFERENCES nodes(github_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_node_org_user ON node_org_memberships(user_github_id);
    CREATE INDEX IF NOT EXISTS idx_node_org_login ON node_org_memberships(org_login);
  `);
}

export function replaceNodeSocialAccounts(
  db: InstanceType<typeof Database>,
  userGithubId: number,
  accounts: GithubSocialAccount[],
): void {
  const del = db.prepare(`DELETE FROM node_social_accounts WHERE user_github_id = ?`);
  const ins = db.prepare(
    `INSERT INTO node_social_accounts (user_github_id, provider, url) VALUES (?, ?, ?)`,
  );
  db.transaction(() => {
    del.run(userGithubId);
    for (const a of accounts) {
      if (typeof a.provider !== "string" || typeof a.url !== "string") continue;
      const p = a.provider.trim();
      const u = a.url.trim();
      if (!p || !u) continue;
      ins.run(userGithubId, p, u);
    }
  })();
}

export function replaceNodeOrgMemberships(
  db: InstanceType<typeof Database>,
  userGithubId: number,
  orgs: GithubPublicOrganization[],
): void {
  const del = db.prepare(`DELETE FROM node_org_memberships WHERE user_github_id = ?`);
  const ins = db.prepare(
    `INSERT INTO node_org_memberships (user_github_id, org_id, org_login, avatar_url, description, html_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    del.run(userGithubId);
    for (const o of orgs) {
      if (typeof o.id !== "number" || typeof o.login !== "string") continue;
      ins.run(
        userGithubId,
        o.id,
        o.login,
        o.avatar_url ?? null,
        o.description ?? null,
        o.html_url ?? null,
      );
    }
  })();
}

export function persistNodeNormalizedAugments(
  db: InstanceType<typeof Database>,
  userGithubId: number,
  augments: PersistNodeAugments | null | undefined,
): void {
  if (augments == null) return;
  replaceNodeSocialAccounts(db, userGithubId, augments.socialAccounts);
  replaceNodeOrgMemberships(db, userGithubId, augments.organizations);
}
