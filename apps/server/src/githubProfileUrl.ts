/** GitHub profile page URL: API `html_url` when present, else canonical `https://github.com/{login}`. */
export function githubProfilePageUrl(login: string, htmlUrl: string | null | undefined): string {
  const t = (htmlUrl ?? "").trim();
  if (t.length > 0) return t;
  return `https://github.com/${encodeURIComponent(login)}`;
}
