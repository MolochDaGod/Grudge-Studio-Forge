/**
 * grudge-forge-free-ai — free OpenAI-compatible proxy + agent/catalog edge API.
 *
 * Routes (also same-origin under forge.grudge-studio.com when CF routes match):
 *   GET  /api/free-ai/status
 *   POST /api/free-ai/chat?provider=
 *   GET  /api/catalog/status
 *   GET  /api/catalog/fast-assets
 *   GET  /api/catalog/search?q=&category=&prefix=&format=&limit=
 *   GET  /api/catalog/gamedata?kind=weapons|equipment|materials&q=&limit=
 *   GET  /api/agent/jobs
 *   POST /api/agent/jobs
 *   GET  /api/agent/jobs/:id
 *   PATCH /api/agent/jobs/:id
 *
 * Data plane (do not confuse):
 *   D1 env.DB (forge-agent) — agent job rows only
 *   Fleet D1 asset_registry — via public api.grudge-studio.com/assets (read)
 *   R2 binaries — assets.grudge-studio.com (never invent paths)
 *   ObjectStore gamedata — weapons/equipment/materials JSON (icons via spritePath)
 *   Player bag/XP — Railway Postgres (not this worker)
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

/** Fleet public asset index (D1-backed). Max page size observed: 500. */
const FLEET_ASSETS_API = "https://api.grudge-studio.com/assets";
const OBJECTSTORE_API = "https://objectstore.grudge-studio.com/api/v1";
const CDN_ORIGIN = "https://assets.grudge-studio.com";

/**
 * Always-on curated entries (verified CDN keys). Returned first so agents
 * never invent grudge6 / weapon paths even if fleet search is cold.
 * Do not add un-verified paths here.
 */
const CANONICAL_FLEET = [
  {
    name: "WK Characters (human)",
    category: "characters",
    r2Key: "models/grudge6/races/WK_Characters.fbx",
    format: "fbx",
    kind: "character",
  },
  {
    name: "BRB Characters (barbarian)",
    category: "characters",
    r2Key: "models/grudge6/races/BRB_Characters.fbx",
    format: "fbx",
    kind: "character",
  },
  {
    name: "ELF Characters",
    category: "characters",
    r2Key: "models/grudge6/races/ELF_Characters.fbx",
    format: "fbx",
    kind: "character",
  },
  {
    name: "DWF Characters (dwarf)",
    category: "characters",
    r2Key: "models/grudge6/races/DWF_Characters.fbx",
    format: "fbx",
    kind: "character",
  },
  {
    name: "ORC Characters",
    category: "characters",
    r2Key: "models/grudge6/races/ORC_Characters.fbx",
    format: "fbx",
    kind: "character",
  },
  {
    name: "UD Characters (undead)",
    category: "characters",
    r2Key: "models/grudge6/races/UD_Characters.fbx",
    format: "fbx",
    kind: "character",
  },
  {
    name: "WK sword A",
    category: "weapons",
    r2Key: "models/grudge6/races/library/human/WK_weapon_sword_A.glb",
    format: "glb",
    kind: "weapon",
  },
  {
    name: "ELF bow",
    category: "weapons",
    r2Key: "models/grudge6/races/library/elf/ELF_weapon_bow.glb",
    format: "glb",
    kind: "weapon",
  },
  {
    name: "ORC axe A",
    category: "weapons",
    r2Key: "models/grudge6/races/library/orc/ORC_weapon_Axe_A.glb",
    format: "glb",
    kind: "weapon",
  },
  {
    name: "DWF axe A",
    category: "weapons",
    r2Key: "models/grudge6/races/library/dwarf/DWF_Weapon_axe_A.glb",
    format: "glb",
    kind: "weapon",
  },
  {
    name: "BRB hammer A",
    category: "weapons",
    r2Key: "models/grudge6/races/library/barbarian/BRB_weapon_hammer_A.glb",
    format: "glb",
    kind: "weapon",
  },
  {
    name: "UD sword A",
    category: "weapons",
    r2Key: "models/grudge6/races/library/undead/UD_weapon_Sword_A.glb",
    format: "glb",
    kind: "weapon",
  },
  {
    name: "Pirate Islands lobby",
    category: "maps",
    r2Key: "models/lobby/pirate-islands/scene.glb",
    format: "glb",
    kind: "map",
  },
  {
    name: "Nature vegetation pack",
    category: "nature",
    r2Key: "models/nature/stylized/biome/nature_vegetation.glb",
    format: "glb",
    kind: "nature",
  },
  {
    name: "Ore nodes pack",
    category: "nature",
    r2Key: "models/nature/stylized/harvest/ore_nodes.glb",
    format: "glb",
    kind: "nature",
  },
].map((row) => ({
  ...row,
  id: row.r2Key,
  cdnUrl: `${CDN_ORIGIN}/${row.r2Key}`,
  grudgeUuid: null,
  source: "canonical",
}));

