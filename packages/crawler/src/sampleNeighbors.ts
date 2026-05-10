import type { GithubRestClient } from "./githubRest.js";
import type { NeighborPick } from "./types.js";

function shuffleInPlace<T>(arr: T[], random: () => number): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Fetches first-degree followers and following (up to `maxPagesPerSide` pages each),
 * then independently shuffles each side and samples up to `branchFollowers` /
 * `branchFollowing` users (or fewer if the list is shorter). Users who appear in
 * both samples become a single `mutual` pick.
 */
export async function sampleRandomFirstDegreeNeighbors(
  gh: GithubRestClient,
  subjectLogin: string,
  branchFollowers: number,
  branchFollowing: number,
  maxPagesPerSide: number,
  random: () => number,
): Promise<NeighborPick[]> {
  const [followers, following] = await Promise.all([
    gh.listFirstDegree(subjectLogin, "followers", maxPagesPerSide),
    gh.listFirstDegree(subjectLogin, "following", maxPagesPerSide),
  ]);

  const followerPool = [...followers];
  const followingPool = [...following];
  shuffleInPlace(followerPool, random);
  shuffleInPlace(followingPool, random);

  const followerSlice = followerPool.slice(0, Math.min(branchFollowers, followerPool.length));
  const followingSlice = followingPool.slice(0, Math.min(branchFollowing, followingPool.length));

  const byId = new Map<number, NeighborPick>();
  for (const u of followerSlice) {
    byId.set(u.id, { user: u, edge: "incoming" });
  }
  for (const u of followingSlice) {
    const existing = byId.get(u.id);
    if (!existing) {
      byId.set(u.id, { user: u, edge: "outgoing" });
    } else if (existing.edge === "incoming") {
      byId.set(u.id, { user: existing.user, edge: "mutual" });
    }
  }

  return [...byId.values()];
}
