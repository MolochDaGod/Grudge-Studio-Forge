/**
 * Shared "bake convex hulls onto an entity" routine used by both the
 * Inspector's "Bake convex decomp" button and the AI
 * `bake_convex_hulls` tool. Centralizes the contract:
 *
 *   - walks the live editor scene for the entity's rendered meshes,
 *   - runs `buildHulls` with the supplied V-HACD options,
 *   - registers the serialized hull set on
 *     `window.__colliderHullSets` keyed by a fresh numeric id,
 *   - patches the entity's `PhysicsComponent` via the CommandStack
 *     so the change is undoable and the EntityRenderer rebuilds.
 *
 * Persists the user-supplied options on
 * `physics.colliderBakeOptions` so re-bakes are reproducible.
 */
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import {
  buildHulls,
  serializeHullSet,
  type BuildHullsOptions,
} from "./colliderBaker";

export type BakeEntityResult =
  | { ok: true; collidersAssetId: number; hulls: number; totalVerts: number }
  | { ok: false; error: string };

export async function bakeEntityConvexHulls(
  entityId: string,
  options: BuildHullsOptions = {},
): Promise<BakeEntityResult> {
  const w = window as unknown as {
    __editorScene?: THREE.Object3D;
    __colliderHullSets?: Map<number, ReturnType<typeof serializeHullSet>>;
    __colliderAssetCounter?: number;
  };
  const scene = w.__editorScene;
  if (!scene)
    return { ok: false, error: "no editor scene mounted — open the 3D viewport first" };
  const state = useEditor.getState();
  if (!state.sceneData.entities.some((e) => e.id === entityId))
    return { ok: false, error: "entity not found" };

  // EntityRenderer tags its root group via `userData.entityId`, so
  // `getObjectByProperty("entityId", id)` returns nothing — walk
  // explicitly instead.
  let root: THREE.Object3D | undefined;
  scene.traverse((o) => {
    if (root) return;
    const ud = o.userData as { entityId?: string } | undefined;
    if (ud?.entityId === entityId) root = o;
  });
  if (!root) return { ok: false, error: "entity has no rendered geometry yet" };

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length === 0) return { ok: false, error: "no meshes under entity" };

  const set = await buildHulls(meshes, options);
  if (set.hulls.length === 0)
    return { ok: false, error: "hull builder returned 0 hulls" };

  const serialized = serializeHullSet(set);
  w.__colliderHullSets ??= new Map();
  w.__colliderAssetCounter = (w.__colliderAssetCounter ?? 0) + 1;
  const assetId = w.__colliderAssetCounter;
  w.__colliderHullSets.set(assetId, serialized);

  const persistedOpts = Object.keys(options).length > 0 ? { ...options } : undefined;
  state.cmdUpdateEntity(entityId, (draft) => {
    draft.physics = {
      ...(draft.physics ?? { bodyType: "fixed", mass: 0 }),
      colliderType: "convex-decomp",
      collidersAssetId: assetId,
      // Always overwrite — clearing every advanced field in the
      // Inspector should drop the previously persisted options so the
      // next bake actually runs with V-HACD defaults.
      colliderBakeOptions: persistedOpts,
    };
  });
  return {
    ok: true,
    collidersAssetId: assetId,
    hulls: set.hulls.length,
    totalVerts: set.totalVerts,
  };
}
