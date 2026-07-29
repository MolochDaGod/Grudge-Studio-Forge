/**
 * grudge-forge-free-ai — free OpenAI-compatible proxy + agent/catalog edge API.
 *
 * Routes (also same-origin under forge.grudge-studio.com when CF routes match):
 *   GET  /api/free-ai/status
 *   POST /api/free-ai/chat?provider=
 *   GET  /api/catalog/status
 *   GET  /api/catalog/fast-assets
 *   GET  /api/agent/jobs
 *   POST /api/agent/jobs
 *   GET  /api/agent/jobs/:id
 *   PATCH /api/agent/jobs/:id
 *
 * Optional bindings:
 *   D1  env.DB  — durable agent_jobs table (see schema.sql)
 * Secrets (optional if client sends X-Api-Key BYOK):
 *   GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY,
 *   CEREBRAS_API_KEY, DEEPSEEK_API_KEY, TOGETHER_API_KEY
 */

// Bundled at deploy from artifacts/game-forge export (prebuild / export:fast-assets).
import EMBEDDED_CATALOG from "./fast-assets.json";

/** Loaded from SPA /catalog/fast-assets.json with in-memory cache; embedded fallback. */
let catalogCache = null;
let catalogCacheAt = 0;
const CATALOG_TTL_MS = 5 * 60 * 1000;

function normalizeCatalog(raw, source) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return {
    version: raw?.version || 1,
    generated: raw?.generated,
    count: typeof raw?.count === "number" ? raw.count : items.length,
    items,
    source,
  };
}

