import * as YUKA from "yuka";
import * as THREE from "three";
import { compileCSharp, type CompiledScript, type ScriptEntity, type ScriptContext, type MouseState, type RaycastHit } from "./csTranspile";
import { loadBlazorRuntime } from "./blazorRuntime";
import type { Script } from "@workspace/api-client-react";
import type { EntityInboxes, EntityStates, GameBus } from "./GameBus";

export type Compiled = CompiledScript & { error?: string };

const cache = new Map<string, Compiled>();

let blazorWarmed = false;
export function warmBlazorRuntime(): void {
  if (blazorWarmed) return;
  blazorWarmed = true;
  void loadBlazorRuntime();
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

function compileCs(code: string): Compiled {
  try {
    return compileCSharp(code);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function getCompiledScript(script: Script): Compiled {
  const key = `${script.id}:${script.language}:${script.code.length}:${script.code.slice(0, 32)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const compiled = script.language === "cs" ? compileCs(script.code) : compileJs(script.code);
  cache.set(key, compiled);
  // bound cache
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return compiled;
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
  ) => RaycastHit | null;
  cameraPosition: () => [number, number, number];
  cameraDirection: () => [number, number, number];
  inboxes: EntityInboxes;
  bus: GameBus;
  states: EntityStates;
  freeze: (id: string) => void;
  unfreeze: (id: string) => void;
  parentOf: (id: string) => ScriptEntity | undefined;
  childrenOf: (id: string) => ScriptEntity[];
  descendantsOf: (id: string) => ScriptEntity[];
  findChildren: (
    rootId: string,
    predicate: (e: ScriptEntity) => boolean,
    deep?: boolean,
  ) => ScriptEntity[];
  worldPosition: (id: string) => [number, number, number];
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
      castRay: (origin, direction, maxDistance, excludeIds) =>
        opts.castRay(origin, direction, maxDistance ?? 200, excludeIds),
      send: (targetId, event, payload) =>
        opts.inboxes.send(targetId, event, payload, fromId),
      on: (event, handler) =>
        opts.inboxes.registerHandler(fromId, event, handler),
      cameraPosition: opts.cameraPosition,
      cameraDirection: opts.cameraDirection,
      freeze: opts.freeze,
      unfreeze: opts.unfreeze,
      parentOf: opts.parentOf,
      childrenOf: opts.childrenOf,
      descendantsOf: opts.descendantsOf,
      findChildren: opts.findChildren,
      worldPosition: opts.worldPosition,
    },
    events: {
      emit: (event, payload) => opts.bus.emit(event, payload),
      on: (event, handler) => {
        opts.bus.on(event, handler);
      },
    },
    state: opts.states.get(fromId),
    yuka: YUKA,
    log: (...args: unknown[]) => opts.log("log", args.map((a) => stringify(a)).join(" ")),
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
export function raycastEntities(
  scene: THREE.Object3D,
  origin: [number, number, number],
  direction: [number, number, number],
  maxDistance: number,
  excludeIds: string[] | undefined,
): RaycastHit | null {
  SHARED_RAYCASTER.set(
    new THREE.Vector3(origin[0], origin[1], origin[2]),
    new THREE.Vector3(direction[0], direction[1], direction[2]).normalize(),
  );
  SHARED_RAYCASTER.far = maxDistance;
  const hits = SHARED_RAYCASTER.intersectObjects(scene.children, true);
  if (hits.length === 0) return null;
  const exclude = new Set(excludeIds ?? []);
  for (const hit of hits) {
    // Walk up to find an entity-bearing ancestor.
    let entityId: string | null = null;
    let cur: THREE.Object3D | null = hit.object;
    while (cur) {
      const ud = cur.userData as { entityId?: string } | undefined;
      if (ud?.entityId) {
        entityId = ud.entityId;
        break;
      }
      cur = cur.parent;
    }
    if (entityId && exclude.has(entityId)) continue;
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
    };
  }
  return null;
}
