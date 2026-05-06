/**
 * AI introspection tools — give the model deeper visibility into the
 * editor without changing anything: scene diagnostics, project listings,
 * recent history, runtime errors, and spatial layout.
 *
 * All tools here are read-only by design. They follow the
 * `{ defs, handlers }` shape so `aiTools.ts` can spread them in with a
 * single import — keeping merge surface minimal between this task and
 * the parallel ones.
 *
 * Project-data lookups (scripts, scenes, prefabs, assets) read through
 * the React Query cache used by the editor panels. We use
 * `queryClient.fetchQuery(...)` so a cached value (the panels are
 * usually mounted) is returned synchronously without a refetch — and
 * if the panel was never opened we transparently warm the cache with
 * one fetch instead of bypassing the store entirely.
 */

import {
  getListAssetsQueryKey,
  getListPrefabsQueryKey,
  getListScenesQueryKey,
  getListScriptsQueryKey,
  listAssets,
  listPrefabs,
  listScenes,
  listScripts,
  type Asset,
  type Prefab,
  type Scene,
  type Script,
} from "@workspace/api-client-react";
import type { QueryKey } from "@tanstack/react-query";
import { useEditor } from "@/store/editor";
import { queryClient } from "@/lib/queryClient";
import {
  getRecentAiCalls,
  type AiAuditEntry,
} from "@/ai/aiAuditLog";
import { collectModelUrls, diagnoseScene, summarizeBySeverity, type Issue } from "./diagnose";
import { bounds, centroid, clusterPoints, nearestNeighborStats } from "./cluster";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

/** Read project data through the editor's existing React Query cache.
 *  Returns the cached value immediately when present; otherwise fires a
 *  single fetch and caches the result so subsequent panels reuse it.
 *  Either way we go through the same store the UI uses — no duplicate
 *  state to drift out of sync. */
async function readFromCache<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
): Promise<T> {
  const cached = queryClient.getQueryData<T>(queryKey);
  if (cached !== undefined) return cached;
  return queryClient.fetchQuery<T>({ queryKey, queryFn });
}

const loadScripts = (projectId: number) =>
  readFromCache<Script[]>(getListScriptsQueryKey(projectId), () =>
    listScripts(projectId),
  );
const loadScenes = (projectId: number) =>
  readFromCache<Scene[]>(getListScenesQueryKey(projectId), () =>
    listScenes(projectId),
  );
const loadPrefabs = (projectId: number) =>
  readFromCache<Prefab[]>(getListPrefabsQueryKey(projectId), () =>
    listPrefabs(projectId),
  );
const loadAssets = (projectId: number) =>
  readFromCache<Asset[]>(getListAssetsQueryKey(projectId), () =>
    listAssets(projectId),
  );

// ── diagnose_scene ─────────────────────────────────────────────────────
const DIAGNOSE_SCENE: ToolDef = {
  name: "diagnose_scene",
  description:
    "Lint the current scene for common authoring mistakes (no lights, zero-intensity lights, no ground, missing camera target, orphan parents, dynamic body without a collider, NaN/zero collider extents, multiple controllers, scripts pointing at deleted ids, missing spawnpoint with a player, deathmatch tagging, …). Returns an `issues[]` list with severity, rule id, message, and a fix hint. Optionally HEAD-checks remote model URLs for reachability when checkUrls:true (capped at 8 unique URLs, 1.5s each).",
  input_schema: {
    type: "object",
    properties: {
      deathmatch: {
        type: "boolean",
        description:
          "When true, also flag missing deathmatch behaviors (gamemode, spawnpoints, enemies).",
      },
      checkUrls: {
        type: "boolean",
        description:
          "When true, HEAD-request up to 8 unique model URLs and report any unreachable ones (rule: model-url-unreachable).",
      },
    },
  },
};
const diagnoseSceneHandler: ToolHandler = async (input) => {
  const s = useEditor.getState();
  let validScriptIds: Set<number> | undefined;
  if (s.projectId) {
    // Only enable the `script-deleted` rule when we actually have an
    // inventory — a load failure must NOT be treated as "all scripts
    // are deleted" (would flag every entity).
    const scripts = await loadScripts(s.projectId).catch(
      () => null as Script[] | null,
    );
    if (scripts) validScriptIds = new Set(scripts.map((sc) => sc.id));
  }
  const issues: Issue[] = diagnoseScene({
    entities: s.sceneData.entities,
    environment: s.sceneData.environment,
    deathmatch: input.deathmatch === true,
    validScriptIds,
  });
  if (input.checkUrls === true) {
    const urls = collectModelUrls(s.sceneData.entities, 8);
    const broken: string[] = [];
    await Promise.all(
      urls.map(async ({ id, url }) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1500);
        try {
          const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
          if (!res.ok) broken.push(id);
        } catch {
          broken.push(id);
        } finally {
          clearTimeout(t);
        }
      }),
    );
    if (broken.length > 0) {
      issues.push({
        rule: "model-url-unreachable",
        severity: "error",
        message: `${broken.length} model entities reference a URL that returned an error or timed out.`,
        entityIds: broken,
        hint: "Re-upload the asset, or update model.url to a reachable file.",
      });
    }
  }
  return {
    ok: true,
    data: {
      counts: summarizeBySeverity(issues),
      issues,
    },
  };
};

