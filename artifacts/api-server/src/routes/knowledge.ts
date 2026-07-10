/**
 * AI Worker knowledge / research routes.
 *
 * Give the in-browser agent a durable "brain" over:
 *   1. Cloudflare R2  — list project assets, snapshots, templates, maps
 *   2. Cloudflare D1  — optional SQL brain (CF_D1_DATABASE_ID + token)
 *   3. Postgres brain — fallback catalog of forge_* tables when D1 unset
 *   4. GitHub + docs  — search examples for three.js / R3F / Rapier / drei
 *
 * All endpoints are rate-limited and read-mostly. D1 only accepts SELECT
 * (or explicit allowlisted write templates later). Doc fetches are
 * domain-allowlisted to block SSRF.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, projectsTable, scenesTable, assetsTable, scriptsTable, prefabsTable } from "@workspace/db";
import { R2StorageService } from "../lib/r2Storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const storage = new R2StorageService();

// ── Rate limit (shared simple window) ──────────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 40;
const ipHits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = ipHits.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    ipHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 1000) {
    for (const [k, v] of ipHits) {
      if (v.every((t) => now - t > RATE_WINDOW_MS)) ipHits.delete(k);
    }
  }
  return false;
}

function rejectRate(req: Request, res: Response): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded — try again shortly." });
    return true;
  }
  return false;
}

// ── R2 allowlisted prefixes ────────────────────────────────────────
const R2_PREFIX_ALLOW: Record<string, string> = {
  "user-assets": "user-assets/",
  "ai-snapshots": "ai-snapshots/",
  templates: "templates/",
  maps: "maps/",
  "forge-spa": "forge-spa/",
  "cf-ai": "cf-ai/",
  public: "public/",
  builtin: "builtin/",
};

function publicUrlFor(key: string): string {
  const direct = storage.getPublicUrl(key);
  if (direct) return direct;
  return `/api/ai-storage/object/${key}`;
}

/**
 * GET /knowledge/r2/list?prefix=user-assets&path=projectId/&maxKeys=50
 * GET /knowledge/r2/list?prefix=templates
 */
router.get("/knowledge/r2/list", async (req: Request, res: Response) => {
  if (rejectRate(req, res)) return;
  const prefixKey = String(req.query.prefix ?? "user-assets");
  const base = R2_PREFIX_ALLOW[prefixKey];
  if (!base) {
    res.status(400).json({
      error: `Unknown prefix "${prefixKey}"`,
      allowed: Object.keys(R2_PREFIX_ALLOW),
    });
    return;
  }
  const sub = typeof req.query.path === "string" ? req.query.path.replace(/^\/+/, "").replace(/\.\./g, "") : "";
  const fullPrefix = `${base}${sub}`;
  const maxKeys = Math.min(Math.max(Number(req.query.maxKeys) || 50, 1), 200);

  try {
    const items = await storage.listObjects(fullPrefix, { maxKeys });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      prefix: fullPrefix,
      count: items.length,
      items: items.map((it) => ({
        key: it.key,
        url: publicUrlFor(it.key),
        sizeBytes: it.sizeBytes,
        lastModified: it.lastModified,
      })),
    });
  } catch (err) {
    req.log?.error({ err, fullPrefix }, "knowledge R2 list failed");
    res.status(503).json({
      error: "R2 list failed — check CF_ACCOUNT_ID / OBJECT_STORAGE_* env",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── D1 (optional) ──────────────────────────────────────────────────

function d1Configured(): boolean {
  return Boolean(
    process.env.CF_ACCOUNT_ID &&
      (process.env.CF_D1_API_TOKEN || process.env.CF_AI_API_TOKEN || process.env.CF_API_TOKEN) &&
      process.env.CF_D1_DATABASE_ID,
  );
}

function d1Token(): string {
  return (
    process.env.CF_D1_API_TOKEN ||
    process.env.CF_AI_API_TOKEN ||
    process.env.CF_API_TOKEN ||
    ""
  );
}

/** Only SELECT / WITH…SELECT / PRAGMA table_info — never mutating SQL. */
function isSafeSelectSql(sqlText: string): boolean {
  const t = sqlText.trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  if (!t || t.length > 4000) return false;
  if (t.includes(";")) {
    // allow a single trailing semicolon only
    const parts = t.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length !== 1) return false;
  }
  const upper = t.toUpperCase();
  if (!/^\s*(SELECT|WITH|PRAGMA)\b/.test(upper)) return false;
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|REINDEX)\b/.test(upper)) {
    return false;
  }
  return true;
}

/**
 * GET /knowledge/d1/status
 */
