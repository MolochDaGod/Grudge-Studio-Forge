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

import { DEFAULT_GRAVITY, type SceneEntity } from "@workspace/scene-schema";
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
import { autoFixScene } from "./autoFix";
import { bounds, centroid, clusterPoints, nearestNeighborStats } from "./cluster";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

/** Strict cache-only read: returns the cached value if present in React
 *  Query, or `undefined` if the panel that owns this key has not been
 *  opened yet this session. We deliberately do NOT issue a network
 *  fetch here — Task #39 requires introspection to mirror what the
 *  user/editor already has, never to invent fresh state. Callers must
 *  surface `cache-miss` to the AI so it knows to ask the user to open
 *  the panel (or use a non-introspective tool) instead of pretending
 *  the project is empty. */
function readCache<T>(queryKey: QueryKey): T | undefined {
  return queryClient.getQueryData<T>(queryKey);
}

const cachedScripts = (projectId: number) =>
  readCache<Script[]>(getListScriptsQueryKey(projectId));
const cachedScenes = (projectId: number) =>
  readCache<Scene[]>(getListScenesQueryKey(projectId));
const cachedPrefabs = (projectId: number) =>
  readCache<Prefab[]>(getListPrefabsQueryKey(projectId));
const cachedAssets = (projectId: number) =>
  readCache<Asset[]>(getListAssetsQueryKey(projectId));

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
  // Only enable the `script-deleted` rule when we actually have an
  // inventory in the cache. If the Scripts panel has never been opened
  // we leave validScriptIds undefined — flagging every entity as
  // "script deleted" because the cache is cold would be a false alarm.
  let validScriptIds: Set<number> | undefined;
  if (s.projectId) {
    const scripts = cachedScripts(s.projectId);
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

// ── auto_fix_scene ────────────────────────────────────────────────────
const AUTO_FIX_SCENE: ToolDef = {
  name: "auto_fix_scene",
  description:
    "Autonomously repair common diagnose_scene issues: add sun/ground, bump zero-intensity lights, spawn or mark a player (Grudge6 race kit preferred), rewrite toon-shooter/mutant/placeholder model URLs to assets.grudge-studio.com Grudge6 kits. Returns actions[] + remaining issues. Prefer this after diagnose_scene when severity includes errors/warns — then re-diagnose. Does not wipe the scene.",
  input_schema: {
    type: "object",
    properties: {
      deathmatch: {
        type: "boolean",
        description: "Also consider deathmatch-oriented remaining issues after fix.",
      },
      onlyRules: {
        type: "array",
        items: { type: "string" },
        description: "Optional allow-list of diagnose rule ids to fix (e.g. ['no-lights','no-ground']).",
      },
    },
  },
};
const autoFixSceneHandler: ToolHandler = async (input) => {
  const result = autoFixScene({
    deathmatch: input.deathmatch === true,
    onlyRules: Array.isArray(input.onlyRules)
      ? (input.onlyRules as string[]).map(String)
      : undefined,
  });
  return {
    ok: true,
    data: {
      actions: result.actions,
      remaining: result.remaining,
      beforeIssueCount: result.before,
      afterIssueCount: result.after,
      fixedCount: result.actions.length,
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
        gravity: env.gravity ?? DEFAULT_GRAVITY,
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
  const scripts = cachedScripts(s.projectId);
  const scenes = cachedScenes(s.projectId);
  const prefabs = cachedPrefabs(s.projectId);
  const assets = cachedAssets(s.projectId);
  const byName = <T extends { name: string }>(arr: T[]) =>
    [...arr].sort((a, b) => a.name.localeCompare(b.name));
  // Categories not yet in the editor cache (panel never opened) come
  // back as null + recorded in `cacheMisses`, NEVER as empty arrays —
  // empty arrays would mislead the AI into thinking the project has
  // no scripts/scenes/etc.
  const cacheMisses: string[] = [];
  if (!scripts) cacheMisses.push("scripts");
  if (!scenes) cacheMisses.push("scenes");
  if (!prefabs) cacheMisses.push("prefabs");
  if (!assets) cacheMisses.push("assets");
  return {
    ok: true,
    data: {
      projectId: s.projectId,
      activeSceneId: s.sceneId,
      activeSceneName: s.sceneName,
      cacheMisses,
      cacheNote:
        cacheMisses.length > 0
          ? `These categories are not in the editor cache yet (their panels have not been opened this session): ${cacheMisses.join(", ")}. Counts/lists for them are null — ask the user to open the relevant panel rather than assuming empty.`
          : null,
      counts: {
        scripts: scripts ? scripts.length : null,
        scenes: scenes ? scenes.length : null,
        prefabs: prefabs ? prefabs.length : null,
        assets: assets ? assets.length : null,
        entities: s.sceneData.entities.length,
      },
      scripts: scripts
        ? byName(scripts).map((sc) => ({
            id: sc.id,
            name: sc.name,
            language: sc.language,
          }))
        : null,
      scenes: scenes
        ? byName(scenes).map((sc) => ({
            id: sc.id,
            name: sc.name,
            isActive: sc.id === s.sceneId,
          }))
        : null,
      prefabs: prefabs
        ? byName(prefabs).map((p) => ({
            id: p.id,
            name: p.name,
            entityCount: Array.isArray(p.data?.entities)
              ? p.data.entities.length
              : 0,
          }))
        : null,
      assets: assets
        ? byName(assets).map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            source: a.source,
          }))
        : null,
    },
  };
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
  const assets = cachedAssets(s.projectId);
  if (!assets) {
    return {
      ok: false,
      error:
        "Assets are not in the editor cache yet — ask the user to open the Assets panel once, then retry.",
    };
  }
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
  const prefabs = cachedPrefabs(s.projectId);
  if (!prefabs) {
    return {
      ok: false,
      error:
        "Prefabs are not in the editor cache yet — ask the user to open the Prefabs panel once, then retry.",
    };
  }
  return {
    ok: true,
    data: prefabs.map((p) => ({
      id: p.id,
      name: p.name,
      entityCount: Array.isArray(p.data?.entities) ? p.data.entities.length : 0,
      isPlayerPrefab: p.data?.isPlayerPrefab === true,
    })),
  };
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
  const scenes = cachedScenes(s.projectId);
  if (!scenes) {
    return {
      ok: false,
      error:
        "Scenes are not in the editor cache yet — ask the user to open the Scenes panel (or load a scene) once, then retry.",
    };
  }
  return {
    ok: true,
    data: scenes.map((sc) => ({
      id: sc.id,
      name: sc.name,
      updatedAt: sc.updatedAt,
      isActive: sc.id === s.sceneId,
    })),
  };
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

// ── Verification tools (SI scale · textures · anim · terrain · standards) ─
import {
  runFullSceneVerification,
  verifyCharacterAnimation,
  verifyMeshScale,
  verifyTerrainPhysics,
  verifyTextures,
} from "@/lib/ai/sceneVerification";
import { getThreeStandards, type StandardsTopic } from "@/lib/ai/threeStandards";

const VERIFY_MESH_SCALE: ToolDef = {
  name: "verify_mesh_scale",
  description:
    "SI size audit for model/character entities. Flags 100× unit bugs, oversized/undersized heroes, and weapons wrongly fitted to 1.8 m human height. Returns findings[] with metrics in metres. Run before deploy.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        description: "Optional subset; default = all entities.",
      },
      includeOk: { type: "boolean" },
    },
  },
};

