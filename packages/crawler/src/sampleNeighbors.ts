import type { GithubUserSlim } from "./types.js";
import type { GithubRestClient } from "./githubRest.js";
import type { NeighborEdge, NeighborPick } from "./types.js";

function shuffleInPlace<T>(arr: T[], random: () => number): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Builds first-degree pool from followers ∪ following (unique by GitHub id),
 * then randomly samples up to `branchSample` neighbors.
 *
 * Note: pool is biased toward users GitHub returns on early pages unless you
 * raise `maxPagesPerSide` (more API calls). Documented tradeoff for hackathon.
 */
export async function sampleRandomFirstDegreeNeighbors(
  gh: GithubRestClient,
  subjectLogin: string,
  branchSample: number,
  maxPagesPerSide: number,
  random: () => number,
): Promise<NeighborPick[]> {
  const [followers, following] = await Promise.all([
    gh.listFirstDegree(subjectLogin, "followers", maxPagesPerSide),
    gh.listFirstDegree(subjectLogin, "following", maxPagesPerSide),
  ]);

  const byId = new Map<
    number,
    { user: GithubUserSlim; incoming: boolean; outgoing: boolean }
  >();

  const upsert = (u: GithubUserSlim, incoming: boolean, outgoing: boolean) => {
    const prev = byId.get(u.id);
    if (!prev) {
      byId.set(u.id, { user: u, incoming, outgoing });
      return;
    }
    byId.set(u.id, {
      user: u,
      incoming: prev.incoming || incoming,
      outgoing: prev.outgoing || outgoing,
    });
  };

  for (const u of followers) upsert(u, true, false);
  for (const u of following) upsert(u, false, true);

  const picks: NeighborPick[] = [];
  for (const { user, incoming, outgoing } of byId.values()) {
    let edge: NeighborEdge;
    if (incoming && outgoing) edge = "mutual";
    else if (incoming) edge = "incoming";
    else edge = "outgoing";
    picks.push({ user, edge });
  }

  shuffleInPlace(picks, random);
  return picks.slice(0, Math.min(branchSample, picks.length));
}
