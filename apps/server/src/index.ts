import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import { expandStarGraph } from "./githubExpand.js";

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

  let body: { rootLogin?: string; maxFollowers?: number; maxFollowing?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }

  const rootLogin = body.rootLogin?.trim();
  if (!rootLogin) {
    return c.json({ error: "bad_request", message: "rootLogin is required" }, 400);
  }

  const maxFollowers = Math.min(Math.max(body.maxFollowers ?? 80, 1), 200);
  const maxFollowing = Math.min(Math.max(body.maxFollowing ?? 80, 1), 200);

  try {
    const graph = await expandStarGraph({
      token: githubToken,
      rootLogin,
      maxFollowers,
      maxFollowing,
    });
    return c.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: "github_error", message }, 502);
  }
});

const port = Number(process.env.PORT ?? 8787);
console.error(`[server] listening on http://localhost:${port} (cors: ${allowedOrigin})`);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error(
    "[server] warning: SUPABASE_URL / SUPABASE_ANON_KEY missing after loading .env — check apps/server/.env",
  );
}

serve({ fetch: app.fetch, port });