router.get("/knowledge/d1/status", (_req, res) => {
  res.json({
    configured: d1Configured(),
    databaseId: process.env.CF_D1_DATABASE_ID ? "(set)" : null,
    accountId: process.env.CF_ACCOUNT_ID ? "(set)" : null,
    hint: d1Configured()
      ? "D1 ready — use POST /knowledge/d1/query with { sql, params? }"
      : "Set CF_ACCOUNT_ID, CF_D1_DATABASE_ID, and CF_D1_API_TOKEN (or CF_AI_API_TOKEN) to enable D1 brain queries.",
  });
});

/**
 * POST /knowledge/d1/query  { sql, params? }
 */
router.post("/knowledge/d1/query", async (req: Request, res: Response) => {
  if (rejectRate(req, res)) return;
  if (!d1Configured()) {
    res.status(503).json({
      error: "D1 not configured",
      hint: "Set CF_D1_DATABASE_ID + CF_D1_API_TOKEN (or CF_AI_API_TOKEN) + CF_ACCOUNT_ID",
      fallback: "Use GET /knowledge/brain/catalog for Postgres project metadata instead.",
    });
    return;
  }
  const sqlText = typeof req.body?.sql === "string" ? req.body.sql : "";
  if (!isSafeSelectSql(sqlText)) {
    res.status(400).json({
      error: "Only single SELECT / WITH / PRAGMA statements are allowed (max 4000 chars).",
    });
    return;
  }
  const params = Array.isArray(req.body?.params) ? req.body.params.slice(0, 32) : [];
  const accountId = process.env.CF_ACCOUNT_ID!;
  const dbId = process.env.CF_D1_DATABASE_ID!;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${d1Token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: sqlText, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await r.json()) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result?: unknown;
    };
    if (!r.ok || data.success === false) {
      res.status(r.ok ? 400 : r.status).json({
        error: data.errors?.[0]?.message ?? `D1 query failed (${r.status})`,
        raw: data,
      });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, result: data.result });
  } catch (err) {
    logger.error({ err }, "D1 query failed");
    res.status(502).json({
      error: "D1 request failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── Postgres brain catalog (always available when DB is migrated) ──

/**
 * GET /knowledge/brain/catalog
 * Lightweight inventory the AI can use as long-term memory when D1 is off.
 */
router.get("/knowledge/brain/catalog", async (req: Request, res: Response) => {
  if (rejectRate(req, res)) return;
  try {
    const [projects, sceneCount, assetCount, scriptCount, prefabCount] = await Promise.all([
      db
        .select({
          id: projectsTable.id,
          name: projectsTable.name,
          description: projectsTable.description,
          updatedAt: projectsTable.updatedAt,
        })
        .from(projectsTable)
        .orderBy(projectsTable.updatedAt)
        .limit(50),
      db.select({ c: sql<number>`count(*)::int` }).from(scenesTable),
      db.select({ c: sql<number>`count(*)::int` }).from(assetsTable),
      db.select({ c: sql<number>`count(*)::int` }).from(scriptsTable),
      db.select({ c: sql<number>`count(*)::int` }).from(prefabsTable),
    ]);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      backend: "postgres",
      d1Configured: d1Configured(),
      totals: {
        projects: projects.length,
        scenes: sceneCount[0]?.c ?? 0,
        assets: assetCount[0]?.c ?? 0,
        scripts: scriptCount[0]?.c ?? 0,
        prefabs: prefabCount[0]?.c ?? 0,
      },
      recentProjects: projects.map(
        (p: {
          id: number;
          name: string;
          description: string | null;
          updatedAt: Date | string | null;
        }) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          updatedAt:
            p.updatedAt instanceof Date
              ? p.updatedAt.toISOString()
              : p.updatedAt,
        }),
      ),
    });
  } catch (err) {
    req.log?.error({ err }, "brain catalog failed");
    res.status(503).json({
      error: "Brain catalog unavailable (DB not migrated or down)",
      detail: err instanceof Error ? err.message : String(err),
      d1Configured: d1Configured(),
    });
  }
});

// ── GitHub search ──────────────────────────────────────────────────

const GITHUB_DEFAULT_LANG = "TypeScript";

/** Curated topic shortcuts → richer GitHub queries. */
const TOPIC_QUERIES: Record<string, string> = {
  threejs: "three.js OR threejs language:JavaScript OR language:TypeScript",
  "three.js": "three.js OR threejs",
  r3f: "react-three-fiber OR @react-three/fiber",
  rapier: "rapier @react-three/rapier OR rapier-js OR @dimforge/rapier3d",
  drei: "@react-three/drei",
  "react-three-fiber": "react-three-fiber OR @react-three/fiber",
  gltf: "GLTFLoader three.js",
  physics: "rapier OR cannon-es three.js physics",
  character: "rapier character controller OR kinematic character three",
  navmesh: "recast-navigation OR navmesh three.js",
};