/** Module-level TTL cache for fleet registry pages (not request-scoped secrets). */
let fleetIndexCache = null;
let fleetIndexAt = 0;
const FLEET_INDEX_TTL_MS = 10 * 60 * 1000;

function normalizeFleetRow(a) {
  const r2Key = String(a.r2Key || a.id || "").replace(/^\//, "");
  if (!r2Key) return null;
  let cdnUrl = a.cdnUrl || `${CDN_ORIGIN}/${r2Key}`;
  try {
    const u = new URL(cdnUrl);
    if (u.hostname !== "assets.grudge-studio.com") {
      // Force durable CDN host — never proxy random hosts into scenes
      cdnUrl = `${CDN_ORIGIN}/${r2Key}`;
    }
  } catch {
    cdnUrl = `${CDN_ORIGIN}/${r2Key}`;
  }
  const format =
    a.format ||
    (r2Key.endsWith(".glb")
      ? "glb"
      : r2Key.endsWith(".gltf")
        ? "gltf"
        : r2Key.endsWith(".fbx")
          ? "fbx"
          : r2Key.match(/\.(png|webp|jpg|jpeg)$/i)
            ? "image"
            : null);
  return {
    id: a.id || r2Key,
    name: a.name || r2Key.split("/").pop() || r2Key,
    category: a.category || "unknown",
    r2Key,
    cdnUrl,
    grudgeUuid: a.grudgeUuid || null,
    fileSize: a.fileSize || null,
    format,
    source: "fleet-d1",
  };
}

/**
 * Load compact fleet asset index (paginated). Cap pages so cold start stays bounded.
 * Fleet API currently ignores q/category — filter happens in this Worker.
 */
async function loadFleetIndex(env) {
  if (fleetIndexCache && Date.now() - fleetIndexAt < FLEET_INDEX_TTL_MS) {
    return fleetIndexCache;
  }
  const pageSize = 500;
  const maxPages = Number(env.FLEET_INDEX_MAX_PAGES) || 18; // ~9k rows
  const base = (env.FLEET_ASSETS_API || FLEET_ASSETS_API).replace(/\/$/, "");
  const pages = [];
  for (let p = 0; p < maxPages; p++) {
    pages.push(
      fetch(`${base}?limit=${pageSize}&offset=${p * pageSize}`, {
        cf: { cacheTtl: 600, cacheEverything: true },
        headers: { Accept: "application/json" },
      })
        .then(async (r) => {
          if (!r.ok) return [];
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("text/html")) return [];
          const data = await r.json();
          return Array.isArray(data?.assets) ? data.assets : [];
        })
        .catch(() => []),
    );
  }
  const chunks = await Promise.all(pages);
  const byKey = new Map();
  for (const chunk of chunks) {
    for (const raw of chunk) {
      const row = normalizeFleetRow(raw);
      if (row) byKey.set(row.r2Key, row);
    }
  }
  // Merge canonical so verified keys always exist even if registry lags
  for (const c of CANONICAL_FLEET) {
    if (!byKey.has(c.r2Key)) byKey.set(c.r2Key, c);
  }
  const items = [...byKey.values()];
  fleetIndexCache = {
    items,
    count: items.length,
    fetchedAt: new Date().toISOString(),
  };
  fleetIndexAt = Date.now();
  return fleetIndexCache;
}

