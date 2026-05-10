import type { GithubPublicUser } from "./types.js";

/** Columns duplicated on `nodes` for SQL queries without parsing `profile_json`. */
export type CrawlNodeScalars = {
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

export function crawlScalarsFromGithubUser(user: GithubPublicUser): CrawlNodeScalars {
  return {
    twitterUsername: user.twitter_username ?? null,
    email: user.email ?? null,
    hireable:
      user.hireable === null || user.hireable === undefined ? null : user.hireable ? 1 : 0,
    publicRepos: user.public_repos ?? null,
    publicGists: user.public_gists ?? null,
    followersCount: user.followers ?? null,
    followingCount: user.following ?? null,
    githubCreatedAt: user.created_at ?? null,
    githubUpdatedAt: user.updated_at ?? null,
    userType: user.type ?? null,
    siteAdmin: user.site_admin === undefined ? null : user.site_admin ? 1 : 0,
  };
}
