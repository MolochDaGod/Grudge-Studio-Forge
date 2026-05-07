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
import { useBakeProgress } from "@/store/bakeProgress";
import {
  buildHulls,
  serializeHullSet,
  type BuildHullsOptions,
} from "./colliderBaker";

export interface BakeEntityWarning {
  message: string;
  detail?: string;
}

export type BakeEntityResult =
  | {
      ok: true;
      collidersAssetId: number;
      hulls: number;
      totalVerts: number;
      warnings: BakeEntityWarning[];
    }
  | { ok: false; error: string; warnings: BakeEntityWarning[] };

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
    return {
      ok: false,
      error: "no editor scene mounted — open the 3D viewport first",
      warnings: [],
    };
  const state = useEditor.getState();
  const entity = state.sceneData.entities.find((e) => e.id === entityId);
  if (!entity)
    return { ok: false, error: "entity not found", warnings: [] };

  // EntityRenderer tags its root group via `userData.entityId`, so
  // `getObjectByProperty("entityId", id)` returns nothing — walk
  // explicitly instead.
  let root: THREE.Object3D | undefined;
  scene.traverse((o) => {
    if (root) return;
    const ud = o.userData as { entityId?: string } | undefined;
    if (ud?.entityId === entityId) root = o;
  });
  if (!root)
    return {
      ok: false,
      error: "entity has no rendered geometry yet",
      warnings: [],
    };

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length === 0)
    return { ok: false, error: "no meshes under entity", warnings: [] };

  // Surface progress + worker warnings via the bake-progress store
  // (a floating toast indicator rendered next to the App Toaster). We
  // also collect warnings locally so callers (Inspector, AI tool) can
  // include them in their result/activity-log payload — and we chain
  // any caller-supplied `options.onWarn` so the AI tool's per-entity
  // streaming sink keeps firing.
  const callerOnWarn = options.onWarn;
  const entityName = entity.name || entityId;
  useBakeProgress.getState().begin(entityId, entityName);
  const warnings: BakeEntityWarning[] = [];
  const onWarn = (message: string, detail?: string) => {
    warnings.push({ message, detail });
    useBakeProgress.getState().warn(entityId, message, detail);
    if (callerOnWarn) {
      try {
        callerOnWarn(message, detail);
      } catch (err) {
        // Never let a buggy caller sink derail the bake.
        console.warn("[bakeEntityConvexHulls] caller onWarn threw", err);
      }
    }
  };

  // Strip our local onWarn keys before forwarding so the composed
  // handler is the single sink the worker pool calls back into.
  const {
    onWarn: _drop,
    ..._cleanOptions
  }: BuildHullsOptions = options;
  void _drop;

  // One try/finally guarantees the progress entry always transitions
  // out of `running`, even if any of the post-build mutation calls
  // (cmdUpdateEntity, serializeHullSet, etc.) throw unexpectedly.
  let settled = false;
  try {
    let set;
    try {
      set = await buildHulls(meshes, { ..._cleanOptions, onWarn });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useBakeProgress.getState().finish(entityId, "error", msg);
      settled = true;
      return { ok: false, error: msg, warnings };
    }
    if (set.hulls.length === 0) {
      const msg = "hull builder returned 0 hulls";
      useBakeProgress.getState().finish(entityId, "error", msg);
      settled = true;
      return { ok: false, error: msg, warnings };
    }

    const serialized = serializeHullSet(set);
    w.__colliderHullSets ??= new Map();
    w.__colliderAssetCounter = (w.__colliderAssetCounter ?? 0) + 1;
    const assetId = w.__colliderAssetCounter;
    w.__colliderHullSets.set(assetId, serialized);

    const persistedOpts =
      Object.keys(_cleanOptions).length > 0 ? { ..._cleanOptions } : undefined;
    state.cmdUpdateEntity(entityId, (draft) => {
      draft.physics = {
        ...(draft.physics ?? { bodyType: "fixed", mass: 0 }),
        colliderType: "convex-decomp",
        collidersAssetId: assetId,
        // Always overwrite — clearing every advanced field in the
        // Inspector should drop the previously persisted options so
        // the next bake actually runs with V-HACD defaults.
        colliderBakeOptions: persistedOpts,
      };
    });
    useBakeProgress
      .getState()
      .finish(
        entityId,
        "ok",
        `${set.hulls.length} hull${set.hulls.length === 1 ? "" : "s"} · ${set.totalVerts} verts`,
      );
    settled = true;
    return {
      ok: true,
      collidersAssetId: assetId,
      hulls: set.hulls.length,
      totalVerts: set.totalVerts,
      warnings,
    };
  } finally {
    if (!settled) {
      useBakeProgress
        .getState()
        .finish(entityId, "error", "bake aborted unexpectedly");
    }
  }
}
