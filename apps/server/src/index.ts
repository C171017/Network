import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_FOLLOWING_BRANCH, expandFollowingDepthGraph } from "./githubExpand.js";
import { readFullGraph, readReachableGraph } from "./graphRead.js";
import { openGraphDatabase, resolveGraphDbPath } from "./graphStore.js";
import { readGithubLoginFromUser } from "./githubUser.js";

/**
 * Load env from stable paths (not `process.cwd()`), so `npm` / `tsx` working
 * directory does not skip `apps/server/.env`.
 */
function loadEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverDir = resolve(here, "..");
  const repoRoot = resolve(serverDir, "..", "..");
  const rootEnv = resolve(repoRoot, ".env");
  const serverEnv = resolve(serverDir, ".env");

  if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });
  if (existsSync(serverEnv)) dotenv.config({ path: serverEnv, override: true });
}

loadEnvFiles();

const graphDbPath = resolveGraphDbPath();
const graphDb = openGraphDatabase(graphDbPath);

const app = new Hono();

const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(
  "*",
  cors({
    origin: allowedOrigin,
    allowHeaders: ["Content-Type", "Authorization", "X-GitHub-Access-Token"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.get("/api/graph/public", (c) => {
  try {
    const graph = readFullGraph(graphDb);
    return c.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: "graph_read_failed", message }, 500);
  }
});

app.get("/api/graph/me", async (c) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return c.json({ error: "server_misconfigured", message: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }, 500);
  }

  const authHeader = c.req.header("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json({ error: "unauthorized", message: "Missing Authorization: Bearer <supabase_access_token>" }, 401);
  }
  const supabaseAccessToken = match[1]!.trim();

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userErr } = await supabase.auth.getUser(supabaseAccessToken);
  if (userErr || !userData.user) {
    return c.json({ error: "unauthorized", message: userErr?.message ?? "Invalid session" }, 401);
  }

  const inferred = readGithubLoginFromUser(userData.user);
  if (!inferred) {
    return c.json(
      { error: "bad_request", message: "Could not infer GitHub login from Supabase user metadata." },
      400,
    );
  }

  const qRoot = c.req.query("rootLogin")?.trim();
  const effectiveRoot = (qRoot && qRoot.length > 0 ? qRoot : inferred).trim();
  if (effectiveRoot.toLowerCase() !== inferred.toLowerCase()) {
    return c.json(
      {
        error: "forbidden",
        message: "rootLogin must match the signed-in GitHub user.",
      },
      403,
    );
  }

  try {
    const graph = readReachableGraph(graphDb, effectiveRoot);
    return c.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: "graph_read_failed", message }, 500);
  }
});

app.post("/api/graph/expand", async (c) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return c.json({ error: "server_misconfigured", message: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }, 500);
  }

  const authHeader = c.req.header("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json({ error: "unauthorized", message: "Missing Authorization: Bearer <supabase_access_token>" }, 401);
  }
  const supabaseAccessToken = match[1]!.trim();

  const githubToken = c.req.header("x-github-access-token")?.trim();
  if (!githubToken) {
    return c.json(
      {
        error: "bad_request",
        message:
          "Missing X-GitHub-Access-Token (Supabase session.provider_token after GitHub OAuth).",
      },
      400,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userErr } = await supabase.auth.getUser(supabaseAccessToken);
  if (userErr || !userData.user) {
    return c.json({ error: "unauthorized", message: userErr?.message ?? "Invalid session" }, 401);
  }

  let body: { rootLogin?: string; maxFollowing?: number; maxFollowers?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }

  const rootLogin = body.rootLogin?.trim();
  if (!rootLogin) {
    return c.json({ error: "bad_request", message: "rootLogin is required" }, 400);
  }

  const branchFollowing = Math.min(Math.max(body.maxFollowing ?? DEFAULT_FOLLOWING_BRANCH, 1), 20);
  const branchFollowers = Math.min(
    Math.max(body.maxFollowers ?? body.maxFollowing ?? DEFAULT_FOLLOWING_BRANCH, 1),
    20,
  );

  try {
    const graph = await expandFollowingDepthGraph({
      token: githubToken,
      rootLogin,
      db: graphDb,
      branchFollowing,
      branchFollowers,
    });
    return c.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: "github_error", message }, 502);
  }
});

const port = Number(process.env.PORT ?? 8787);
console.error(`[server] listening on http://localhost:${port} (cors: ${allowedOrigin})`);
console.error(`[server] graph sqlite: ${graphDbPath}`);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error(
    "[server] warning: SUPABASE_URL / SUPABASE_ANON_KEY missing after loading .env — check apps/server/.env",
  );
}

serve({ fetch: app.fetch, port });