const VERIFY_TEXTURES: ToolDef = {
  name: "verify_textures",
  description:
    "Texture/material verification: placeholder hosts (Meshy/capsule/Replit), untrusted CDN, missing character models, material map hints. Prefer assets.grudge-studio.com / builtin:.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: { type: "array", items: { type: "string" } },
    },
  },
};

const VERIFY_CHARACTER_ANIMATION: ToolDef = {
  name: "verify_character_animation",
  description:
    "Character/player readiness: kinematic CCT vs dynamic, capsule hints, missing clips, Mixamo-on-Bip001, placeholder hero meshes. Pair with list_animations / apply_animation / set_physics.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: { type: "array", items: { type: "string" } },
    },
  },
};

const VERIFY_TERRAIN_PHYSICS: ToolDef = {
  name: "verify_terrain_physics",
  description:
    "Terrain + ground readiness for CCT/raycasts: fixed ground bodies, Terrain layer, dynamic-on-terrain mistakes.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const LIST_THREEJS_STANDARDS: ToolDef = {
  name: "list_threejs_standards",
  description:
    "Return condensed Forge/fleet standards for a topic: terrain, textures, rapier, raycast, controller, animation, character, identity, redeploy, or all. Use before building or redeploying.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: [
          "all",
          "terrain",
          "textures",
          "rapier",
          "raycast",
          "controller",
          "animation",
          "character",
          "identity",
          "redeploy",
        ],
      },
    },
  },
};

