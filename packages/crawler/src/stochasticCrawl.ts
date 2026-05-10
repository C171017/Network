import type { StochasticCrawlConfig, CrawlStats } from "./types.js";
import { GithubRestClient, GithubRateLimitError } from "./githubRest.js";
import { sampleRandomFirstDegreeNeighbors } from "./sampleNeighbors.js";
import {
  openStore,
  insertSlimNodeIfMissing,
  markExpandedFullProfile,
  insertFollowsEdge,
} from "./sqliteStore.js";

type QueueItem = { login: string; depth: number };

function applyEdges(
  db: ReturnType<typeof openStore>,
  subjectId: number,
  neighborId: number,
  edge: "incoming" | "outgoing" | "mutual",
): number {
  let added = 0;
  if (edge === "incoming") {
    insertFollowsEdge(db, neighborId, subjectId);
    added += 1;
  } else if (edge === "outgoing") {
    insertFollowsEdge(db, subjectId, neighborId);
    added += 1;
  } else {
    insertFollowsEdge(db, neighborId, subjectId);
    insertFollowsEdge(db, subjectId, neighborId);
    added += 2;
  }
  return added;
}

/**
 * Stochastic BFS on GitHub follow graph:
 * - At each expanded node, sample `branchSample` neighbors from first-degree
 *   (followers ∪ following), pooled from the first `maxPagesPerSide` pages per side.
 * - Expand only while `depth < maxDepth` (seed has depth 0).
 * - Same function is intended for: local CLI seeding, later server job after OAuth.
 */
export async function runStochasticCrawl(
  config: StochasticCrawlConfig,
  options?: { random?: () => number },
): Promise<CrawlStats> {
  const random = options?.random ?? Math.random;
  const gh = new GithubRestClient(config.token);
  const db = openStore(config.dbPath, { reset: config.reset });

  const stats: CrawlStats = {
    nodesUpserted: 0,
    edgesUpserted: 0,
    expansions: 0,
    apiRequests: 0,
    stoppedReason: "complete",
  };

  const queue: QueueItem[] = [{ login: config.seedLogin, depth: 0 }];
  const expandedLogins = new Set<string>();

  try {
    while (queue.length > 0 && stats.expansions < config.maxExpansions) {
      const item = queue.shift()!;
      const { login, depth } = item;

      if (expandedLogins.has(login)) continue;
      if (depth >= config.maxDepth) continue;

      expandedLogins.add(login);
      stats.expansions += 1;

      const subject = await gh.getUser(login);
      markExpandedFullProfile(db, subject, depth);

      const picks = await sampleRandomFirstDegreeNeighbors(
        gh,
        subject.login,
        config.branchSample,
        config.maxPagesPerSide,
        random,
      );

      for (const pick of picks) {
        const v = pick.user;
        insertSlimNodeIfMissing(db, v, depth + 1);
        stats.edgesUpserted += applyEdges(db, subject.id, v.id, pick.edge);

        const nextDepth = depth + 1;
        if (nextDepth < config.maxDepth && !expandedLogins.has(v.login)) {
          queue.push({ login: v.login, depth: nextDepth });
        }
      }
    }

    stats.nodesUpserted = (
      db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as { c: number }
    ).c;
    stats.edgesUpserted = (
      db.prepare(`SELECT COUNT(*) as c FROM edges`).get() as { c: number }
    ).c;

    if (stats.expansions >= config.maxExpansions) {
      stats.stoppedReason = "max_expansions";
    } else if (queue.length === 0) {
      stats.stoppedReason = "empty_frontier";
    }
  } catch (e) {
    if (e instanceof GithubRateLimitError) {
      stats.stoppedReason = "rate_limited";
    }
    stats.apiRequests = gh.apiRequests;
    throw e;
  } finally {
    stats.apiRequests = gh.apiRequests;
    db.close();
  }

  return stats;
}
