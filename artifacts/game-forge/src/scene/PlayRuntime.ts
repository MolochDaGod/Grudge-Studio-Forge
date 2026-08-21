import * as YUKA from "yuka";
import * as THREE from "three";
import type { LayerName, NavAgentComponent, SurfaceKind } from "@workspace/scene-schema";
import { compileCSharp, type CompiledScript, type ScriptEntity, type ScriptContext, type MouseState, type RaycastHit, type AgentHandle, type RaceStats, type StatsContext, type ResolvedStatsView, type StatsBaseView } from "./csTranspile";
import type { StatsEngine } from "./StatsEngine";
import { RACES } from "@/lib/races";
import { loadBlazorRuntime } from "./blazorRuntime";
import { parseCsHybridMeta, type CsHybridMeta } from "./csHybrid";
import type { Script } from "@workspace/api-client-react";
import type { EntityInboxes, EntityStates, GameBus, TriggerInbox } from "./GameBus";
import { spawnAgent, type AgentActor } from "./agentRuntime";

export type Compiled = CompiledScript & {
  error?: string;
  /** When set, play loop uses Blazor attach/tick instead of JS start/update. */
  blazor?: CsHybridMeta;
};

const cache = new Map<string, Compiled>();

/** Frozen catalog of per-race base stats keyed by race id. Mirrors
 *  `RACES[*].baseStats` so the script ctx can hand it straight to
 *  the deathmatch behaviors without re-deriving each frame. */
const RACE_STATS: Record<string, RaceStats> = Object.freeze(
  Object.fromEntries(RACES.map((r) => [r.id, { ...r.baseStats }])),
);

/** Public accessor — also reused by `CameraControllers` to size the
 *  player's WASD speed off the active race when the player entity
 *  carries a `raceId`. Returns `undefined` for unknown ids. */
export function getRaceStats(raceId: string | null | undefined): RaceStats | undefined {
  if (!raceId) return undefined;
  return RACE_STATS[raceId];
}

let blazorWarmed = false;

/**
 * Warm Blazor WASM in the background (Toolbar play). Prefer
 * {@link ensureBlazorRuntime} when hybrid packs are present so Attach is ready.
 */
export function warmBlazorRuntime(): void {
  if (blazorWarmed) return;
  blazorWarmed = true;
  void loadBlazorRuntime();
}

/** Awaitable ready gate for hybrid Blazor packs (production attach/tick). */
export function ensureBlazorRuntime(): Promise<Awaited<ReturnType<typeof loadBlazorRuntime>>> {
  blazorWarmed = true;
  return loadBlazorRuntime();
}

