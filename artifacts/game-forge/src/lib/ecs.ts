/**
 * Lightweight ECS mirror of the editor's scene entities.
 *
 * The Zustand store remains the single source of truth for the scene —
 * the Inspector, Hierarchy, undo stack, and serializer all hang off it.
 * This module subscribes to the store and reflects each `SceneEntity`
 * into a `miniplex` world as a flat, query-friendly component bag.
 *
 * Why bother?  As soon as the AI starts generating dozens of entities
 * ("spawn 30 enemies", "scatter 100 trees"), answering questions like
 * "how many lights are above y=10?" or "give me the ids of every dynamic
 * physics body without a script" needs *structural queries*, not bespoke
 * Array.filter walks over the entity list. Miniplex gives us a clean
 * world-of-components surface to query against, and reserves the option
 * to switch hot filters over to its indexed bucket queries later — without
 * changing the AI tool surface.
 *
 * Reflection model:
 *   - One ECS entity per SceneEntity, keyed on the same `id`.
 *   - Components are derived (boolean tags + flattened position/scale)
 *     so queries can express "physics AND model AND no script" without
 *     touching the original nested SceneEntity shape.
 *   - Mutations DO NOT flow back. ECS is read-only from the AI's
 *     perspective; writes still go through the existing tools that
 *     mutate the store, which then re-reflect here.
 */

import { World } from "miniplex";
import { useEditor } from "@/store/editor";
import type { SceneEntity, EntityType, ControllerKind } from "@/scene/types";

export interface ForgeEcsEntity {
  /** Stable SceneEntity.id — the same value the AI uses elsewhere. */
  id: string;
  name: string;
  type: EntityType;
  /** World-space-ish position from `transform.position` (parent transforms
   *  are NOT composed; we mirror what the inspector shows). */
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  parentId: string | null;

  // ── Tag components — presence-as-truth so queries read naturally ──
  /** Has any rigid body / collider configured. */
  physics?: true;
  /** Body type when `physics` is set. */
  bodyType?: "fixed" | "dynamic" | "kinematicPosition" | "kinematicVelocity";
  /** Has a `light` component. */
  light?: true;
  lightKind?: "point" | "directional" | "spot";
  /** Has a `model` component. */
  model?: true;
  modelKind?: "builtin" | "url" | "asset";
  /** Has any controller (player). */
  controller?: ControllerKind;
  /** Has a script attached. */
  script?: true;
  scriptId?: number;
}

/** Singleton world. We only ever instantiate one of these per page. */
export const world = new World<ForgeEcsEntity>();

/** id → ECS entity reference, for O(1) reconciliation. */
const byId = new Map<string, ForgeEcsEntity>();

function reflect(scene: SceneEntity): ForgeEcsEntity {
  const ent: ForgeEcsEntity = {
    id: scene.id,
    name: scene.name,
    type: scene.type,
    position: {
      x: scene.transform.position[0],
      y: scene.transform.position[1],
      z: scene.transform.position[2],
    },
    scale: {
      x: scene.transform.scale[0],
      y: scene.transform.scale[1],
      z: scene.transform.scale[2],
    },
    parentId: scene.parentId ?? null,
  };
  if (scene.physics) {
    ent.physics = true;
    if (scene.physics.bodyType) ent.bodyType = scene.physics.bodyType;
  }
  if (scene.light) {
    ent.light = true;
    if (scene.light.kind) ent.lightKind = scene.light.kind;
  }
  if (scene.model) {
    ent.model = true;
    ent.modelKind = scene.model.url
      ? "url"
      : scene.model.assetId
        ? "asset"
        : "builtin";
  }
  if (scene.controllerKind && scene.controllerKind !== "none") {
    ent.controller = scene.controllerKind;
  }
  if (scene.scriptId != null) {
    ent.script = true;
    ent.scriptId = scene.scriptId;
  }
  return ent;
}

/**
 * Reconcile the world with a fresh entity list. Insert/update/delete
 * are all O(n) over the diff, not O(n²) — we use a Map keyed on id so
 * adding an entity to a 10k-entity scene is still a single hash lookup.
 *
 * `world.update()` only re-fires queries the entity actually moved
 * into/out of, so a no-op update (e.g. unrelated re-render of the
 * store) doesn't churn query buckets.
 */
