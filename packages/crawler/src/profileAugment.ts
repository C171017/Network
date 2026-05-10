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
 * Build the object stored as `nodes.profile_json`: GitHub user payload plus optional extras.
 */
export function expandProfileRecord(
  user: GithubPublicUser,
  augments?: GithubProfileAugments,
): Record<string, unknown> {
  const profile: Record<string, unknown> = { ...(user as unknown as Record<string, unknown>) };
  if (augments?.social_accounts?.length) {
    profile.social_accounts = augments.social_accounts;
  }
  if (augments?.organizations?.length) {
    profile.organizations = augments.organizations;
  }
  return profile;
}
