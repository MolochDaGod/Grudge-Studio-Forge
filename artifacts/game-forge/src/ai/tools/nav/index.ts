/**
 * Navigation tools for the AI Worker.
 *
 * Surfaces the navmesh / surface / nav-agent stack to the assistant
 * so it can reshape pathfinding without the user opening the
 * Inspector:
 *
 *   - `list_surfaces`            — read-only enumeration + per-area defaults
 *   - `set_surface`              — lockstep surface + layer set (DESTRUCTIVE)
 *   - `set_nav_agent`            — install / clear nav-agent component (DESTRUCTIVE)
 *   - `bake_navmesh`             — kick a Recast bake (DESTRUCTIVE — reseats `Environment.navmeshAssetId`)
 *   - `find_path`                — read-only path query (returns waypoints)
 *   - `list_navmesh_stats`       — read-only summary of the current bake
 *
 * Conventions match `ai/tools/layers/` and `ai/tools/scripting/`:
 * every tool routes mutations through the CommandStack via the
 * matching `cmd*` action on the editor store, and the folder exports
 * the canonical `{ defs, handlers, destructiveToolNames }` triple
 * `lib/aiTools.ts` spreads in.
 */
import { useEditor } from "@/store/editor";
import {
  SURFACES,
  surfaceToAreaId,
  surfaceToLayer,
  layerToSurface,
  DEFAULT_NAV_AGENT,
  type SurfaceKind,
  type NavAgentComponent,
} from "@workspace/scene-schema";
import { loadNavmesh, findPath, sampleNavmesh } from "@/lib/navmesh";
import { bakeSceneNavmesh, ensureNavmeshBlob, getCachedBlob } from "@/lib/navmeshBake";
import { type BuildHullsOptions, type HullFillMode } from "@/lib/colliderBaker";
import { bakeEntityConvexHulls } from "@/lib/bakeEntityColliders";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const isSurface = (v: unknown): v is SurfaceKind =>
  typeof v === "string" && (SURFACES as readonly string[]).includes(v);

const asVec3 = (v: unknown): [number, number, number] | null => {
  if (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return [v[0] as number, v[1] as number, v[2] as number];
  }
  return null;
};

// ── list_surfaces ────────────────────────────────────────────────────
const LIST_SURFACES: ToolDef = {
  name: "list_surfaces",
  description:
    "List the fixed multi-area surface registry (Walk / Climb / Swim / Jump / Dig / None). Returns each surface name, its Recast area id (1-5; 0 = unwalkable), and the lockstep physics layer the editor pins when the surface is assigned (Walk/Jump/Climb/Dig → Terrain, Swim → Water, None → no override).",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};
const listSurfacesHandler: ToolHandler = async () => ({
  ok: true,
  data: {
    surfaces: SURFACES.map((s) => ({
      name: s,
      areaId: surfaceToAreaId(s),
      lockstepLayer: surfaceToLayer(s) ?? null,
      defaultFrom: layerToSurface(undefined),
    })),
  },
});

// ── set_surface ──────────────────────────────────────────────────────
const SET_SURFACE: ToolDef = {
  name: "set_surface",
  description:
    "Tag one or more entities with a surface kind in a single batched, undoable step. Atomic: also pins the lockstep physics layer (Walk/Jump/Climb/Dig → Terrain, Swim → Water) and updates the userData chain so spatial queries + the agent state machine see the change on the next frame. DESTRUCTIVE.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Entity ids to tag. Use this for batched calls.",
      },
      // Back-compat: a single `entityId` is still accepted as sugar
      // for `entityIds: [<id>]` so older system-prompt examples
      // keep working.
      entityId: { type: "string" },
      surface: { type: "string", enum: [...SURFACES] },
    },
    required: ["surface"],
    additionalProperties: false,
  },
};
const setSurfaceHandler: ToolHandler = async (input) => {
  const ids: string[] = Array.isArray(input.entityIds)
    ? (input.entityIds.filter((v) => typeof v === "string") as string[])
    : typeof input.entityId === "string"
      ? [input.entityId]
      : [];
  if (ids.length === 0)
    return { ok: false, error: "entityIds (or entityId) is required" };
  if (!isSurface(input.surface))
    return {
      ok: false,
      error: `surface must be one of: ${SURFACES.join(", ")}`,
    };
  const state = useEditor.getState();
  const before = ids.map((id) => {
    const ent = state.sceneData.entities.find((e) => e.id === id);
    return { entityId: id, surface: ent?.surface ?? null, layer: ent?.layer ?? null };
  });
  const missing = before.filter((b) => {
    return !state.sceneData.entities.some((e) => e.id === b.entityId);
  });
  if (missing.length === ids.length)
    return { ok: false, error: `no entities found: ${ids.join(", ")}` };
  useEditor.getState().cmdSetEntitySurface(ids, input.surface);
  const after = useEditor.getState();
  const now = ids.map((id) => {
    const ent = after.sceneData.entities.find((e) => e.id === id);
    return { entityId: id, surface: ent?.surface ?? null, layer: ent?.layer ?? null };
  });
  return {
    ok: true,
    data: {
      entityIds: ids,
      previous: before,
      now,
      skipped: missing.map((m) => m.entityId),
    },
  };
};