/**
 * GET /knowledge/search/github?q=rapier character controller&topic=rapier&per_page=5
 *
 * Uses unauthenticated GitHub Search API (10 req/min) or GITHUB_TOKEN when set.
 */
router.get("/knowledge/search/github", async (req: Request, res: Response) => {
  if (rejectRate(req, res)) return;
  const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const topic = typeof req.query.topic === "string" ? req.query.topic.toLowerCase() : "";
  const type = req.query.type === "repositories" ? "repositories" : "code";
  const perPage = Math.min(Math.max(Number(req.query.per_page) || 5, 1), 10);

  let q = qRaw;
  if (topic && TOPIC_QUERIES[topic]) {
    q = q ? `${q} ${TOPIC_QUERIES[topic]}` : TOPIC_QUERIES[topic];
  }
  if (!q) {
    res.status(400).json({
      error: "Missing q or topic",
      topics: Object.keys(TOPIC_QUERIES),
      example: "/api/knowledge/search/github?topic=r3f&q=useFrame instanced mesh",
    });
    return;
  }

  // Nudge quality for code search
  if (type === "code" && !/\blanguage:/.test(q)) {
    q = `${q} language:${GITHUB_DEFAULT_LANG}`;
  }

  const endpoint =
    type === "repositories"
      ? `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${perPage}&sort=stars`
      : `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Grudge-Studio-Forge-AI-Worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const r = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      res.status(r.status === 403 || r.status === 429 ? 429 : 502).json({
        error: `GitHub search failed (${r.status})`,
        detail: body.slice(0, 400),
        hint:
          r.status === 403 || r.status === 429
            ? "Set GITHUB_TOKEN on the API server for higher rate limits."
            : undefined,
      });
      return;
    }
    const data = (await r.json()) as {
      total_count?: number;
      items?: Array<Record<string, unknown>>;
    };
    const items = (data.items ?? []).map((it) => {
      if (type === "repositories") {
        return {
          name: it.full_name,
          description: it.description,
          url: it.html_url,
          stars: it.stargazers_count,
          language: it.language,
          topics: it.topics,
        };
      }
      const repo = it.repository as { full_name?: string; html_url?: string } | undefined;
      return {
        path: it.path,
        name: it.name,
        url: it.html_url,
        repo: repo?.full_name,
        repoUrl: repo?.html_url,
      };
    });
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json({
      q,
      type,
      total_count: data.total_count ?? items.length,
      items,
    });
  } catch (err) {
    res.status(502).json({
      error: "GitHub search request failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── Docs search / fetch ────────────────────────────────────────────

const DOC_ALLOWLIST: Array<{ host: string; label: string }> = [
  { host: "threejs.org", label: "three.js" },
  { host: "docs.pmnd.rs", label: "pmndrs (R3F / drei / rapier)" },
  { host: "r3f.docs.pmnd.rs", label: "R3F docs" },
  { host: "rapier.rs", label: "Rapier physics" },
  { host: "dimforge.com", label: "Dimforge / Rapier" },
  { host: "github.com", label: "GitHub" },
  { host: "raw.githubusercontent.com", label: "GitHub raw" },
  { host: "developer.mozilla.org", label: "MDN" },
  { host: "www.w3.org", label: "W3C" },
  { host: "cdn.jsdelivr.net", label: "jsDelivr" },
  { host: "unpkg.com", label: "unpkg" },
  { host: "assets.grudge-studio.com", label: "Grudge R2 CDN" },
  { host: "forge.grudge-studio.com", label: "Forge" },
];

function isAllowedDocUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return DOC_ALLOWLIST.some(
      (d) => u.hostname === d.host || u.hostname.endsWith(`.${d.host}`),
    );
  } catch {
    return false;
  }
}

/** Curated doc entry points the AI can open without guessing URLs. */
const DOC_INDEX: Array<{
  id: string;
  title: string;
  url: string;
  tags: string[];
  blurb: string;
}> = [
  {
    id: "three-manual",
    title: "three.js Manual",
    url: "https://threejs.org/manual/",
    tags: ["threejs", "fundamentals"],
    blurb: "Official three.js learning manual (fundamentals, loaders, materials).",
  },
  {
    id: "three-docs",
    title: "three.js API docs",
    url: "https://threejs.org/docs/",
    tags: ["threejs", "api"],
    blurb: "Full Object3D / Geometry / Material / Renderer API reference.",
  },
  {
    id: "three-examples",
    title: "three.js examples",
    url: "https://threejs.org/examples/",
    tags: ["threejs", "examples"],
    blurb: "Live demos for loaders, postprocessing, physics hooks, etc.",
  },
  {
    id: "r3f-docs",
    title: "React Three Fiber docs",
    url: "https://r3f.docs.pmnd.rs/getting-started/introduction",
    tags: ["r3f", "react"],
    blurb: "R3F canvas, hooks (useFrame, useThree), events, performance.",
  },
  {
    id: "drei",
    title: "drei helpers",
    url: "https://drei.docs.pmnd.rs/getting-started/introduction",
    tags: ["drei", "r3f"],
    blurb: "Ready-made R3F helpers: OrbitControls, Html, Environment, Instances.",
  },
  {
    id: "rapier-js",
    title: "Rapier JavaScript guide",
    url: "https://rapier.rs/docs/user_guides/javascript/getting_started_js",
    tags: ["rapier", "physics"],
    blurb: "Rapier 3D JS/WASM rigid bodies, colliders, joints, character controller.",
  },
  {
    id: "r3f-rapier",
    title: "@react-three/rapier",
    url: "https://github.com/pmndrs/react-three-rapier",
    tags: ["rapier", "r3f"],
    blurb: "R3F bindings for Rapier — Physics, RigidBody, CuboidCollider.",
  },
  {
    id: "r3f-rapier-docs",
    title: "react-three-rapier API",
    url: "https://pmndrs.github.io/react-three-rapier/",
    tags: ["rapier", "r3f", "api"],
    blurb: "Component API for Physics world, sensors, joints, instanced bodies.",
  },
  {
    id: "three-gltf",
    title: "GLTFLoader",
    url: "https://threejs.org/docs/#examples/en/loaders/GLTFLoader",
    tags: ["threejs", "gltf", "assets"],
    blurb: "Load .glb/.gltf models, animations, Draco compression.",
  },
  {
    id: "forge-skill-rapier",
    title: "Forge Rapier patterns (repo skill)",
    url: "https://github.com/molochdagod/Grudge-Studio-Forge",
    tags: ["forge", "rapier"],
    blurb: "Grudge Studio Forge monorepo — editor + AI tools + Rapier layer matrix.",
  },
];

/**
 * GET /knowledge/docs/index?tag=rapier
 */
router.get("/knowledge/docs/index", (req: Request, res: Response) => {
  const tag = typeof req.query.tag === "string" ? req.query.tag.toLowerCase() : "";
  const q = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";
  let items = DOC_INDEX;
  if (tag) items = items.filter((d) => d.tags.includes(tag) || d.id.includes(tag));
  if (q) {
    items = items.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.blurb.toLowerCase().includes(q) ||
        d.tags.some((t) => t.includes(q)),
    );
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({ count: items.length, items, allowlist: DOC_ALLOWLIST.map((d) => d.host) });
});

/**
 * GET /knowledge/docs/fetch?url=https://threejs.org/docs/...
 * Returns truncated plain text for the AI to read.
 */
router.get("/knowledge/docs/fetch", async (req: Request, res: Response) => {
  if (rejectRate(req, res)) return;
  const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!url || !isAllowedDocUrl(url)) {
    res.status(400).json({
      error: "URL missing or host not allowlisted",
      allowlist: DOC_ALLOWLIST.map((d) => d.host),
    });
    return;
  }
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Grudge-Studio-Forge-AI-Worker/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      res.status(502).json({ error: `Upstream ${r.status} for ${url}` });
      return;
    }
    const ct = r.headers.get("content-type") ?? "";
    const raw = await r.text();
    let text = raw;
    if (ct.includes("html")) {
      text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
    }
    const max = 12_000;
    const truncated = text.length > max;
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      url,
      contentType: ct,
      truncated,
      length: text.length,
      text: truncated ? text.slice(0, max) + "\n…[truncated]" : text,
    });
  } catch (err) {
    res.status(502).json({
      error: "Doc fetch failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /knowledge/status — combined brain health for the AI panel.
 */
router.get("/knowledge/status", (_req, res) => {
  res.json({
    r2: {
      accountId: Boolean(process.env.CF_ACCOUNT_ID),
      bucket: process.env.R2_BUCKET_ASSETS || process.env.OBJECT_STORAGE_BUCKET || null,
      publicUrl: Boolean(process.env.OBJECT_STORAGE_PUBLIC_URL || process.env.OBJECT_STORAGE_PUBLIC_R2_URL),
    },
    d1: {
      configured: d1Configured(),
    },
    github: {
      token: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
    },
    docs: {
      indexSize: DOC_INDEX.length,
      allowlistHosts: DOC_ALLOWLIST.map((d) => d.host),
    },
  });
});

export default router;
