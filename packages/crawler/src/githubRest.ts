import type { GithubPublicUser, GithubUserSlim } from "./types.js";

const API = "https://api.github.com";

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