// ── set_nav_agent ────────────────────────────────────────────────────
const SET_NAV_AGENT: ToolDef = {
  name: "set_nav_agent",
  description:
    "Install or remove the nav-agent component on one or more entities in a batched, undoable step. Pass `agent:null` to clear. Defaults applied for missing fields (filter=['Walk','Jump'], speed=4, radius=0.4, height=1.8). At play-time the runtime spins up one XState machine per nav-agent (idle/patrol/chase/climb/swim/stuck/dead). DESTRUCTIVE.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
      // Back-compat sugar; see set_surface.
      entityId: { type: "string" },
      agent: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            properties: {
              filter: {
                type: "array",
                items: { type: "string", enum: [...SURFACES] },
              },
              speed: { type: "number" },
              radius: { type: "number" },
              height: { type: "number" },
              acceleration: { type: "number" },
              turnSpeed: { type: "number" },
            },
            additionalProperties: false,
          },
        ],
      },
    },
    additionalProperties: false,
  },
};
const setNavAgentHandler: ToolHandler = async (input) => {
  const ids: string[] = Array.isArray(input.entityIds)
    ? (input.entityIds.filter((v) => typeof v === "string") as string[])
    : typeof input.entityId === "string"
      ? [input.entityId]
      : [];
  if (ids.length === 0)
    return { ok: false, error: "entityIds (or entityId) is required" };
  let agent: NavAgentComponent | null = null;
  if (input.agent && typeof input.agent === "object") {
    const a = input.agent as Partial<NavAgentComponent>;
    agent = {
      filter: Array.isArray(a.filter)
        ? (a.filter.filter(isSurface) as SurfaceKind[])
        : DEFAULT_NAV_AGENT.filter,
      speed: typeof a.speed === "number" ? a.speed : DEFAULT_NAV_AGENT.speed,
      radius:
        typeof a.radius === "number" ? a.radius : DEFAULT_NAV_AGENT.radius,
      height:
        typeof a.height === "number" ? a.height : DEFAULT_NAV_AGENT.height,
      acceleration:
        typeof a.acceleration === "number"
          ? a.acceleration
          : DEFAULT_NAV_AGENT.acceleration,
      turnSpeed:
        typeof a.turnSpeed === "number"
          ? a.turnSpeed
          : DEFAULT_NAV_AGENT.turnSpeed,
    };
  }
  const state = useEditor.getState();
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    if (state.sceneData.entities.some((e) => e.id === id)) {
      applied.push(id);
    } else {
      skipped.push(id);
    }
  }
  if (applied.length === 0)
    return { ok: false, error: `no entities found: ${ids.join(", ")}` };
  // Single batched, undoable step — N entities collapse into one
  // CommandStack entry rather than N undo-able edits.
  state.cmdSetEntityNavAgents(applied, agent);
  return { ok: true, data: { entityIds: applied, agent, skipped } };
};