function matchFleetQuery(row, q, category, prefix, format) {
  if (category) {
    const c = category.toLowerCase();
    const rc = (row.category || "").toLowerCase();
    const rk = (row.r2Key || "").toLowerCase();
    // soft category: match registry category OR path segment heuristics
    const catHit =
      rc === c ||
      rc.includes(c) ||
      (c === "characters" &&
        (rk.includes("/characters") ||
          rk.includes("grudge6/races") ||
          rk.includes("/races/"))) ||
      (c === "weapons" && (rk.includes("weapon") || rk.includes("/library/"))) ||
      (c === "icons" && (rk.includes("/icons/") || row.format === "image")) ||
      (c === "maps" && (rk.includes("/lobby/") || rk.includes("/maps/"))) ||
      (c === "nature" && rk.includes("/nature/"));
    if (!catHit) return false;
  }
  if (prefix) {
    const p = prefix.replace(/^\//, "").toLowerCase();
    if (!(row.r2Key || "").toLowerCase().startsWith(p)) return false;
  }
  if (format) {
    const f = format.toLowerCase();
    if ((row.format || "").toLowerCase() !== f) return false;
  }
  if (q) {
    const needle = q.toLowerCase();
    const hay = `${row.name} ${row.r2Key} ${row.category} ${row.id}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

async function searchFleetAssets(env, url) {
  const q = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const prefix = (url.searchParams.get("prefix") || "").trim();
  const format = (url.searchParams.get("format") || "").trim();
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "40", 10) || 40, 1),
    100,
  );

  // Prefer canonical hits first (always correct paths)
  const canonicalHits = CANONICAL_FLEET.filter((row) =>
    matchFleetQuery(row, q, category, prefix, format),
  );

  let fleetHits = [];
  let indexMeta = { count: 0, fetchedAt: null, error: null };
  try {
    const index = await loadFleetIndex(env);
    indexMeta = { count: index.count, fetchedAt: index.fetchedAt, error: null };
    const seen = new Set(canonicalHits.map((r) => r.r2Key));
    for (const row of index.items) {
      if (seen.has(row.r2Key)) continue;
      if (!matchFleetQuery(row, q, category, prefix, format)) continue;
      // Prefer mesh/icon over raw animation dumps when no format specified
      if (!format && row.category === "animation" && !q) continue;
      fleetHits.push(row);
      if (canonicalHits.length + fleetHits.length >= limit * 3) break;
    }
  } catch (err) {
    indexMeta.error = err?.message || String(err);
  }

  const items = [...canonicalHits, ...fleetHits].slice(0, limit).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    r2Key: row.r2Key,
    cdnUrl: row.cdnUrl,
    grudgeUuid: row.grudgeUuid,
    format: row.format,
    fileSize: row.fileSize ?? null,
    source: row.source,
  }));

  return {
    ok: true,
    count: items.length,
    limit,
    q: q || null,
    category: category || null,
    prefix: prefix || null,
    format: format || null,
    fleetIndex: indexMeta,
    policy: {
      assets: "cdnUrl must be assets.grudge-studio.com — use with add_model_entity / import",
      playData: "Railway Postgres (not catalog)",
      agentJobs: "D1 forge-agent only",
    },
    items,
  };
}

/** ObjectStore gamedata cache (weapons/equipment/materials). */
const gamedataCache = new Map();
const GAMEDATA_TTL_MS = 15 * 60 * 1000;

function flattenGamedata(kind, raw) {
  const items = [];
  if (!raw || typeof raw !== "object") return items;

  if (Array.isArray(raw)) {
    for (const it of raw) {
      if (it && typeof it === "object") items.push(normalizeGameItem(kind, it, null));
    }
    return items.filter(Boolean);
  }

  // weapons.json shape: { categories: { swords: { iconBase, items: [...] } } }
  const cats = raw.categories;
  if (cats && typeof cats === "object") {
    for (const [catKey, catVal] of Object.entries(cats)) {
      const list = Array.isArray(catVal?.items)
        ? catVal.items
        : Array.isArray(catVal)
          ? catVal
          : [];
      for (const it of list) {
        items.push(
          normalizeGameItem(kind, it, {
            categoryKey: catKey,
            iconBase: catVal?.iconBase,
          }),
        );
      }
    }
    return items.filter(Boolean);
  }

  // equipment / materials sometimes use top-level arrays under keys
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === "object" && (it.id || it.name)) {
          items.push(normalizeGameItem(kind, it, { categoryKey: k }));
        }
      }
    }
  }
  return items.filter(Boolean);
}

function normalizeGameItem(kind, it, meta) {
  if (!it || typeof it !== "object") return null;
  const id = String(it.id || it.name || "").trim();
  if (!id) return null;
  const sprite =
    it.spritePath ||
    it.icon ||
    it.iconPath ||
    it.cdnIcon ||
    null;
  let iconUrl = null;
  if (typeof sprite === "string" && sprite.length > 0) {
    if (sprite.startsWith("http")) iconUrl = sprite;
    else iconUrl = `${CDN_ORIGIN}${sprite.startsWith("/") ? "" : "/"}${sprite}`;
  }
  // Prefer mesh model if present (some ObjectStore packs include model/r2Key)
  let modelUrl = null;
  const model =
    it.model ||
    it.modelUrl ||
    it.mesh ||
    it.glb ||
    it.r2Key ||
    null;
  if (typeof model === "string" && model.length > 0) {
    if (model.startsWith("http")) modelUrl = model;
    else if (model.startsWith("builtin:")) modelUrl = model;
    else modelUrl = `${CDN_ORIGIN}/${model.replace(/^\//, "")}`;
  }
  return {
    id,
    name: String(it.name || id),
    kind,
    category: it.category || meta?.categoryKey || null,
    iconUrl,
    spritePath: typeof sprite === "string" ? sprite : null,
    modelUrl,
    grudgeType: it.grudgeType || null,
    lore: typeof it.lore === "string" ? it.lore.slice(0, 200) : null,
    // stats stay light for AI tool payload
    primaryStat: it.primaryStat || null,
  };
}

async function loadGamedata(kind, env) {
  const allowed = new Set(["weapons", "equipment", "materials", "armor", "races"]);
  if (!allowed.has(kind)) {
    return { error: `Unknown kind '${kind}'`, known: [...allowed] };
  }
  const hit = gamedataCache.get(kind);
  if (hit && Date.now() - hit.at < GAMEDATA_TTL_MS) return hit;

  const base = (env.OBJECTSTORE_API || OBJECTSTORE_API).replace(/\/$/, "");
  const url = `${base}/${kind}.json`;
  try {
    const r = await fetch(url, {
      cf: { cacheTtl: 900, cacheEverything: true },
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      return { error: `ObjectStore ${kind} HTTP ${r.status}`, items: [] };
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) {
      return { error: "ObjectStore returned HTML", items: [] };
    }
    const raw = await r.json();
    const items = flattenGamedata(kind, raw);
    const payload = {
      kind,
      count: items.length,
      items,
      source: url,
      at: Date.now(),
    };
    gamedataCache.set(kind, payload);
    return payload;
  } catch (err) {
    return { error: err?.message || String(err), items: [] };
  }
}

async function handleGamedata(env, url) {
  const kind = (url.searchParams.get("kind") || "weapons").toLowerCase();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "40", 10) || 40, 1),
    100,
  );
  const data = await loadGamedata(kind, env);
  if (data.error && !(data.items && data.items.length)) {
    return json(
      {
        ok: false,
        error: data.error,
        kind,
        known: data.known,
        hint: "Gamedata is ObjectStore JSON (stats/icons), not R2 meshes. Use catalog/search for GLB/FBX.",
      },
      502,
    );
  }
  let items = data.items || [];
  if (q) {
    items = items.filter((it) => {
      const hay = `${it.id} ${it.name} ${it.category || ""} ${it.lore || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  items = items.slice(0, limit);
  return json({
    ok: true,
    kind,
    count: items.length,
    totalIndexed: data.count || items.length,
    q: q || null,
    source: data.source || null,
    policy: {
      icons: "iconUrl → assets.grudge-studio.com + spritePath (may 404 until R2 icon pack seeded)",
      meshes: "Use catalog/search or Fast weapons (grudge6 library) for 3D models",
      playData: "Railway inventory, not this JSON",
    },
    items,
  });
}

async function handleCatalog(path, env, url) {
  if (isCatalogPath(path, "status")) {
    const fastAssets = await loadFastCatalog(env);
    let fleetCount = fleetIndexCache?.count ?? null;
    return json({
      ok: true,
      service: "grudge-forge-free-ai",
      d1: Boolean(env.DB),
      fastAssetCount: fastAssets.count || (fastAssets.items || []).length,
      fleetIndexCount: fleetCount,
      stack: [
        "cloudflare-workers",
        "r2-assets.grudge-studio.com",
        env.DB ? "d1-agent-jobs" : "memory-agent-jobs",
        "fleet-d1-asset-search",
        "objectstore-gamedata",
        "free-ai-byok",
        "vercel-spa",
      ],
      policy: {
        assets: "builtin: keys + https://assets.grudge-studio.com only",
        playData: "Railway Postgres (not this worker)",
        binaries: "R2",
        agentJobs: "D1 forge-agent only",
        gamedata: "ObjectStore weapons/equipment/materials",
      },
      routes: {
        search: "/api/catalog/search?q=&category=&prefix=&format=&limit=",
        gamedata: "/api/catalog/gamedata?kind=weapons|equipment|materials&q=",
        fast: "/api/catalog/fast-assets",
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
  if (isCatalogPath(path, "search")) {
    const result = await searchFleetAssets(env, url);
    return json(result);
  }
  if (isCatalogPath(path, "gamedata")) {
    return handleGamedata(env, url);
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

    const catalogRes = await handleCatalog(path, env, url);
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
          "GET /api/catalog/search?q=&category=&prefix=&format=",
          "GET /api/catalog/gamedata?kind=weapons|equipment|materials",
          "GET /api/catalog/status",
          "GET|POST /api/agent/jobs",
          "GET|PATCH /api/agent/jobs/:id",
        ],
      },
      404,
    );
  },
};