function compileJs(code: string): Compiled {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "exports",
      `"use strict"; const module = { exports }; ${code}\nreturn module.exports;`,
    ) as (exports: Record<string, unknown>) => Record<string, unknown>;
    const exportsObj: Record<string, unknown> = {};
    const mod = factory(exportsObj);
    return {
      start: typeof mod.start === "function" ? (mod.start as Compiled["start"]) : undefined,
      update: typeof mod.update === "function" ? (mod.update as Compiled["update"]) : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Hybrid C# compile:
 * - blazor pack directives → marker for attach/tick (no transpile body)
 * - otherwise → subset transpile for live edit/preview
 */
function compileCs(code: string, scriptName = "Script"): Compiled {
  const meta = parseCsHybridMeta(code, scriptName);
  if (meta.mode === "blazor") {
    if (!meta.pack && !meta.assemblyBase64) {
      return {
        error:
          "C# hybrid blazor mode requires // @forge-pack: Spin|Bob|Strafe or // @forge-assembly: <base64>",
        blazor: meta,
      };
    }
    return { blazor: meta };
  }
  try {
    return compileCSharp(code);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function getCompiledScript(script: Script): Compiled {
  const key = `${script.id}:${script.language}:${script.code.length}:${script.code.slice(0, 48)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const compiled =
    script.language === "cs"
      ? compileCs(script.code, script.name || `Script${script.id}`)
      : compileJs(script.code);
  cache.set(key, compiled);
  // bound cache
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return compiled;
}

/** True when any project script requests the real Blazor path. */
export function projectNeedsBlazor(scripts: Script[] | undefined): boolean {
  if (!scripts?.length) return false;
  for (const s of scripts) {
    if (s.language !== "cs") continue;
    if (parseCsHybridMeta(s.code, s.name).mode === "blazor") return true;
  }
  return false;
}

/** Compile a built-in behavior source string (deathmatch behaviors). Cached
 *  by source hash so repeated lookups are free. */
export function getCompiledBehavior(behaviorKey: string, source: string): Compiled {
  const key = `behavior:${behaviorKey}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const compiled = compileJs(source);
  cache.set(key, compiled);
  return compiled;
}

/**
 * Build the per-frame, per-entity {@link ScriptContext}.
 *
 * The runtime injects the heavyweight machinery (raycaster, scene graph
 * lookups, message inbox, global event bus, mouse state). Scripts only see
 * the small surface defined in `csTranspile.ts`.
 */
export function makeContext(opts: {
  entityId: string;
  delta: number;
  elapsed: number;
  keys: Record<string, boolean>;
  mouse: MouseState;
  log: (level: "log" | "warn" | "error", msg: string) => void;
  findEntity: (name: string) => ScriptEntity | undefined;
  findEntities: (predicate: (e: ScriptEntity) => boolean) => ScriptEntity[];
  findEntityById: (id: string) => ScriptEntity | undefined;
  setEntityPosition: (id: string, position: [number, number, number]) => boolean;
  castRay: (
    origin: [number, number, number],
    direction: [number, number, number],
    maxDistance: number,
    excludeIds: string[] | undefined,
    layerMask: string[] | undefined,
    materialFilter?: MaterialRayFilter,
  ) => RaycastHit | null;
  castScreenRay: (maxDistance: number) => RaycastHit | null;
  findEntitiesByLayer: (name: string) => ScriptEntity[];
  cameraPosition: () => [number, number, number];
  cameraDirection: () => [number, number, number];
  inboxes: EntityInboxes;
  bus: GameBus;
  states: EntityStates;
  triggers: TriggerInbox;
  despawn: (id: string) => boolean;
  spawn: (spec: {
    name: string;
    position: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    modelUrl?: string;
    raceId?: string;
    layer?: string;
    behavior?: string;
    tint?: string;
    parentId?: string | null;
  }) => string | null;
  freeze: (id: string) => void;
  unfreeze: (id: string) => void;
  ragdoll: (
    id: string,
    direction: [number, number, number],
    force?: number,
  ) => boolean;
  knockback?: (
    id: string,
    direction: [number, number, number],
    force?: number,
  ) => boolean;
  blowAway?: (origin: [number, number, number], force?: number, radius?: number) => number;
  wake?: (id: string) => boolean;
  takeSnapshot?: () => Uint8Array | null;
  castShape?: ScriptContext["scene"]["castShape"];
  meleeVolume?: ScriptContext["scene"]["meleeVolume"];
  predictLanding?: ScriptContext["scene"]["predictLanding"];
  wheelCast?: ScriptContext["scene"]["wheelCast"];
  jointRevolute?: ScriptContext["scene"]["jointRevolute"];
  parentOf: (id: string) => ScriptEntity | undefined;
  childrenOf: (id: string) => ScriptEntity[];
  descendantsOf: (id: string) => ScriptEntity[];
  findChildren: (
    rootId: string,
    predicate: (e: ScriptEntity) => boolean,
    deep?: boolean,
  ) => ScriptEntity[];
  worldPosition: (id: string) => [number, number, number];
  /** Look up the per-entity agent handle (driven by the play-mode
   *  agent runtime in Viewport.tsx). Returns `undefined` when the
   *  entity has no `navAgent` component or play mode hasn't spawned
   *  an actor yet. */
  agentFor: (id: string) => AgentHandle | undefined;
  /** Wraps `findPath` against the currently-loaded navmesh. Returns
   *  `null` when no navmesh is baked or the endpoints are off-mesh.
   *  Optional `options.areaFilter` is forwarded to the recast query
   *  filter so callers can restrict pathfinding to specific surfaces
   *  (Walk-only, Swim-only, etc.). */
  navFindPath: (
    start: [number, number, number],
    end: [number, number, number],
    options?: { areaFilter?: SurfaceKind[] },
  ) => [number, number, number][] | null;
  /** Wraps `sampleNavmesh` (snap to nearest walkable poly). */
  navSample: (
    position: [number, number, number],
  ) => { point: [number, number, number]; areaId: number } | null;
  statsEngine: StatsEngine;
}): ScriptContext {
  const fromId = opts.entityId;
  return {
    time: { delta: opts.delta, elapsed: opts.elapsed },
    input: { keys: opts.keys, mouse: opts.mouse },
    scene: {
      find: opts.findEntity,
      findAll: opts.findEntities,
      findById: opts.findEntityById,
      setPosition: opts.setEntityPosition,
      castRay: (origin, direction, maxDistance, excludeIds, layerMask, materialFilter) =>
        opts.castRay(origin, direction, maxDistance ?? 200, excludeIds, layerMask, materialFilter),
      castScreenRay: (maxDistance) => opts.castScreenRay(maxDistance ?? 500),
      findEntitiesByLayer: opts.findEntitiesByLayer,
      send: (targetId, event, payload) =>
        opts.inboxes.send(targetId, event, payload, fromId),
      on: (event, handler) =>
        opts.inboxes.registerHandler(fromId, event, handler),
      onEnterTrigger: (handler) => opts.triggers.registerEnter(fromId, handler),
      onExitTrigger: (handler) => opts.triggers.registerExit(fromId, handler),
      despawn: (id) => opts.despawn(id),
      spawn: (spec) => opts.spawn(spec),
      cameraPosition: opts.cameraPosition,
      cameraDirection: opts.cameraDirection,
      freeze: opts.freeze,
      unfreeze: opts.unfreeze,
      ragdoll: opts.ragdoll,
      knockback: opts.knockback,
      blowAway: opts.blowAway,
      wake: opts.wake,
      takeSnapshot: opts.takeSnapshot,
      castShape: opts.castShape,
      meleeVolume: opts.meleeVolume,
      predictLanding: opts.predictLanding,
      wheelCast: opts.wheelCast,
      jointRevolute: opts.jointRevolute,
      parentOf: opts.parentOf,
      childrenOf: opts.childrenOf,
      descendantsOf: opts.descendantsOf,
      findChildren: opts.findChildren,
      worldPosition: opts.worldPosition,
      agent: opts.agentFor,
    },
    nav: {
      findPath: opts.navFindPath,
      sample: opts.navSample,
    },
    events: {
      emit: (event, payload) => opts.bus.emit(event, payload),
      on: (event, handler) => {
        opts.bus.on(event, handler);
      },
    },
    stats: buildStatsContext(opts.statsEngine),
    races: RACE_STATS,
    state: opts.states.get(fromId),
    yuka: YUKA,
    log: (...args: unknown[]) => opts.log("log", args.map((a) => stringify(a)).join(" ")),
  };
}

/** Build the `ctx.stats` facade that scripts see. Delegates to the
 *  session's StatsEngine for resolution + modifier management. */
function buildStatsContext(engine: StatsEngine): StatsContext {
  return {
    get: (id) => {
      const r = engine.get(id);
      if (!r) return undefined;
      return {
        attributes: { ...r.attributes } as Record<string, number>,
        derived: { ...r.derived } as Record<string, number>,
        level: r.level,
        xp: r.xp,
      };
    },
    getBase: (id) => {
      const b = engine.getBase(id);
      if (!b) return undefined;
      return {
        base: { ...b.base } as Record<string, number>,
        level: b.level ?? 1,
        xp: b.xp ?? 0,
      };
    },
    modify: (entityId, mod) => engine.modify(entityId, mod as Parameters<StatsEngine["modify"]>[1]),
    remove: (entityId, modId) => engine.remove(entityId, modId),
    removeBySource: (entityId, source) => engine.removeBySource(entityId, source),
  };
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Cast a Three.js ray through a set of candidate objects and return the
 * closest entity hit (excluding entities in `excludeIds`).
 *
 * We walk up the hit's parent chain looking for the first ancestor whose
 * `userData.entityId` is set — EntityRenderer attaches that on every
 * rendered group (both physics and non-physics paths). If the ray hits a
 * decorative non-entity mesh (e.g., the map model's geometry), the hit is
 * returned with `entityId: null` so the caller still gets `point` /
 * `distance` for placement / muzzle-flash positioning.
 */
const SHARED_RAYCASTER = new THREE.Raycaster();
/** Optional per-cast Material filter. Mirrors the per-kind defaults
 *  registry: an arrow that respects `blocksProjectiles` will pass
 *  through Glass / Foliage / Smoke automatically; an AI line-of-sight
 *  cast that respects `blocksLineOfSight` will see through Foliage but
 *  stop at Glass. Pass `kinds` to narrow further (`["Metal","Stone"]`). */
export interface MaterialRayFilter {
  /** When true, hits whose resolved material has
   *  `blocksLineOfSight: false` are skipped (the ray passes through). */
  requireBlocksLineOfSight?: boolean;
  /** When true, hits whose resolved material has
   *  `blocksProjectiles: false` are skipped (think glass / foliage). */
  requireBlocksProjectiles?: boolean;
  /** When true, hits whose resolved material has
   *  `blocksAudio: false` are skipped — for audio-occlusion checks. */
  requireBlocksAudio?: boolean;
  /** Restrict to entity hits whose resolved Material kind is in this
   *  list. Decorative non-entity meshes are still returned so the
   *  static world keeps blocking sight regardless of the kinds list. */
  kinds?: string[];
}

export function raycastEntities(
  scene: THREE.Object3D,
  origin: [number, number, number],
  direction: [number, number, number],
  maxDistance: number,
  excludeIds: string[] | undefined,
  layerMask?: string[],
  materialFilter?: MaterialRayFilter,
): RaycastHit | null {
  SHARED_RAYCASTER.set(
    new THREE.Vector3(origin[0], origin[1], origin[2]),
    new THREE.Vector3(direction[0], direction[1], direction[2]).normalize(),
  );
  SHARED_RAYCASTER.far = maxDistance;
  const hits = SHARED_RAYCASTER.intersectObjects(scene.children, true);
  if (hits.length === 0) return null;
  const exclude = new Set(excludeIds ?? []);
  const mask = layerMask && layerMask.length > 0 ? new Set(layerMask) : null;
  const kindMask =
    materialFilter?.kinds && materialFilter.kinds.length > 0
      ? new Set(materialFilter.kinds)
      : null;
  for (const hit of hits) {
    // Walk up to find an entity-bearing ancestor and read all three
    // axes (layer, surface — for completeness — and material). Material
    // is resolved by reading the first ancestor that stamped any of
    // the four `material*` fields.
    let entityId: string | null = null;
    let layer: string | null = null;
    let material: string | null = null;
    let density: number | null = null;
    let blocksLineOfSight: boolean | null = null;
    let blocksProjectiles: boolean | null = null;
    let blocksAudio: boolean | null = null;
    let cur: THREE.Object3D | null = hit.object;
    while (cur) {
      const ud = cur.userData as
        | {
            entityId?: string;
            layer?: string;
            material?: string;
            materialDensity?: number;
            materialBlocksLineOfSight?: boolean;
            materialBlocksProjectiles?: boolean;
            materialBlocksAudio?: boolean;
          }
        | undefined;
      if (!entityId && ud?.entityId) entityId = ud.entityId;
      if (!layer && ud?.layer) layer = ud.layer;
      if (!material && ud?.material) material = ud.material;
      if (density === null && typeof ud?.materialDensity === "number")
        density = ud.materialDensity;
      if (blocksLineOfSight === null && typeof ud?.materialBlocksLineOfSight === "boolean")
        blocksLineOfSight = ud.materialBlocksLineOfSight;
      if (blocksProjectiles === null && typeof ud?.materialBlocksProjectiles === "boolean")
        blocksProjectiles = ud.materialBlocksProjectiles;
      if (blocksAudio === null && typeof ud?.materialBlocksAudio === "boolean")
        blocksAudio = ud.materialBlocksAudio;
      if (
        entityId &&
        layer &&
        material &&
        density !== null &&
        blocksLineOfSight !== null &&
        blocksProjectiles !== null &&
        blocksAudio !== null
      ) {
        break;
      }
      cur = cur.parent;
    }
    if (entityId && exclude.has(entityId)) continue;
    // Layer-mask filter: applies only to entity-bearing hits. Decorative
    // non-entity meshes (no `userData.entityId` anywhere up the chain) are
    // always returned so a wall in the map model still blocks line-of-sight
    // even when the mask is `["NPC"]`.
    if (mask && entityId && layer && !mask.has(layer)) continue;
    if (mask && entityId && !layer && !mask.has("Default")) continue;
    // Material filter: same "decorative meshes always return" rule —
    // unmarked geometry is treated as opaque/blocking so static world
    // never falls out of sight checks. When the entity DID stamp a
    // material flag and the cast wants to ignore non-blockers, skip.
    if (materialFilter?.requireBlocksLineOfSight && blocksLineOfSight === false) continue;
    if (materialFilter?.requireBlocksProjectiles && blocksProjectiles === false) continue;
    if (materialFilter?.requireBlocksAudio && blocksAudio === false) continue;
    if (kindMask && entityId && material && !kindMask.has(material)) continue;
    return {
      entityId,
      point: [hit.point.x, hit.point.y, hit.point.z],
      distance: hit.distance,
      normal:
        hit.face && hit.object instanceof THREE.Mesh
          ? (() => {
              const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
              return [n.x, n.y, n.z] as [number, number, number];
            })()
          : [0, 1, 0],
      material,
      density,
      blocksLineOfSight,
      blocksProjectiles,
      blocksAudio,
    };
  }
  return null;
}

/**
 * Reconcile the live `agents` map against the current scene's entities.
 *
 * Spawns an {@link AgentActor} for any entity that newly carries a
 * `navAgent` component, and disposes (and drops) the actor for any
 * entity that lost it or was despawned. Cheap on the steady-state
 * "nothing changed" path — call once per frame from the play-mode tick.
 */
export function reconcileAgents(
  entities: ReadonlyArray<{ id: string; navAgent?: NavAgentComponent }>,
  agents: Map<string, AgentActor>,
): void {
  const live = new Set<string>();
  for (const ent of entities) {
    if (!ent.navAgent) continue;
    live.add(ent.id);
    if (!agents.has(ent.id)) {
      agents.set(ent.id, spawnAgent(ent.navAgent));
    }
  }
  for (const id of [...agents.keys()]) {
    if (!live.has(id)) {
      try {
        agents.get(id)?.stop();
      } catch {
        /* ignore */
      }
      agents.delete(id);
    }
  }
}

/**
 * Drop a short downward foot probe under each agent and feed the
 * resulting surface tag into its FSM as a `{ type: "surface" }` event.
 *
 * `userData.surface` tags are stored lowercased on the renderer side
 * (`"walk"` / `"climb"` / …) while `SurfaceKind` is PascalCase — this
 * helper handles the round-trip so the agent's XState guards (which
 * read the *event* payload, not context, per XState v5 child-state
 * resolution order) line up with the probe.
 */
export function tickAgentSurfaces(
  threeScene: THREE.Object3D,
  agents: Map<string, AgentActor>,
  positionOf: (entityId: string) => [number, number, number] | null,
): void {
  for (const [id, actor] of agents) {
    const pos = positionOf(id);
    if (!pos) continue;
    const probe = groundProbe(threeScene, pos, { layerMask: [] });
    const tag = (probe?.surface ?? "Walk").toLowerCase();
    const mapped: SurfaceKind =
      tag === "climb"
        ? "Climb"
        : tag === "swim"
          ? "Swim"
          : tag === "jump"
            ? "Jump"
            : tag === "dig"
              ? "Dig"
              : tag === "none"
                ? "None"
                : "Walk";
    actor.send({ type: "surface", surface: mapped });
  }
}

/** Result of a {@link groundProbe} hit. `surface` is the parent-chain
 *  surface tag (see EntityRenderer LoadedModel) — defaults to `"walk"`
 *  when the hit object's chain has no explicit tag, which matches the
 *  spatial-queries skill's "anything unmarked is plain walkable ground"
 *  rule (§3.2). */
export interface GroundProbeHit {
  /** World-space hit point. */
  point: [number, number, number];
  /** Distance from origin (which is `position + originOffset`) to the hit. */
  distance: number;
  /** World-space surface normal. `[0, 1, 0]` if the hit had no face data. */
  normal: [number, number, number];
  /** Surface tag found by walking up the hit object's parents looking
   *  for the first ancestor with `userData.surface` set. */
  surface: string;
  /** Entity ID found via the same parent-chain walk (mirrors
   *  `raycastEntities`). `null` for decorative non-entity meshes
   *  (e.g. raw map geometry not wrapped by an EntityRenderer). */
  entityId: string | null;
}

/**
 * First-contact-below ground probe. Drops a short downward ray from
 * just above the given world position and returns the first hit, plus
 * the surface tag found on the parent chain.
 *
 * Implements the §2.1 + §3.2 patterns from
 * `.agents/skills/spatial-queries-and-surfaces/SKILL.md`:
 *
 *   - origin lifted by `originOffset` (default 0.1m) above the position
 *     to avoid starting inside the floor and missing it,
 *   - `maxDistance` capped tight (default 0.35m) so a long ray can't
 *     punch through the world and falsely report grounded,
 *   - returns `null` (not "grounded but at infinity") when nothing is
 *     within reach, so callers can branch cleanly on falsiness.
 *
 * Reuses the module-level `SHARED_RAYCASTER` so this helper is safe to
 * call every frame from a behavior without GC churn.
 *
 * Typical use from a player behavior:
 * ```ts
 * const hit = groundProbe(scene, [t.position.x, t.position.y, t.position.z]);
 * isGrounded = !!hit;
 * if (hit?.surface === "swim") moveSpeed *= 0.5;
 * ```
 */
export function groundProbe(
  scene: THREE.Object3D,
  position: [number, number, number],
  options?: {
    originOffset?: number;
    maxDistance?: number;
    /** Ignore hits whose parent chain includes any of these entity IDs.
     *  Used by the editor's ground-snap gizmo modifier so the dragged
     *  entity doesn't self-intersect and snap to its own collider. */
    excludeEntityIds?: readonly string[];
    /** Restrict hits to entities on these layers. Decorative non-entity
     *  meshes (raw map geometry without an entityId in the parent chain)
     *  are always allowed. Pass `[]` to disable layer filtering. */
    layerMask?: string[];
  },
): GroundProbeHit | null {
  const originOffset = options?.originOffset ?? 0.1;
  const maxDistance = options?.maxDistance ?? 0.35;
  const excluded =
    options?.excludeEntityIds && options.excludeEntityIds.length > 0
      ? new Set(options.excludeEntityIds)
      : null;
  // Default to the Terrain layer so player/NPC ground checks ignore each
  // other's capsule colliders, projectiles in flight, etc. Pass an empty
  // array to disable filtering entirely (the editor ground-snap path does
  // this so it can snap onto any collider, regardless of layer).
  const layerMask = options?.layerMask ?? ["Terrain"];
  const mask = layerMask.length > 0 ? new Set(layerMask) : null;
  SHARED_RAYCASTER.set(
    new THREE.Vector3(position[0], position[1] + originOffset, position[2]),
    new THREE.Vector3(0, -1, 0),
  );
  // Total ray length includes the lift, so the effective range below
  // the foot equals `maxDistance` minus zero (the lift cancels out
  // because the lift point is the ray origin).
  SHARED_RAYCASTER.far = originOffset + maxDistance;
  const hits = SHARED_RAYCASTER.intersectObjects(scene.children, true);
  if (hits.length === 0) return null;
  // Walk the parent chain helper. Returns first surface tag, entity ID, and
  // layer up the ancestry — used by both the exclude filter, the layer-mask
  // filter, and the result payload.
  const inspect = (
    obj: THREE.Object3D,
  ): { surface: string | null; entityId: string | null; layer: string | null } => {
    let surface: string | null = null;
    let entityId: string | null = null;
    let layer: string | null = null;
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const ud = cur.userData as
        | { surface?: string; entityId?: string; layer?: string }
        | undefined;
      if (!surface && ud?.surface) surface = ud.surface;
      if (!entityId && ud?.entityId) entityId = ud.entityId;
      if (!layer && ud?.layer) layer = ud.layer;
      if (surface && entityId && layer) break;
      cur = cur.parent;
    }
    return { surface, entityId, layer };
  };

  // Find the first hit whose chain isn't excluded AND (if a layer mask is
  // active) belongs to an allowed layer. Decorative non-entity meshes (no
  // entityId on their parent chain) are always allowed — they represent
  // unmarked terrain geometry, so a wall in the map model still blocks the
  // probe even with `layerMask: ["Terrain"]`.
  for (const hit of hits) {
    const meta = inspect(hit.object);
    if (excluded && meta.entityId && excluded.has(meta.entityId)) continue;
    if (mask && meta.entityId) {
      if (!mask.has(meta.layer ?? "Default")) continue;
    }
    return {
      point: [hit.point.x, hit.point.y, hit.point.z],
      distance: hit.distance - originOffset,
      normal:
        hit.face && hit.object instanceof THREE.Mesh
          ? (() => {
              const n = hit.face.normal
                .clone()
                .transformDirection(hit.object.matrixWorld)
                .normalize();
              return [n.x, n.y, n.z] as [number, number, number];
            })()
          : [0, 1, 0],
      surface: meta.surface ?? "walk",
      entityId: meta.entityId,
    };
  }
  return null;
}

/**
 * Forward (or custom direction) probe for climbable surfaces — ladders,
 * Climb-tagged walls, Trigger climb volumes. Casts a short ray from
 * chest height and walks the hit parent chain for `userData.surface`.
 *
 * Layer mask includes Terrain **and** Trigger so sensor ladders still hit.
 */
export function climbProbe(
  scene: THREE.Object3D,
  position: [number, number, number],
  direction: [number, number, number],
  options?: {
    /** Height above feet for the ray origin. Default 1.1 m (chest). */
    originHeight?: number;
    maxDistance?: number;
    excludeEntityIds?: readonly string[];
  },
): GroundProbeHit | null {
  const originHeight = options?.originHeight ?? 1.1;
  const maxDistance = options?.maxDistance ?? 0.85;
  const excluded =
    options?.excludeEntityIds && options.excludeEntityIds.length > 0
      ? new Set(options.excludeEntityIds)
      : null;

  const dir = new THREE.Vector3(direction[0], direction[1], direction[2]);
  if (dir.lengthSq() < 1e-8) return null;
  dir.normalize();

  SHARED_RAYCASTER.set(
    new THREE.Vector3(position[0], position[1] + originHeight, position[2]),
    dir,
  );
  SHARED_RAYCASTER.far = maxDistance;
  const hits = SHARED_RAYCASTER.intersectObjects(scene.children, true);
  if (hits.length === 0) return null;

  const inspect = (
    obj: THREE.Object3D,
  ): { surface: string | null; entityId: string | null; layer: string | null } => {
    let surface: string | null = null;
    let entityId: string | null = null;
    let layer: string | null = null;
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const ud = cur.userData as
        | { surface?: string; entityId?: string; layer?: string }
        | undefined;
      if (!surface && ud?.surface) surface = ud.surface;
      if (!entityId && ud?.entityId) entityId = ud.entityId;
      if (!layer && ud?.layer) layer = ud.layer;
      if (surface && entityId && layer) break;
      cur = cur.parent;
    }
    return { surface, entityId, layer };
  };

  const allowedLayers = new Set(["Terrain", "Trigger", "Default"]);

  for (const hit of hits) {
    const meta = inspect(hit.object);
    if (excluded && meta.entityId && excluded.has(meta.entityId)) continue;
    if (meta.entityId && meta.layer && !allowedLayers.has(meta.layer)) continue;
    const surface = (meta.surface ?? "walk").toLowerCase();
    if (surface !== "climb") continue;
    return {
      point: [hit.point.x, hit.point.y, hit.point.z],
      distance: hit.distance,
      normal:
        hit.face && hit.object instanceof THREE.Mesh
          ? (() => {
              const n = hit.face.normal
                .clone()
                .transformDirection(hit.object.matrixWorld)
                .normalize();
              return [n.x, n.y, n.z] as [number, number, number];
            })()
          : [-dir.x, 0, -dir.z],
      surface: "climb",
      entityId: meta.entityId,
    };
  }
  return null;
}

export function isClimbSurface(tag: string | null | undefined): boolean {
  return (tag ?? "").toLowerCase() === "climb";
}