async function loadFastCatalog(env) {
  if (catalogCache && Date.now() - catalogCacheAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const origins = [
    (env.ORIGIN || "").replace(/\/$/, ""),
    "https://forge.grudge-studio.com",
    "https://grudge-studio-forge.vercel.app",
  ].filter(Boolean);
  for (const origin of origins) {
    try {
      const r = await fetch(`${origin}/catalog/fast-assets.json`, {
        cf: { cacheTtl: 300, cacheEverything: true },
        headers: { Accept: "application/json" },
      });
      if (!r.ok) continue;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      // SPA HTML fallback must not overwrite embedded catalog
      if (ct.includes("text/html")) continue;
      const data = await r.json();
      if (Array.isArray(data?.items) && data.items.length > 0) {
        catalogCache = normalizeCatalog(data, `remote:${origin}`);
        catalogCacheAt = Date.now();
        return catalogCache;
      }
    } catch {
      /* try next */
    }
  }
  // Deploy-time embedded catalog (always available)
  if (EMBEDDED_CATALOG?.items?.length) {
    catalogCache = normalizeCatalog(EMBEDDED_CATALOG, "embedded");
    catalogCacheAt = Date.now();
    return catalogCache;
  }
  return normalizeCatalog({ items: [] }, "empty-fallback");
}

const PROVIDERS = {
  groq: {
    base: "https://api.groq.com/openai/v1",
    env: "GROQ_API_KEY",
  },
  openrouter: {
    base: "https://openrouter.ai/api/v1",
    env: "OPENROUTER_API_KEY",
  },
  gemini: {
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    env: "GEMINI_API_KEY",
  },
  cerebras: {
    base: "https://api.cerebras.ai/v1",
    env: "CEREBRAS_API_KEY",
  },
  deepseek: {
    base: "https://api.deepseek.com",
    env: "DEEPSEEK_API_KEY",
  },
  together: {
    base: "https://api.together.xyz/v1",
    env: "TOGETHER_API_KEY",
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Api-Key, X-Title, HTTP-Referer",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function id() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function now() {
  return new Date().toISOString();
}

/** In-memory fallback when D1 is not bound (dev / first deploy). */
const memJobs = new Map();

async function ensureSchema(db) {
  if (!db) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS agent_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT,
        result_url TEXT,
        error TEXT,
        meta TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();
}

async function insertJob(env, job) {
  if (env.DB) {
    await ensureSchema(env.DB);
    await env.DB.prepare(
      `INSERT INTO agent_jobs (id, kind, status, prompt, result_url, error, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        job.id,
        job.kind,
        job.status,
        job.prompt ?? null,
        job.resultUrl ?? null,
        job.error ?? null,
        job.meta ? JSON.stringify(job.meta) : null,
        job.createdAt,
        job.updatedAt,
      )
      .run();
    return;
  }
  memJobs.set(job.id, job);
}

async function updateJob(env, jobId, patch) {
  const updatedAt = now();
  if (env.DB) {
    await ensureSchema(env.DB);
    const cur = await env.DB.prepare(`SELECT * FROM agent_jobs WHERE id = ?`)
      .bind(jobId)
      .first();
    if (!cur) return null;
    const status = patch.status ?? cur.status;
    const resultUrl =
      patch.resultUrl !== undefined ? patch.resultUrl : cur.result_url;
    const error = patch.error !== undefined ? patch.error : cur.error;
    await env.DB.prepare(
      `UPDATE agent_jobs SET status = ?, result_url = ?, error = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(status, resultUrl, error, updatedAt, jobId)
      .run();
    return rowToJob({
      ...cur,
      status,
      result_url: resultUrl,
      error,
      updated_at: updatedAt,
    });
  }
  const j = memJobs.get(jobId);
  if (!j) return null;
  Object.assign(j, patch, { updatedAt });
  memJobs.set(jobId, j);
  return j;
}

function rowToJob(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt ?? undefined,
    resultUrl: row.result_url ?? row.resultUrl ?? null,
    error: row.error ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    meta: row.meta
      ? typeof row.meta === "string"
        ? JSON.parse(row.meta)
        : row.meta
      : undefined,
  };
}

async function listJobs(env, limit = 50) {
  if (env.DB) {
    await ensureSchema(env.DB);
    const r = await env.DB.prepare(
      `SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all();
    return (r.results || []).map(rowToJob);
  }
  return [...memJobs.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

async function getJob(env, jobId) {
  if (env.DB) {
    await ensureSchema(env.DB);
    const cur = await env.DB.prepare(`SELECT * FROM agent_jobs WHERE id = ?`)
      .bind(jobId)
      .first();
    return cur ? rowToJob(cur) : null;
  }
  return memJobs.get(jobId) ?? null;
}

/** Simulate async agent work (texture/skybox jobs complete with R2-shaped hint). */
async function scheduleJobProgress(env, job) {
  // Edge can't run long GPU work here — mark ready with policy-compliant stub.
  // Real bake should call a bake Worker; UI + agents poll status.
  if (job.kind === "spawn-hint" || job.kind === "catalog") {
    await updateJob(env, job.id, {
      status: "ready",
      resultUrl: null,
      error: null,
    });
    return;
  }
  // pending → running → ready (best-effort fire-and-forget)
  try {
    await updateJob(env, job.id, { status: "running" });
    // No sleep API with waitUntil outside ctx — mark ready immediately with guidance
    await updateJob(env, job.id, {
      status: "ready",
      resultUrl: null,
      error: null,
    });
  } catch {
    /* ignore */
  }
}

function isCatalogPath(path, suffix) {
  // Accept /api/catalog/<suffix>, /catalog/<suffix>, trailing slashes stripped upstream
  return (
    path === `/api/catalog/${suffix}` ||
    path === `/catalog/${suffix}` ||
    path.endsWith(`/api/catalog/${suffix}`) ||
    path.endsWith(`/catalog/${suffix}`)
  );
}

async function handleCatalog(path, env) {
  if (isCatalogPath(path, "status")) {
    const fastAssets = await loadFastCatalog(env);
    return json({
      ok: true,
      service: "grudge-forge-free-ai",
      d1: Boolean(env.DB),
      fastAssetCount: fastAssets.count || (fastAssets.items || []).length,
      stack: [
        "cloudflare-workers",
        "r2-assets.grudge-studio.com",
        env.DB ? "d1-agent-jobs" : "memory-agent-jobs",
        "free-ai-byok",
        "vercel-spa",
      ],
      policy: {
        assets: "builtin: keys + https://assets.grudge-studio.com only",
        playData: "Railway Postgres (not this worker)",
        binaries: "R2",
      },
    });
  }
  if (isCatalogPath(path, "fast-assets")) {
    const fastAssets = await loadFastCatalog(env);
    return json({
      version: fastAssets.version || 1,
      count: fastAssets.count || (fastAssets.items || []).length,
      items: fastAssets.items || [],
      source: fastAssets.source || "edge",
    });
  }
  return null;
}

async function handleAgent(path, request, env, ctx) {
  const isList =
    path.endsWith("/api/agent/jobs") || path.endsWith("/agent/jobs");
  const jobMatch = path.match(/\/api\/agent\/jobs\/([^/]+)$/);

  if (request.method === "GET" && isList) {
    const jobs = await listJobs(env);
    return json({ jobs, d1: Boolean(env.DB) });
  }

  if (request.method === "POST" && isList) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const kind = typeof body.kind === "string" ? body.kind : "generic";
    const job = {
      id: id(),
      kind,
      status: "pending",
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      resultUrl: null,
      error: null,
      createdAt: now(),
      updatedAt: now(),
      meta: body.meta && typeof body.meta === "object" ? body.meta : undefined,
    };
    await insertJob(env, job);
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(scheduleJobProgress(env, job));
    } else {
      await scheduleJobProgress(env, job);
    }
    return json(job, 201);
  }

  if (jobMatch) {
    const jobId = decodeURIComponent(jobMatch[1]);
    if (request.method === "GET") {
      const j = await getJob(env, jobId);
      return j ? json(j) : json({ error: "Not found" }, 404);
    }
    if (request.method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const j = await updateJob(env, jobId, body);
      return j ? json(j) : json({ error: "Not found" }, 404);
    }
  }

  return null;
}

async function handleFreeAi(path, request, env) {
  if (
    (path.endsWith("/api/free-ai/status") || path.endsWith("/status")) &&
    request.method === "GET" &&
    path.includes("free-ai")
  ) {
    const available = {};
    for (const [pid, p] of Object.entries(PROVIDERS)) {
      available[pid] = Boolean(env[p.env]);
    }
    return json({
      ok: true,
      service: "grudge-forge-free-ai",
      providers: available,
      byok: true,
      catalog: "/api/catalog/fast-assets",
      agentJobs: "/api/agent/jobs",
      d1: Boolean(env.DB),
      hint: "Send X-Api-Key for BYOK, or set server secrets for shared free keys.",
    });
  }

  // status without free-ai prefix when only /status
  if (path.endsWith("/api/free-ai/status") || path === "/status") {
    if (request.method === "GET" && path.includes("free-ai")) {
      /* handled above */
    }
  }

  if (
    !(path.endsWith("/api/free-ai/chat") || path.endsWith("/chat")) ||
    request.method !== "POST" ||
    !path.includes("free-ai")
  ) {
    return null;
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const url = new URL(request.url);
  const providerId =
    url.searchParams.get("provider") || body.provider || "groq";
  const p = PROVIDERS[providerId];
  if (!p) {
    return json(
      {
        error: `Unknown provider '${providerId}'`,
        known: Object.keys(PROVIDERS),
      },
      400,
    );
  }

  const userKey =
    request.headers.get("X-Api-Key") || request.headers.get("x-api-key");
  const apiKey = (userKey && userKey.trim()) || env[p.env];
  if (!apiKey) {
    return json(
      {
        error: `No API key for ${providerId}. Paste a free key in the AI Worker panel or set ${p.env} on the worker.`,
        signup: providerId,
      },
      401,
    );
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: "Missing messages[]" }, 400);
  }

  const model = typeof body.model === "string" ? body.model : undefined;
  if (!model) {
    return json({ error: "Missing model" }, 400);
  }

  const upstreamBody = {
    model,
    messages: body.messages,
    stream: body.stream !== false,
    max_tokens: Math.min(Number(body.max_tokens) || 8192, 16384),
  };
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    upstreamBody.tools = body.tools;
    upstreamBody.tool_choice = body.tool_choice ?? "auto";
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://forge.grudge-studio.com";
    headers["X-Title"] = "Grudge Forge";
  }

  let upstream;
  try {
    upstream = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    return json(
      { error: `Upstream ${providerId} failed: ${err.message || String(err)}` },
      502,
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || JSON.stringify({ error: `Upstream ${upstream.status}` }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (upstreamBody.stream && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS,
      },
    });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const catalogRes = await handleCatalog(path, env);
    if (catalogRes) return catalogRes;

    const agentRes = await handleAgent(path, request, env, ctx);
    if (agentRes) return agentRes;

    const freeRes = await handleFreeAi(path, request, env);
    if (freeRes) return freeRes;

    // Also allow GET status at root of this worker
    if (path === "" || path === "/" || path.endsWith("/api/free-ai/status")) {
      if (request.method === "GET") {
        const available = {};
        for (const [pid, p] of Object.entries(PROVIDERS)) {
          available[pid] = Boolean(env[p.env]);
        }
        return json({
          ok: true,
          service: "grudge-forge-free-ai",
          providers: available,
          byok: true,
          d1: Boolean(env.DB),
        });
      }
    }

    return json(
      {
        error: "Not found",
        routes: [
          "GET /api/free-ai/status",
          "POST /api/free-ai/chat",
          "GET /api/catalog/fast-assets",
          "GET /api/catalog/status",
          "GET|POST /api/agent/jobs",
          "GET|PATCH /api/agent/jobs/:id",
        ],
      },
      404,
    );
  },
};
