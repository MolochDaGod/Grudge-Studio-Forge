/**
 * Knowledge / research tools for the AI Worker "brain".
 *
 * Backed by api-server `/api/knowledge/*` routes:
 *   - R2 list (project assets, snapshots, templates, maps)
 *   - D1 SQL (optional Cloudflare D1) + Postgres catalog fallback
 *   - GitHub code/repo search (three.js, R3F, Rapier examples)
 *   - Curated docs index + allowlisted page fetch
 *
 * Shape matches every other `ai/tools/*` folder so `aiTools.ts` can
 * spread `defs` + `handlers` in uniformly.
 */
import { useEditor } from "@/store/editor";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

async function getJson(path: string): Promise<ToolResult> {
  try {
    const res = await fetch(apiUrl(path), { signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error:
          (body as { error?: string }).error ??
          (body as { detail?: string }).detail ??
          `HTTP ${res.status}`,
        data: body,
      };
    }
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function postJson(path: string, body: unknown): Promise<ToolResult> {
  try {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error:
          (data as { error?: string }).error ??
          (data as { detail?: string }).detail ??
          `HTTP ${res.status}`,
        data,
      };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── list_r2_storage ────────────────────────────────────────────────

const LIST_R2: ToolDef = {
  name: "list_r2_storage",
  description:
    "List objects in Grudge Studio Cloudflare R2. Use to find project user-assets, AI snapshots, " +
    "built-in scene templates, uploaded maps, CF AI generated textures, or forge-spa files. " +
    "Prefixes: user-assets | ai-snapshots | templates | maps | forge-spa | cf-ai | public | builtin. " +
    "For project-scoped assets pass path = '<projectId>/' (auto-filled from open project when omitted for user-assets).",
  input_schema: {
    type: "object",
    properties: {
      prefix: {
        type: "string",
        enum: [
          "user-assets",
          "ai-snapshots",
          "templates",
          "maps",
          "forge-spa",
          "cf-ai",
          "public",
          "builtin",
        ],
        description: "Top-level R2 namespace. Defaults to user-assets.",
      },
      path: {
        type: "string",
        description:
          "Optional sub-path under the prefix, e.g. project id or '20260528.1/'. No '..'.",
      },
      maxKeys: {
        type: "number",
        description: "Max objects to return (1–200, default 50).",
      },
    },
    additionalProperties: false,
  },
};

const listR2Handler: ToolHandler = async (input) => {
  const prefix =
    typeof input.prefix === "string" && input.prefix ? input.prefix : "user-assets";
  let path = typeof input.path === "string" ? input.path : "";
  if (
    !path &&
    (prefix === "user-assets" || prefix === "ai-snapshots")
  ) {
    const projectId = useEditor.getState().projectId;
    if (projectId) path = `${projectId}/`;
  }
  const maxKeys =
    typeof input.maxKeys === "number" && Number.isFinite(input.maxKeys)
      ? input.maxKeys
      : 50;
  const qs = new URLSearchParams({
    prefix,
    maxKeys: String(maxKeys),
  });
  if (path) qs.set("path", path);
  return getJson(`knowledge/r2/list?${qs.toString()}`);
};

// ── get_brain_catalog ──────────────────────────────────────────────

const BRAIN_CATALOG: ToolDef = {
  name: "get_brain_catalog",
  description:
    "Read the Forge long-term memory catalog: recent projects, totals for scenes/assets/scripts/prefabs " +
    "from the server DB (Postgres), plus whether Cloudflare D1 is configured. Call this when you need " +
    "project-wide orientation beyond the live editor scene, or before D1 queries.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const brainCatalogHandler: ToolHandler = async () => getJson("knowledge/brain/catalog");

// ── query_d1 ───────────────────────────────────────────────────────

const QUERY_D1: ToolDef = {
  name: "query_d1",
  description:
    "Run a read-only SQL query against Cloudflare D1 (SELECT / WITH / PRAGMA only). " +
    "Use for custom brain tables, analytics, or lore stored in D1. " +
    "If D1 is not configured the tool returns a structured error — fall back to get_brain_catalog " +
    "and list_r2_storage. Always start with PRAGMA table_list or SELECT name FROM sqlite_master if schema is unknown.",
  input_schema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "Single SELECT/WITH/PRAGMA statement (no multi-statement, no writes).",
      },
      params: {
        type: "array",
        items: {},
        description: "Optional bound parameters for ? placeholders.",
      },
    },
    required: ["sql"],
    additionalProperties: false,
  },
};

const queryD1Handler: ToolHandler = async (input) => {
  const sqlText = typeof input.sql === "string" ? input.sql.trim() : "";
  if (!sqlText) return { ok: false, error: "sql is required." };
  return postJson("knowledge/d1/query", {
    sql: sqlText,
    params: Array.isArray(input.params) ? input.params : [],
  });
};

// ── d1_status ──────────────────────────────────────────────────────

const D1_STATUS: ToolDef = {
  name: "d1_status",
  description:
    "Check whether Cloudflare D1 brain is configured on the API server. " +
    "Call before query_d1 if unsure.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const d1StatusHandler: ToolHandler = async () => getJson("knowledge/d1/status");

// ── search_github ──────────────────────────────────────────────────

const SEARCH_GITHUB: ToolDef = {
  name: "search_github",
  description:
    "Search GitHub for code or repositories — three.js, React Three Fiber (R3F), Rapier physics, " +
    "drei, GLTF loaders, character controllers, navmesh examples. " +
    "Use topic shortcuts: threejs | r3f | rapier | drei | gltf | physics | character | navmesh. " +
    "After finding a useful path, optionally fetch_doc_url on the html_url or raw.githubusercontent.com file. " +
    "Then apply patterns via create_script / add_entity tools — do not paste huge third-party repos wholesale.",
  input_schema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Free-text search, e.g. 'useFrame instanced mesh' or 'KinematicCharacterController'.",
      },
      topic: {
        type: "string",
        enum: [
          "threejs",
          "three.js",
          "r3f",
          "rapier",
          "drei",
          "react-three-fiber",
          "gltf",
          "physics",
          "character",
          "navmesh",
        ],
        description: "Optional curated topic boost.",
      },
      type: {
        type: "string",
        enum: ["code", "repositories"],
        description: "Search code (default) or repositories.",
      },
      per_page: {
        type: "number",
        description: "Results to return (1–10, default 5).",
      },
    },
    additionalProperties: false,
  },
};

