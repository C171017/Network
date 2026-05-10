import type {
  GithubPublicOrganization,
  GithubPublicUser,
  GithubSocialAccount,
} from "./types.js";

export type GithubProfileAugments = {
  social_accounts?: GithubSocialAccount[];
  organizations?: GithubPublicOrganization[];
};

/**
 * Build the object stored as `nodes.profile_json`: full GitHub `GET /users/{login}` JSON
 * (all keys preserved) plus `social_accounts` / `organizations` from their list endpoints.
 */
export function expandProfileRecord(
  user: GithubPublicUser,
  augments?: GithubProfileAugments,
): Record<string, unknown> {
  const profile: Record<string, unknown> = { ...(user as unknown as Record<string, unknown>) };
  if (augments?.social_accounts != null) {
    profile.social_accounts = augments.social_accounts;
  } else {
    delete profile.social_accounts;
  }
  if (augments?.organizations != null) {
    profile.organizations = augments.organizations;
  } else {
    delete profile.organizations;
  }
  return profile;
}