// ── get_active_scene_meta ──────────────────────────────────────────────
const GET_ACTIVE_SCENE_META: ToolDef = {
  name: "get_active_scene_meta",
  description:
    "Return identity + status of whatever the user is currently editing: projectId, sceneId, sceneName, prefab sub-scene info (if any), isPlaying/isPaused, isDirty, selectedId, environment summary, and entity counts. Cheap, read-only — call this any time you want to confirm context before mutating.",
  input_schema: { type: "object", properties: {} },
};
const getActiveSceneMetaHandler: ToolHandler = async () => {
  const s = useEditor.getState();
  const counts: Record<string, number> = {};
  for (const e of s.sceneData.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const env = s.sceneData.environment;
  return {
    ok: true,
    data: {
      projectId: s.projectId,
      sceneId: s.sceneId,
      sceneName: s.sceneName,
      isDirty: s.isDirty,
      isPlaying: s.isPlaying,
      isPaused: s.isPaused,
      selectedId: s.selectedId,
      transformMode: s.transformMode,
      prefabSubScene: s.prefabSubScene
        ? {
            prefabId: s.prefabSubScene.prefabId,
            prefabName: s.prefabSubScene.prefabName,
          }
        : null,
      entityCount: s.sceneData.entities.length,
      entitiesByType: counts,
      environment: {
        cameraMode: env.cameraMode ?? "editor",
        cameraTargetEntityId: env.cameraTargetEntityId ?? null,
        gravity: env.gravity ?? [0, -9.81, 0],
        skyColor: env.skyColor ?? null,
      },
    },
  };
};

// ── get_project_summary ────────────────────────────────────────────────
const GET_PROJECT_SUMMARY: ToolDef = {
  name: "get_project_summary",
  description:
    "High-level overview of the open project pulled from the editor's cache: counts AND name+id of every script, scene, prefab, and asset. Use this once at the start of a conversation to know what's already in the project before re-creating things. Names are sorted alphabetically per category for stable AI scanning.",
  input_schema: { type: "object", properties: {} },
};
const getProjectSummaryHandler: ToolHandler = async () => {
  const s = useEditor.getState();
  if (!s.projectId) return { ok: false, error: "No project open." };
  try {
    const [scripts, scenes, prefabs, assets] = await Promise.all([
      loadScripts(s.projectId).catch(() => [] as Script[]),
      loadScenes(s.projectId).catch(() => [] as Scene[]),
      loadPrefabs(s.projectId).catch(() => [] as Prefab[]),
      loadAssets(s.projectId).catch(() => [] as Asset[]),
    ]);
    const byName = <T extends { name: string }>(arr: T[]) =>
      [...arr].sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      data: {
        projectId: s.projectId,
        activeSceneId: s.sceneId,
        activeSceneName: s.sceneName,
        counts: {
          scripts: scripts.length,
          scenes: scenes.length,
          prefabs: prefabs.length,
          assets: assets.length,
          entities: s.sceneData.entities.length,
        },
        scripts: byName(scripts).map((sc) => ({
          id: sc.id,
          name: sc.name,
          language: sc.language,
        })),
        scenes: byName(scenes).map((sc) => ({
          id: sc.id,
          name: sc.name,
          isActive: sc.id === s.sceneId,
        })),
        prefabs: byName(prefabs).map((p) => ({
          id: p.id,
          name: p.name,
          entityCount: Array.isArray(p.data?.entities) ? p.data.entities.length : 0,
        })),
        assets: byName(assets).map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          source: a.source,
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── list_assets ────────────────────────────────────────────────────────
const LIST_ASSETS: ToolDef = {
  name: "list_assets",
  description:
    "List all assets registered against the current project (id, name, type, source, url). Reads from the editor's asset-browser cache — no extra fetch when the panel has been opened. Useful before importing a new asset to avoid duplicates.",
  input_schema: { type: "object", properties: {} },
};
const listAssetsHandler: ToolHandler = async () => {
  const s = useEditor.getState();
  if (!s.projectId) return { ok: false, error: "No project open." };
  try {
    const assets = await loadAssets(s.projectId);
    return {
      ok: true,
      data: assets.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        source: a.source,
        url: a.url,
      })),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── list_prefabs ───────────────────────────────────────────────────────
const LIST_PREFABS: ToolDef = {
  name: "list_prefabs",
  description:
    "List all reusable Prefabs in the current project (id, name, entityCount, isPlayerPrefab). Reads from the prefabs-panel cache. Pair with the prefab spawn tools or open a prefab via the editor UI.",
  input_schema: { type: "object", properties: {} },
};
const listPrefabsHandler: ToolHandler = async () => {
  const s = useEditor.getState();
  if (!s.projectId) return { ok: false, error: "No project open." };
  try {
    const prefabs = await loadPrefabs(s.projectId);
    return {
      ok: true,
      data: prefabs.map((p) => ({
        id: p.id,
        name: p.name,
        entityCount: Array.isArray(p.data?.entities) ? p.data.entities.length : 0,
        isPlayerPrefab: p.data?.isPlayerPrefab === true,
      })),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── list_scenes ────────────────────────────────────────────────────────
const LIST_SCENES: ToolDef = {
  name: "list_scenes",
  description:
    "List all scenes belonging to the current project (id, name, updatedAt, isActive). Reads from the scene-list cache. Use this to recall an old scene name before suggesting a load.",
  input_schema: { type: "object", properties: {} },
};
const listScenesHandler: ToolHandler = async () => {
  const s = useEditor.getState();
  if (!s.projectId) return { ok: false, error: "No project open." };
  try {
    const scenes = await loadScenes(s.projectId);
    return {
      ok: true,
      data: scenes.map((sc) => ({
        id: sc.id,
        name: sc.name,
        updatedAt: sc.updatedAt,
        isActive: sc.id === s.sceneId,
      })),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── get_recent_history ─────────────────────────────────────────────────
const GET_RECENT_HISTORY: ToolDef = {
  name: "get_recent_history",
  description:
    "Return the editor's undo/redo stack labels (most recent first). This shows what the user — or you — last did to the scene, drawn from the same history Ctrl+Z walks. Pair with get_last_ai_changes when you need to know which entries came from the AI specifically.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20." },
    },
  },
};
const getRecentHistoryHandler: ToolHandler = async (input) => {
  const limit = Math.min(Math.max(1, Number(input.limit ?? 20)), 100);
  const stack = useEditor.getState().commandStack;
  return {
    ok: true,
    data: {
      canUndo: stack.canUndo(),
      canRedo: stack.canRedo(),
      undo: stack.getUndoEntries(limit),
      redo: stack.getRedoEntries(limit),
    },
  };
};

// ── get_last_ai_changes ────────────────────────────────────────────────
const GET_LAST_AI_CHANGES: ToolDef = {
  name: "get_last_ai_changes",
  description:
    "Return the last AI tool calls this session (newest first). By default only mutating tools are included so you can quickly see 'what did I just change?'. Set changesOnly:false to include introspection calls too. Each entry has timestamp, tool name, input, result, and inferred affected entity ids.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 10." },
      changesOnly: {
        type: "boolean",
        description: "Default true. Set false to include read-only/introspection calls.",
      },
    },
  },
};
const getLastAiChangesHandler: ToolHandler = async (input) => {
  const limit = Math.min(Math.max(1, Number(input.limit ?? 10)), 50);
  const changesOnly = input.changesOnly !== false;
  const entries = getRecentAiCalls({ limit, changesOnly });
  return {
    ok: true,
    data: {
      count: entries.length,
      entries: entries.map((e: AiAuditEntry) => ({
        ts: e.ts,
        name: e.name,
        error: e.error,
        affectedEntityIds: e.affectedEntityIds,
        input: e.input,
        result: e.result,
      })),
    },
  };
};

// ── get_console_errors ─────────────────────────────────────────────────
const GET_CONSOLE_ERRORS: ToolDef = {
  name: "get_console_errors",
  description:
    "Read the editor's bottom-panel console: uncaught script errors, physics warnings, asset-load failures, and AI-generated logs. Defaults to errors+warnings only and the last 30 entries. Use this when the user says 'it's broken' / 'nothing happens' / 'it crashed' — these messages usually identify the failing script or asset.",
  input_schema: {
    type: "object",
    properties: {
      level: {
        type: "string",
        enum: ["error", "warn", "info", "all"],
        description: "Filter floor (error<warn<info<all). Default 'warn'.",
      },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 30." },
    },
  },
};
const getConsoleErrorsHandler: ToolHandler = async (input) => {
  const level = (typeof input.level === "string" ? input.level : "warn") as
    | "error"
    | "warn"
    | "info"
    | "all";
  const limit = Math.min(Math.max(1, Number(input.limit ?? 30)), 200);
  const all = useEditor.getState().consoleMessages;
  const allow: Record<string, Set<string>> = {
    error: new Set(["error"]),
    warn: new Set(["error", "warn"]),
    info: new Set(["error", "warn", "info"]),
    all: new Set(["error", "warn", "info"]),
  };
  const allowed = allow[level] ?? allow.warn;
  const filtered = all.filter((m) => allowed.has(m.level));
  const tail = filtered.slice(-limit);
  return {
    ok: true,
    data: {
      total: filtered.length,
      returned: tail.length,
      messages: tail.map((m) => ({
        id: m.id,
        level: m.level,
        text: m.text,
        ts: m.ts,
      })),
    },
  };
};

// ── describe_layout ────────────────────────────────────────────────────
const DESCRIBE_LAYOUT: ToolDef = {
  name: "describe_layout",
  description:
    "Summarize the spatial layout of the scene: AABB, dominant axis, density, global centroid, nearest-neighbor stats (closest pair + loneliest entity), and k-means clusters of entity positions (auto-K via elbow heuristic, max 6). Use before adding new content so you can place it where it actually fits — e.g. 'put a tower in the empty NE corner'. Filter by entity type to cluster only specific kinds (e.g. just 'enemy' models).",
  input_schema: {
    type: "object",
    properties: {
      type: {
        description:
          "Optional entity type filter (one of: box, sphere, cylinder, plane, light, camera, model, empty), or array of types. Defaults to all non-light, non-camera entities (the visible scene geometry).",
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
      },
      maxClusters: {
        type: "integer",
        minimum: 1,
        maximum: 6,
        description: "Upper bound for K (default 4).",
      },
    },
  },
};
const describeLayoutHandler: ToolHandler = async (input) => {
  const ents = useEditor.getState().sceneData.entities;
  const typeFilter: string[] | null = Array.isArray(input.type)
    ? (input.type as string[])
    : typeof input.type === "string"
      ? [input.type]
      : null;
  const filterFn = typeFilter
    ? (t: string) => typeFilter.includes(t)
    : (t: string) => t !== "light" && t !== "camera" && t !== "empty";
  const points = ents
    .filter((e) => filterFn(e.type))
    .map((e) => ({
      id: e.id,
      x: e.transform.position[0],
      y: e.transform.position[1],
      z: e.transform.position[2],
    }));
  if (points.length === 0) {
    return {
      ok: true,
      data: {
        sampleSize: 0,
        bounds: bounds([]),
        centroid: { x: 0, y: 0, z: 0 },
        nearestNeighbor: nearestNeighborStats([]),
        clusters: [],
        note: "No entities match the filter.",
      },
    };
  }
  const aabb = bounds(points);
  const span = {
    x: aabb.max.x - aabb.min.x,
    y: aabb.max.y - aabb.min.y,
    z: aabb.max.z - aabb.min.z,
  };
  const dominantAxis: "x" | "y" | "z" =
    span.x >= span.y && span.x >= span.z ? "x" : span.y >= span.z ? "y" : "z";
  const c = centroid(points);
  const nn = nearestNeighborStats(points);
  const { clusters, k } = clusterPoints(points, {
    maxK: Math.min(6, Math.max(1, Number(input.maxClusters ?? 4))),
  });
  const volume = Math.max(1, span.x) * Math.max(1, span.z);
  return {
    ok: true,
    data: {
      sampleSize: points.length,
      bounds: aabb,
      span,
      dominantAxis,
      centroid: roundXYZ(c),
      nearestNeighbor: nn,
      densityPerXZUnit: round(points.length / volume, 4),
      k,
      clusters,
    },
  };
};

function round(n: number, digits = 2): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
function roundXYZ(p: { x: number; y: number; z: number }) {
  return { x: round(p.x), y: round(p.y), z: round(p.z) };
}

// ── Bundled exports ────────────────────────────────────────────────────
export const defs: ToolDef[] = [
  DIAGNOSE_SCENE,
  GET_ACTIVE_SCENE_META,
  GET_PROJECT_SUMMARY,
  LIST_ASSETS,
  LIST_PREFABS,
  LIST_SCENES,
  GET_RECENT_HISTORY,
  GET_LAST_AI_CHANGES,
  GET_CONSOLE_ERRORS,
  DESCRIBE_LAYOUT,
];

export const handlers: Record<string, ToolHandler> = {
  diagnose_scene: diagnoseSceneHandler,
  get_active_scene_meta: getActiveSceneMetaHandler,
  get_project_summary: getProjectSummaryHandler,
  list_assets: listAssetsHandler,
  list_prefabs: listPrefabsHandler,
  list_scenes: listScenesHandler,
  get_recent_history: getRecentHistoryHandler,
  get_last_ai_changes: getLastAiChangesHandler,
  get_console_errors: getConsoleErrorsHandler,
  describe_layout: describeLayoutHandler,
};
