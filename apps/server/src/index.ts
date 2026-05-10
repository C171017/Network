import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_AUGMENTS_MAX_PAGES,
  DEFAULT_FOLLOWING_BRANCH,
  DEFAULT_PROFILE_AUGMENTS_MODE,
  expandFollowingDepthGraph,
  type GithubProfileAugmentsMode,
} from "./githubExpand.js";
import { readFullGraph, readOwnerGraph, readReachableGraph } from "./graphRead.js";
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

type ParsedExpandBody = {
  rootLogin: string;
  branchFollowing: number;
  branchFollowers: number;
  profileAugments: GithubProfileAugmentsMode;
  augmentsMaxPages: number;
  maxProfileEnrichmentsPerSide?: number;
};

function parseExpandJsonBody(raw: unknown): ParsedExpandBody | { error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Expected JSON object body" };
  }
  const body = raw as {
    rootLogin?: string;
    maxFollowing?: number;
    maxFollowers?: number;
    profileAugments?: unknown;
    augmentsMaxPages?: unknown;
    maxProfileEnrichmentsPerSide?: unknown;
  };
  const rootLogin = body.rootLogin?.trim();
  if (!rootLogin) {
    return { error: "rootLogin is required" };
  }

  const branchFollowing = Math.min(Math.max(body.maxFollowing ?? DEFAULT_FOLLOWING_BRANCH, 1), 20);
  const branchFollowers = Math.min(
    Math.max(body.maxFollowers ?? body.maxFollowing ?? DEFAULT_FOLLOWING_BRANCH, 1),
    20,
  );

  let profileAugments: GithubProfileAugmentsMode = DEFAULT_PROFILE_AUGMENTS_MODE;
  if (body.profileAugments !== undefined && body.profileAugments !== null) {
    const m = body.profileAugments;
    if (m !== "none" && m !== "root" && m !== "all") {
      return { error: 'profileAugments must be "none", "root", or "all".' };
    }
    profileAugments = m;
  }

  let augmentsMaxPages = DEFAULT_AUGMENTS_MAX_PAGES;
  if (body.augmentsMaxPages !== undefined && body.augmentsMaxPages !== null) {
    const n = body.augmentsMaxPages;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 100) {
      return { error: "augmentsMaxPages must be an integer between 1 and 100." };
    }
    augmentsMaxPages = n;
  }

  let maxProfileEnrichmentsPerSide: number | undefined;
  if (
    body.maxProfileEnrichmentsPerSide !== undefined &&
    body.maxProfileEnrichmentsPerSide !== null
  ) {
    const n = body.maxProfileEnrichmentsPerSide;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 500) {
      return { error: "maxProfileEnrichmentsPerSide must be an integer between 0 and 500." };
    }
    maxProfileEnrichmentsPerSide = n;
  }

  return {
    rootLogin,
    branchFollowing,
    branchFollowers,
    profileAugments,
    augmentsMaxPages,
    ...(maxProfileEnrichmentsPerSide !== undefined ? { maxProfileEnrichmentsPerSide } : {}),
  };
}

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

  const scope = (c.req.query("scope") ?? "").trim().toLowerCase();
  if (scope === "owner") {
    try {
      const graph = readOwnerGraph(graphDb, userData.user.id);
      return c.json(graph);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: "graph_read_failed", message }, 500);
    }
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
    const graph = readReachableGraph(graphDb, userData.user.id, effectiveRoot);
    return c.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: "graph_read_failed", message }, 500);
  }
});

async function authorizeExpandRequest(c: Context) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      error: c.json({ error: "server_misconfigured", message: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }, 500),
    } as const;
  }

  const authHeader = c.req.header("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { error: c.json({ error: "unauthorized", message: "Missing Authorization: Bearer <supabase_access_token>" }, 401) } as const;
  }
  const supabaseAccessToken = match[1]!.trim();

  const githubToken = c.req.header("x-github-access-token")?.trim();
  if (!githubToken) {
    return {
      error: c.json(
        {
          error: "bad_request",
          message:
            "Missing X-GitHub-Access-Token (Supabase session.provider_token after GitHub OAuth).",
        },
        400,
      ),
    } as const;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userErr } = await supabase.auth.getUser(supabaseAccessToken);
  if (userErr || !userData.user) {
    return { error: c.json({ error: "unauthorized", message: userErr?.message ?? "Invalid session" }, 401) } as const;
  }

  return { githubToken, ownerUserId: userData.user.id } as const;
}

app.post("/api/graph/expand", async (c) => {
  const auth = await authorizeExpandRequest(c);
  if ("error" in auth) return auth.error;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }

  const parsed = parseExpandJsonBody(raw);
  if ("error" in parsed) {
    return c.json({ error: "bad_request", message: parsed.error }, 400);
  }

  try {
    const graph = await expandFollowingDepthGraph({
      ownerUserId: auth.ownerUserId,
      token: auth.githubToken,
      db: graphDb,
      rootLogin: parsed.rootLogin,
      branchFollowing: parsed.branchFollowing,
      branchFollowers: parsed.branchFollowers,
      profileAugments: parsed.profileAugments,
      augmentsMaxPages: parsed.augmentsMaxPages,
      ...(parsed.maxProfileEnrichmentsPerSide !== undefined
        ? { maxProfileEnrichmentsPerSide: parsed.maxProfileEnrichmentsPerSide }
        : {}),
    });
    return c.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: "github_error", message }, 502);
  }
});

app.post("/api/graph/expand-stream", async (c) => {
  const auth = await authorizeExpandRequest(c);
  if ("error" in auth) return auth.error;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }

  const parsed = parseExpandJsonBody(raw);
  if ("error" in parsed) {
    return c.json({ error: "bad_request", message: parsed.error }, 400);
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (ev: unknown) => {
        controller.enqueue(enc.encode(`${JSON.stringify(ev)}\n`));
      };
      try {
        await expandFollowingDepthGraph({
          ownerUserId: auth.ownerUserId,
          token: auth.githubToken,
          db: graphDb,
          rootLogin: parsed.rootLogin,
          branchFollowing: parsed.branchFollowing,
          branchFollowers: parsed.branchFollowers,
          profileAugments: parsed.profileAugments,
          augmentsMaxPages: parsed.augmentsMaxPages,
          ...(parsed.maxProfileEnrichmentsPerSide !== undefined
            ? { maxProfileEnrichmentsPerSide: parsed.maxProfileEnrichmentsPerSide }
            : {}),
          onProgress: (event) => {
            writeEvent(event);
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        writeEvent({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return c.newResponse(stream, 200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
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
