import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { runStochasticCrawl } from "./stochasticCrawl.js";

for (const dir of [process.cwd(), resolve(process.cwd(), ".."), resolve(process.cwd(), "..", "..")]) {
  const p = resolve(dir, ".env");
  if (existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const seedLogin = process.env.SEED_LOGIN;
  if (!token) {
    console.error("Missing GITHUB_TOKEN (or GH_TOKEN) for authenticated API access.");
    process.exit(1);
  }
  if (!seedLogin) {
    console.error("Missing SEED_LOGIN (GitHub username to start from, e.g. yours).");
    process.exit(1);
  }

  const dbPath = process.env.DB_PATH ?? "./data/network.db";
  const branchSample = envInt("BRANCH_SAMPLE", 6);
  const maxDepth = envInt("MAX_DEPTH", 5);
  const maxPagesPerSide = envInt("MAX_PAGES_PER_SIDE", 3);
  const maxExpansions = envInt("MAX_EXPANSIONS", 200);
  const reset = process.env.RESET_DB === "1" || process.env.RESET_DB === "true";

  console.error(
    JSON.stringify(
      {
        seedLogin,
        dbPath,
        branchSample,
        maxDepth,
        maxPagesPerSide,
        maxExpansions,
        reset,
      },
      null,
      2,
    ),
  );

  const stats = await runStochasticCrawl({
    token,
    seedLogin,
    branchSample,
    maxDepth,
    maxPagesPerSide,
    maxExpansions,
    dbPath,
    reset,
  });

  console.log(JSON.stringify({ ok: true, stats }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