const searchGithubHandler: ToolHandler = async (input) => {
  const qs = new URLSearchParams();
  if (typeof input.q === "string" && input.q.trim()) qs.set("q", input.q.trim());
  if (typeof input.topic === "string" && input.topic) qs.set("topic", input.topic);
  if (input.type === "repositories" || input.type === "code") qs.set("type", String(input.type));
  if (typeof input.per_page === "number") qs.set("per_page", String(input.per_page));
  if (![...qs.keys()].some((k) => k === "q" || k === "topic")) {
    return {
      ok: false,
      error: "Provide q and/or topic (e.g. topic='rapier', q='character controller').",
    };
  }
  return getJson(`knowledge/search/github?${qs.toString()}`);
};

// ── list_docs ──────────────────────────────────────────────────────

const LIST_DOCS: ToolDef = {
  name: "list_docs",
  description:
    "List curated documentation entry points for three.js, R3F, drei, Rapier, and Forge. " +
    "Filter with tag (threejs|r3f|rapier|drei|gltf|forge) or free-text q. " +
    "Pick a url then call fetch_doc_url to read the page text into context.",
  input_schema: {
    type: "object",
    properties: {
      tag: { type: "string", description: "Filter tag, e.g. rapier, r3f, threejs." },
      q: { type: "string", description: "Free-text filter on title/blurb/tags." },
    },
    additionalProperties: false,
  },
};

const listDocsHandler: ToolHandler = async (input) => {
  const qs = new URLSearchParams();
  if (typeof input.tag === "string" && input.tag) qs.set("tag", input.tag);
  if (typeof input.q === "string" && input.q) qs.set("q", input.q);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return getJson(`knowledge/docs/index${suffix}`);
};

// ── fetch_doc_url ──────────────────────────────────────────────────

const FETCH_DOC: ToolDef = {
  name: "fetch_doc_url",
  description:
    "Fetch and extract text from an allowlisted documentation or example URL " +
    "(threejs.org, docs.pmnd.rs, rapier.rs, github.com, raw.githubusercontent.com, MDN, Grudge CDN). " +
    "Use after list_docs or search_github. Returns up to ~12k chars of stripped text. " +
    "Apply the idea with editor tools — never dump long code into chat alone.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "https URL on an allowlisted host.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
};

const fetchDocHandler: ToolHandler = async (input) => {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) return { ok: false, error: "url is required." };
  return getJson(`knowledge/docs/fetch?url=${encodeURIComponent(url)}`);
};

// ── knowledge_status ───────────────────────────────────────────────

const KNOWLEDGE_STATUS: ToolDef = {
  name: "knowledge_status",
  description:
    "Health check for the AI brain backends: R2 credentials, D1 config, GitHub token, docs index size. " +
    "Call when research tools fail or at session start if storage seems broken.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const knowledgeStatusHandler: ToolHandler = async () => getJson("knowledge/status");

// ── exports ────────────────────────────────────────────────────────

export const defs: ToolDef[] = [
  LIST_R2,
  BRAIN_CATALOG,
  QUERY_D1,
  D1_STATUS,
  SEARCH_GITHUB,
  LIST_DOCS,
  FETCH_DOC,
  KNOWLEDGE_STATUS,
];

export const handlers: Record<string, ToolHandler> = {
  list_r2_storage: listR2Handler,
  get_brain_catalog: brainCatalogHandler,
  query_d1: queryD1Handler,
  d1_status: d1StatusHandler,
  search_github: searchGithubHandler,
  list_docs: listDocsHandler,
  fetch_doc_url: fetchDocHandler,
  knowledge_status: knowledgeStatusHandler,
};

/** Knowledge tools are read-only — none are destructive. */
export const destructiveToolNames: string[] = [];