// ── move_agent_to ────────────────────────────────────────────────────
// Push a destination onto the window-level pending-move queue. The
// Viewport drains this queue every frame in play mode and forwards the
// destination to the matching agent's FSM as a `moveTo` event. Edit-
// time calls are queued harmlessly until play starts.
const MOVE_AGENT_TO: ToolDef = {
  name: "move_agent_to",
  description:
    "Send a nav-agent entity to a world-space target. Pass either `target:[x,y,z]` or `targetEntityId` (the live position is resolved at consume time). Runtime-only, non-undoable: the destination is queued and applied to the agent FSM during the next play-mode frame.",
  input_schema: {
    type: "object",
    properties: {
      entityId: { type: "string" },
      target: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
      },
      targetEntityId: { type: "string" },
    },
    required: ["entityId"],
    additionalProperties: false,
  },
};
const moveAgentToHandler: ToolHandler = async (input) => {
  const id = typeof input.entityId === "string" ? input.entityId : "";
  if (!id) return { ok: false, error: "entityId is required" };
  const state = useEditor.getState();
  if (!state.sceneData.entities.some((e) => e.id === id))
    return { ok: false, error: `entity not found: ${id}` };
  let target: [number, number, number] | { entityId: string };
  if (
    Array.isArray(input.target) &&
    input.target.length === 3 &&
    input.target.every((n) => typeof n === "number")
  ) {
    target = input.target as [number, number, number];
  } else if (typeof input.targetEntityId === "string") {
    target = { entityId: input.targetEntityId };
  } else {
    return { ok: false, error: "target or targetEntityId is required" };
  }
  const w = window as unknown as {
    __pendingAgentMoves?: Map<string, [number, number, number] | { entityId: string }>;
  };
  w.__pendingAgentMoves ??= new Map();
  w.__pendingAgentMoves.set(id, target);
  return { ok: true, data: { entityId: id, target } };
};