const VERIFY_SCENE_FULL: ToolDef = {
  name: "verify_scene_full",
  description:
    "Run full verification suite (scale + textures + character anim + terrain) and return summary + findings. Prefer after multi-tool builds before claiming done.",
  input_schema: {
    type: "object",
    properties: {
      includeOk: { type: "boolean" },
    },
  },
};

function filterEntities(entityIds: unknown): SceneEntity[] {
  const all = useEditor.getState().sceneData.entities;
  if (!Array.isArray(entityIds) || entityIds.length === 0) return [...all];
  const set = new Set(entityIds.map(String));
  return all.filter((e) => set.has(e.id));
}

const verifyMeshScaleHandler: ToolHandler = async (input) => {
  const ents = filterEntities(input.entityIds);
  const findings = verifyMeshScale(ents).filter(
    (f) => input.includeOk === true || f.severity !== "ok",
  );
  const errors = findings.filter((f) => f.severity === "error").length;
  return {
    ok: true,
    data: {
      summary:
        errors === 0
          ? `Scale check: no errors (${findings.length} findings).`
          : `Scale check: ${errors} error(s).`,
      findings,
      entityCount: ents.length,
    },
  };
};

const verifyTexturesHandler: ToolHandler = async (input) => {
  const findings = verifyTextures(filterEntities(input.entityIds));
  return {
    ok: true,
    data: {
      summary: `${findings.filter((f) => f.severity === "error").length} texture error(s)`,
      findings,
    },
  };
};

const verifyCharacterAnimationHandler: ToolHandler = async (input) => {
  const findings = verifyCharacterAnimation(filterEntities(input.entityIds));
  return {
    ok: true,
    data: {
      summary: `${findings.length} character/anim finding(s)`,
      findings,
      tip: "list_animations → apply_animation; set_physics kinematicPosition + capsule for CCT.",
    },
  };
};

const verifyTerrainPhysicsHandler: ToolHandler = async () => {
  const findings = verifyTerrainPhysics(useEditor.getState().sceneData.entities);
  return { ok: true, data: { findings, summary: `${findings.length} terrain finding(s)` } };
};

const listThreejsStandardsHandler: ToolHandler = async (input) => {
  const topic = (typeof input.topic === "string" ? input.topic : "all") as StandardsTopic;
  const std = getThreeStandards(topic);
  return { ok: true, data: std };
};

const verifySceneFullHandler: ToolHandler = async (input) => {
  const report = runFullSceneVerification(useEditor.getState().sceneData.entities, {
    includeOk: input.includeOk === true,
  });
  return { ok: report.ok, data: report };
};

// ── Bundled exports ────────────────────────────────────────────────────
export const defs: ToolDef[] = [
  DIAGNOSE_SCENE,
  AUTO_FIX_SCENE,
  VERIFY_MESH_SCALE,
  VERIFY_TEXTURES,
  VERIFY_CHARACTER_ANIMATION,
  VERIFY_TERRAIN_PHYSICS,
  VERIFY_SCENE_FULL,
  LIST_THREEJS_STANDARDS,
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
  auto_fix_scene: autoFixSceneHandler,
  verify_mesh_scale: verifyMeshScaleHandler,
  verify_textures: verifyTexturesHandler,
  verify_character_animation: verifyCharacterAnimationHandler,
  verify_terrain_physics: verifyTerrainPhysicsHandler,
  verify_scene_full: verifySceneFullHandler,
  list_threejs_standards: listThreejsStandardsHandler,
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

/** Mutating tools in this folder (auto_fix_scene). */
export const destructiveToolNames: string[] = ["auto_fix_scene"];