function reconcile(entities: readonly SceneEntity[]): void {
  const seen = new Set<string>();
  for (const scene of entities) {
    seen.add(scene.id);
    const next = reflect(scene);
    const existing = byId.get(scene.id);
    if (!existing) {
      const added = world.add(next);
      byId.set(scene.id, added);
    } else {
      // Mutate in place + tell miniplex the shape may have changed so
      // queries get re-evaluated correctly.
      Object.assign(existing, next);
      // Drop tag components that no longer apply.
      const tagKeys = [
        "physics",
        "bodyType",
        "light",
        "lightKind",
        "model",
        "modelKind",
        "controller",
        "script",
        "scriptId",
      ] as const;
      // reason: miniplex Entity is typed as a union of partials; we need
      // an indexable view to `delete` keys that the new patch dropped.
      const bag = existing as unknown as Record<string, unknown>;
      for (const k of tagKeys) {
        if (!(k in next)) delete bag[k];
      }
      world.reindex(existing);
    }
  }
  // Remove entities that disappeared from the store.
  for (const [id, ent] of byId) {
    if (!seen.has(id)) {
      world.remove(ent);
      byId.delete(id);
    }
  }
}

let started = false;

/** Wire the store subscription. Idempotent — safe to call from multiple
 *  bootstraps (StrictMode double-mount, HMR). */
export function startEcsSync(): () => void {
  if (started) return () => {};
  started = true;
  // Hydrate from current state, then subscribe.
  reconcile(useEditor.getState().sceneData.entities);
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.sceneData.entities !== prev.sceneData.entities) {
      reconcile(s.sceneData.entities);
    }
  });
  return () => {
    unsub();
    started = false;
    world.clear();
    byId.clear();
  };
}

// ── Query helpers used by AI tools ────────────────────────────────────

export type EcsFilter = {
  /** Match against `type`. */
  type?: EntityType | EntityType[];
  /** Match against `controller` presence (any non-"none" value). */
  hasController?: boolean;
  /** Match against `script` presence. */
  hasScript?: boolean;
  /** Match against `physics` presence; optionally a specific bodyType. */
  hasPhysics?: boolean;
  bodyType?: "fixed" | "dynamic" | "kinematicPosition" | "kinematicVelocity";
  /** Match against `light` presence; optionally a specific lightKind. */
  hasLight?: boolean;
  lightKind?: "point" | "directional" | "spot";
  /** Substring match on `name` (case-insensitive). */
  nameContains?: string;
  /** Inclusive bounds on world position; any axis omitted means "no bound". */
  positionMin?: { x?: number; y?: number; z?: number };
  positionMax?: { x?: number; y?: number; z?: number };
};

function matches(ent: ForgeEcsEntity, f: EcsFilter): boolean {
  if (f.type) {
    const types = Array.isArray(f.type) ? f.type : [f.type];
    if (!types.includes(ent.type)) return false;
  }
  if (f.hasController != null) {
    const has = !!ent.controller;
    if (has !== f.hasController) return false;
  }
  if (f.hasScript != null && !!ent.script !== f.hasScript) return false;
  if (f.hasPhysics != null && !!ent.physics !== f.hasPhysics) return false;
  if (f.bodyType && ent.bodyType !== f.bodyType) return false;
  if (f.hasLight != null && !!ent.light !== f.hasLight) return false;
  if (f.lightKind && ent.lightKind !== f.lightKind) return false;
  if (f.nameContains) {
    if (!ent.name.toLowerCase().includes(f.nameContains.toLowerCase())) {
      return false;
    }
  }
  if (f.positionMin) {
    const { x, y, z } = f.positionMin;
    if (x != null && ent.position.x < x) return false;
    if (y != null && ent.position.y < y) return false;
    if (z != null && ent.position.z < z) return false;
  }
  if (f.positionMax) {
    const { x, y, z } = f.positionMax;
    if (x != null && ent.position.x > x) return false;
    if (y != null && ent.position.y > y) return false;
    if (z != null && ent.position.z > z) return false;
  }
  return true;
}

export function queryEntities(filter: EcsFilter = {}): ForgeEcsEntity[] {
  const out: ForgeEcsEntity[] = [];
  for (const ent of world.entities) {
    if (matches(ent, filter)) out.push(ent);
  }
  return out;
}

export function countEntities(filter: EcsFilter = {}): number {
  let n = 0;
  for (const ent of world.entities) {
    if (matches(ent, filter)) n++;
  }
  return n;
}