// ── bake_navmesh ─────────────────────────────────────────────────────
const BAKE_NAVMESH: ToolDef = {
  name: "bake_navmesh",
  description:
    "Bake a Recast navmesh from every entity in the scene whose `surface` is not `None`. Returns the bake stats (poly count, byte size, duration). Only call after the user has tagged at least one walkable mesh — when no surfaces are tagged the bake returns ok:false with a clear error. DESTRUCTIVE — reseats `Environment.navmeshAssetId` and the change goes through CommandStack.",
  input_schema: {
    type: "object",
    properties: {
      agentRadius: { type: "number" },
      agentHeight: { type: "number" },
      agentMaxClimb: { type: "number" },
      agentMaxSlope: { type: "number" },
      cs: { type: "number" },
      ch: { type: "number" },
    },
    additionalProperties: false,
  },
};
const bakeNavmeshHandler: ToolHandler = async (input) => {
  try {
    const result = await bakeSceneNavmesh(
      input as Record<string, never>,
    );
    return {
      ok: true,
      data: {
        assetId: result.assetId,
        serverBlobId: result.serverBlobId,
        cached: result.cached,
        ...result.stats,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// ── find_path ────────────────────────────────────────────────────────
const FIND_PATH: ToolDef = {
  name: "find_path",
  description:
    "Compute a corridor of waypoints between two world positions over the currently baked navmesh. Pass `areaFilter` (subset of Walk/Jump/Climb/Swim/Dig) to restrict pathfinding to specific Recast areas (e.g. swim-only AI, no-water enemies). Returns the waypoint array (`null` when off-mesh or no path). Read-only.",
  input_schema: {
    type: "object",
    properties: {
      start: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      end: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      areaFilter: {
        type: "array",
        items: { type: "string", enum: [...SURFACES] },
        description:
          "Optional whitelist of surfaces the path is allowed to cross. Empty / omitted ⇒ all walkable areas allowed.",
      },
    },
    required: ["start", "end"],
    additionalProperties: false,
  },
};
const findPathHandler: ToolHandler = async (input) => {
  const start = asVec3(input.start);
  const end = asVec3(input.end);
  if (!start || !end)
    return { ok: false, error: "start and end must be [x,y,z] number triples" };
  const state = useEditor.getState();
  const env = state.sceneData.environment;
  const id = env.navmeshAssetId;
  if (!id)
    return {
      ok: false,
      error: "no baked navmesh — call bake_navmesh first",
    };
  const blob = await ensureNavmeshBlob(id, env.navmeshBlobKey, state.projectId);
  if (!blob)
    return {
      ok: false,
      error: "navmesh asset id is set but the blob could not be loaded — re-bake",
    };
  const areaFilter: SurfaceKind[] | undefined = Array.isArray(input.areaFilter)
    ? (input.areaFilter.filter(isSurface) as SurfaceKind[])
    : undefined;
  const loaded = await loadNavmesh(blob, id);
  const path = findPath(loaded, start, end, { areaFilter });
  return {
    ok: true,
    data: { path, waypointCount: path?.length ?? 0, areaFilter: areaFilter ?? null },
  };
};

// ── list_navmesh_stats ───────────────────────────────────────────────
const LIST_NAVMESH_STATS: ToolDef = {
  name: "list_navmesh_stats",
  description:
    "Summarize the current scene's navmesh: whether one is baked, the asset id, the poly count snapshot when it was baked, and the per-surface entity counts that would feed a re-bake. Read-only.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};
const listNavmeshStatsHandler: ToolHandler = async () => {
  const state = useEditor.getState();
  const env = state.sceneData.environment;
  const counts: Record<SurfaceKind, number> = {
    Walk: 0,
    Jump: 0,
    Climb: 0,
    Swim: 0,
    Dig: 0,
    None: 0,
  };
  for (const e of state.sceneData.entities) {
    counts[e.surface ?? "None"] += 1;
  }
  const id = env.navmeshAssetId;
  let bytes: number | null = null;
  if (id !== undefined) {
    const blob =
      getCachedBlob(id) ??
      (await ensureNavmeshBlob(id, env.navmeshBlobKey, state.projectId));
    bytes = blob ? blob.byteLength : null;
  }
  return {
    ok: true,
    data: {
      navmeshAssetId: id ?? null,
      bytes,
      counts,
      walkableEntities: state.sceneData.entities
        .filter((e) => e.surface && e.surface !== "None")
        .map((e) => ({ id: e.id, name: e.name, surface: e.surface })),
    },
  };
};

// ── sample_navmesh ───────────────────────────────────────────────────
const SAMPLE_NAVMESH: ToolDef = {
  name: "sample_navmesh",
  description:
    "Snap a world position onto the nearest walkable poly. Returns `{ point, areaId }`, or `null` when no poly within a 2-unit horizontal / 4-unit vertical extent is found. Read-only.",
  input_schema: {
    type: "object",
    properties: {
      position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
    },
    required: ["position"],
    additionalProperties: false,
  },
};
const sampleNavmeshHandler: ToolHandler = async (input) => {
  const pos = asVec3(input.position);
  if (!pos)
    return { ok: false, error: "position must be a [x,y,z] number triple" };
  const state = useEditor.getState();
  const env = state.sceneData.environment;
  const id = env.navmeshAssetId;
  if (!id)
    return { ok: false, error: "no baked navmesh — call bake_navmesh first" };
  const blob = await ensureNavmeshBlob(id, env.navmeshBlobKey, state.projectId);
  if (!blob)
    return { ok: false, error: "navmesh blob could not be loaded — re-bake" };
  const loaded = await loadNavmesh(blob, id);
  return { ok: true, data: sampleNavmesh(loaded, pos) };
};

// ── bake_convex_hulls ────────────────────────────────────────────────
// Delegates to the shared `bakeEntityConvexHulls` helper (also used by
// the Inspector's "Bake convex decomp" button). For each entity it
// walks the live editor scene, runs V-HACD via `buildHulls` (falling
// back to quickhull3d), registers the serialized hull set on
// `window.__colliderHullSets`, and patches the entity's
// `PhysicsComponent` to `{ colliderType: "convex-decomp",
// collidersAssetId, colliderBakeOptions }` via the CommandStack so
// the change is undoable and re-bakes are reproducible.
const BAKE_CONVEX_HULLS: ToolDef = {
  name: "bake_convex_hulls",
  description:
    "Bake convex hulls (V-HACD, falling back to quickhull3d) from the live mesh of each entity in `entityIds`, then patch the entity's PhysicsComponent to `colliderType: convex-decomp` + collidersAssetId. Optional V-HACD knobs (`maxHulls`, `minHullVolume`, `voxelResolution`, `maxVerticesPerHull`, `fillMode`) are persisted on the entity's `physics.colliderBakeOptions` so re-bakes are reproducible. Routes through the CommandStack so the change is undoable.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Entities to bake convex hulls for.",
      },
      maxHulls: {
        type: "number",
        description: "Hard cap on hulls per mesh. V-HACD default: 64.",
      },
      minHullVolume: {
        type: "number",
        description: "Drop hulls below this volume (m³) after decomposition.",
      },
      voxelResolution: {
        type: "number",
        description:
          "V-HACD voxel grid resolution. Higher = finer detail and slower bake. V-HACD default: 400000.",
      },
      maxVerticesPerHull: {
        type: "number",
        description: "Cap on vertices in any single output hull. V-HACD default: 64.",
      },
      fillMode: {
        type: "string",
        enum: ["flood", "raycast", "surface"],
        description:
          "How V-HACD fills the voxel interior. `flood` (default) is fastest but assumes a watertight mesh; `raycast` is robust for open meshes; `surface` treats the mesh as hollow.",
      },
    },
    required: ["entityIds"],
    additionalProperties: false,
  },
};
const FILL_MODES: readonly HullFillMode[] = ["flood", "raycast", "surface"];
const bakeConvexHullsHandler: ToolHandler = async (input) => {
  const ids = Array.isArray(input.entityIds)
    ? input.entityIds.filter((s): s is string => typeof s === "string")
    : [];
  if (ids.length === 0)
    return { ok: false, error: "entityIds must be a non-empty string[]" };
  const bakeOpts: BuildHullsOptions = {};
  if (typeof input.maxHulls === "number") bakeOpts.maxHulls = input.maxHulls;
  if (typeof input.minHullVolume === "number")
    bakeOpts.minHullVolume = input.minHullVolume;
  if (typeof input.voxelResolution === "number")
    bakeOpts.voxelResolution = input.voxelResolution;
  if (typeof input.maxVerticesPerHull === "number")
    bakeOpts.maxVerticesPerHull = input.maxVerticesPerHull;
  if (
    typeof input.fillMode === "string" &&
    (FILL_MODES as readonly string[]).includes(input.fillMode)
  ) {
    bakeOpts.fillMode = input.fillMode as HullFillMode;
  }
  const results: Array<{
    entityId: string;
    collidersAssetId: number;
    hulls: number;
    totalVerts: number;
  }> = [];
  const errors: Array<{ entityId: string; error: string }> = [];
  for (const id of ids) {
    const r = await bakeEntityConvexHulls(id, bakeOpts);
    if (!r.ok) {
      errors.push({ entityId: id, error: r.error });
      continue;
    }
    results.push({
      entityId: id,
      collidersAssetId: r.collidersAssetId,
      hulls: r.hulls,
      totalVerts: r.totalVerts,
    });
  }
  return { ok: errors.length === 0, data: { results, errors } };
};

export const defs: ToolDef[] = [
  LIST_SURFACES,
  SET_SURFACE,
  SET_NAV_AGENT,
  MOVE_AGENT_TO,
  BAKE_NAVMESH,
  BAKE_CONVEX_HULLS,
  FIND_PATH,
  SAMPLE_NAVMESH,
  LIST_NAVMESH_STATS,
];

export const handlers: Record<string, ToolHandler> = {
  list_surfaces: listSurfacesHandler,
  set_surface: setSurfaceHandler,
  set_nav_agent: setNavAgentHandler,
  move_agent_to: moveAgentToHandler,
  bake_navmesh: bakeNavmeshHandler,
  bake_convex_hulls: bakeConvexHullsHandler,
  find_path: findPathHandler,
  sample_navmesh: sampleNavmeshHandler,
  list_navmesh_stats: listNavmeshStatsHandler,
};

export const destructiveToolNames: string[] = [
  "set_surface",
  "set_nav_agent",
  "bake_navmesh",
  "bake_convex_hulls",
];
