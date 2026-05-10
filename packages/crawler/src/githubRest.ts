import type {
  GithubPublicOrganization,
  GithubPublicUser,
  GithubSocialAccount,
  GithubUserSlim,
} from "./types.js";

const API = "https://api.github.com";

/** Max paginated pages (100 items each) per list endpoint to avoid huge fan-out on a single profile. */
const MAX_LIST_PAGES = 10;

export class GithubRateLimitError extends Error {
  retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "GithubRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GithubRestClient {
  private token: string;
  apiRequests = 0;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    this.apiRequests += 1;

    if (res.status === 403 || res.status === 429) {
      const retry = res.headers.get("retry-after");
      const retryAfterSeconds = retry ? Number(retry) : undefined;
      throw new GithubRateLimitError(await res.text(), retryAfterSeconds);
    }

    if (!res.ok) {
      throw new Error(`GitHub ${res.status} ${path}: ${await res.text()}`);
    }

    return (await res.json()) as T;
  }

  async getUser(login: string): Promise<GithubPublicUser> {
    return this.request<GithubPublicUser>(`/users/${encodeURIComponent(login)}`);
  }

  private async fetchAllPages<T>(pathWithoutQuery: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
      const chunk = await this.request<T[]>(`${pathWithoutQuery}?per_page=100&page=${page}`);
      if (!chunk.length) break;
      out.push(...chunk);
      if (chunk.length < 100) break;
    }
    return out;
  }

  /**
   * Public social profile links (sidebar on github.com — LinkedIn, Mastodon, etc.).
   * @see https://docs.github.com/en/rest/users/social-accounts
   */
  async listSocialAccounts(login: string): Promise<GithubSocialAccount[]> {
    return this.fetchAllPages<GithubSocialAccount>(
      `/users/${encodeURIComponent(login)}/social_accounts`,
    );
  }

  /**
   * Public organization memberships for the user (no OAuth scope beyond what list allows).
   * @see https://docs.github.com/en/rest/orgs/orgs#list-organizations-for-a-user
   */
  async listPublicOrganizations(login: string): Promise<GithubPublicOrganization[]> {
    return this.fetchAllPages<GithubPublicOrganization>(
      `/users/${encodeURIComponent(login)}/orgs`,
    );
  }

  /**
   * Full crawl payload for one login: canonical user JSON plus public social accounts + orgs.
   * (Follow lists are fetched separately via `listFirstDegree` / server expand.)
   *
   * Intentionally not included here (volume / separate product concerns): repos, gists,
   * starred, events, SSH keys — see package README / server expand docs if extended later.
   */
  async getUserExpanded(login: string): Promise<{
    user: GithubPublicUser;
    social_accounts: GithubSocialAccount[];
    organizations: GithubPublicOrganization[];
  }> {
    const enc = encodeURIComponent(login);
    const [user, social_accounts, organizations] = await Promise.all([
      this.getUser(login),
      this.fetchAllPages<GithubSocialAccount>(`/users/${enc}/social_accounts`),
      this.fetchAllPages<GithubPublicOrganization>(`/users/${enc}/orgs`),
    ]);
    return { user, social_accounts, organizations };
  }

  /**
   * Paginates followers or following for `login` up to `maxPages` pages (`per_page` = 100).
   */
  async listFirstDegree(
    login: string,
    kind: "followers" | "following",
    maxPages: number,
  ): Promise<GithubUserSlim[]> {
    const out: GithubUserSlim[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const chunk = await this.request<GithubUserSlim[]>(
        `/users/${encodeURIComponent(login)}/${kind}?per_page=100&page=${page}`,
      );
      if (chunk.length === 0) break;
      out.push(...chunk);
      if (chunk.length < 100) break;
    }
    return out;
  }
}
