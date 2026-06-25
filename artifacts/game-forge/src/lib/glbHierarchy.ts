/**
 * GLB hierarchy walker.
 *
 * Loads a GLB / glTF and returns the *top-level named children* of its scene
 * graph as plain TRS records. Used by the editor's "Expose Children" action
 * to materialise GLB sub-nodes as proxy SceneEntities so users can target
 * them by name (Spawn_*, Cover_*, Door_*, …) and so scripts / AI can use the
 * scene-graph traversal API (`ctx.scene.childrenOf`, `worldPosition`).
 *
 * Notes:
 *   • We deliberately stop at the first level of named children. Walking
 *     deeper would create a flood of locator entities for skeletal nodes
 *     and individual mesh primitives. Users who need deeper exposure can
 *     re-run the action on a child later (each child knows its own URL).
 *   • Anonymous nodes (`name === ""`) are skipped — they're rarely useful
 *     as locators and usually represent internal glTF plumbing.
 *   • Loading goes through drei's `useGLTF.preload` cache when available,
 *     otherwise we fall back to a one-shot `GLTFLoader.parse` so the editor
 *     UI doesn't have to wait for React to render the model first.
 */

import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { extendGltfLoader } from "@/lib/gltfLoaderConfig";
import { resolveModelUrl } from "@/lib/builtinModels";

export interface GlbChildNode {
  /** glTF node name. Guaranteed non-empty (anonymous nodes are filtered). */
  name: string;
  position: [number, number, number];
  /** Euler XYZ (radians). */
  rotation: [number, number, number];
  scale: [number, number, number];
}

const SHARED_LOADER = new GLTFLoader();
// Wire DRACO + Meshopt decoders so this loader can read compressed GLBs
// just like drei's `useGLTF` over in EntityRenderer. Cast to the
// three.js (vs three-stdlib) GLTFLoader type since they share the same
// runtime class but ship subtly different .d.ts files in pnpm.
// reason: three.js and three-stdlib ship the same runtime GLTFLoader class
// under subtly different .d.ts declarations in pnpm; cast through unknown
// to bridge the structural mismatch. See note above.
extendGltfLoader(SHARED_LOADER as unknown as Parameters<typeof extendGltfLoader>[0]);
/** In-flight de-duplication: if two callers ask for the same URL while a
 *  load is pending, they share one fetch. The entry is removed once the
 *  promise settles (success or failure) so we don't pin large GLB scenes in
 *  memory after the caller has consumed the TRS records, and so the next call
 *  re-fetches (which is cheap thanks to the browser's HTTP cache + drei's
 *  `useGLTF` cache that EntityRenderer also populates). */
const inflightLoads = new Map<string, Promise<THREE.Object3D>>();

/** Load (or return cached if pending) a GLB scene root for the given URL. */
function loadSceneRoot(rawUrl: string): Promise<THREE.Object3D> {
  const url = resolveModelUrl(rawUrl);
  const pending = inflightLoads.get(url);
  if (pending) return pending;
  const p = new Promise<THREE.Object3D>((resolve, reject) => {
    SHARED_LOADER.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  inflightLoads.set(url, p);
  // Drop on settle — both success and failure — so a fresh call re-fetches
  // and the loaded scene root is eligible for GC once the caller releases it.
  p.then(
    () => inflightLoads.delete(url),
    () => inflightLoads.delete(url),
  );
  return p;
}

/**
 * Load `url` and return one record per named top-level child of `gltf.scene`.
 * Returns an empty array if the file has no named children (still a valid
 * outcome — the caller decides how to surface that to the user).
 */
/** Heuristic for "is this single node just a wrapper around the real top-level
 *  scene?". True iff:
 *   • the wrapper itself carries no renderable geometry (not a Mesh/SkinnedMesh /
 *     LineSegments / Points), AND
 *   • it has children of its own to descend into.
 *  This is broader than name-matching ("Scene", "RootNode", "Sketchfab_model",
 *  "Armature", "Game", custom export roots) and matches the actual structural
 *  contract: wrappers don't render. */
function isWrapperNode(o: THREE.Object3D): boolean {
  if (o.children.length === 0) return false;
  // Renderable types that we should NOT descend through.
  const t = (o as { type?: string }).type;
  if (
    t === "Mesh" ||
    t === "SkinnedMesh" ||
    t === "InstancedMesh" ||
    t === "LineSegments" ||
    t === "Line" ||
    t === "Points"
  ) {
    return false;
  }
  return true;
}

export async function loadGlbTopLevelNodes(url: string): Promise<GlbChildNode[]> {
  const root = await loadSceneRoot(url);
  // Some GLBs wrap everything in a single Group; if so, descend ONCE so the
  // exposed locators correspond to what users see in their DCC tool's outliner.
  let nodes = root.children;
  if (nodes.length === 1 && isWrapperNode(nodes[0])) {
    nodes = nodes[0].children;
  }
  const out: GlbChildNode[] = [];
  for (const c of nodes) {
    if (!c.name) continue;
    out.push({
      name: c.name,
      position: [c.position.x, c.position.y, c.position.z],
      rotation: [c.rotation.x, c.rotation.y, c.rotation.z],
      scale: [c.scale.x, c.scale.y, c.scale.z],
    });
  }
  return out;
}
