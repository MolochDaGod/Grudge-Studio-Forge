/**
 * GLB hierarchy walker.
 *
 * Two jobs, same loader:
 *   1. `loadGlbTopLevelNodes` — named top-level children as locators
 *      (legacy "Expose Children" for Spawn_* / Cover_* empties).
 *   2. `loadGlbPullableNodes` / `collectPullableMeshes` — every renderable
 *      mesh in an *asset* GLB as a real child entity (isolate + parentId)
 *      so each mesh can move, script, edit, and deploy on its own.
 *
 * Play kits (SkinnedMesh + ≥8 bones) and map shells stay fused.
 */

import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { extendGltfLoader } from "@/lib/gltfLoaderConfig";

export interface GlbChildNode {
  /** Unique entity display name (uniquified if the GLB repeats a mesh name). */
  name: string;
  /** Original Object3D.name (may be empty). */
  meshName?: string;
  /**
   * Isolate key stored on `model.subNode`. Unique mesh names stay readable;
   * unnamed / duplicate meshes use `#ordinal` (index among pullable meshes).
   */
  subNode?: string;
  /** Index among pullable meshes (same walk as `findPullableMesh`). */
  ordinal?: number;
  /** Nearest pullable ancestor mesh, or null if this sits on the pack root. */
  parentOrdinal?: number | null;
  kind?: "mesh" | "group" | "skinned";
  position: [number, number, number];
  /** Euler XYZ (radians). */
  rotation: [number, number, number];
  scale: [number, number, number];
}

let SHARED_LOADER: GLTFLoader | null = null;
function getSharedLoader(): GLTFLoader {
  if (SHARED_LOADER) return SHARED_LOADER;
  SHARED_LOADER = new GLTFLoader();
  // Wire DRACO + Meshopt decoders so this loader can read compressed GLBs
  // just like drei's `useGLTF` over in EntityRenderer. Cast through unknown:
  // three.js and three-stdlib ship the same runtime class with divergent .d.ts.
  extendGltfLoader(SHARED_LOADER as unknown as Parameters<typeof extendGltfLoader>[0]);
  return SHARED_LOADER;
}
/** In-flight de-duplication: if two callers ask for the same URL while a
 *  load is pending, they share one fetch. The entry is removed once the
 *  promise settles (success or failure) so we don't pin large GLB scenes in
 *  memory after the caller has consumed the TRS records, and so the next call
 *  re-fetches (which is cheap thanks to the browser's HTTP cache + drei's
 *  `useGLTF` cache that EntityRenderer also populates). */
const inflightLoads = new Map<string, Promise<THREE.Object3D>>();

/** Load (or return cached if pending) a GLB scene root for the given URL. */
async function loadSceneRoot(rawUrl: string): Promise<THREE.Object3D> {
  const { resolveModelUrl } = await import("@/lib/builtinModels");
  const url = resolveModelUrl(rawUrl);
  const pending = inflightLoads.get(url);
  if (pending) return pending;
  const p = new Promise<THREE.Object3D>((resolve, reject) => {
    getSharedLoader().load(
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

const MAP_SHELL = /pirate-islands|map-mistytown|map-cyberpunk|map-encampment|map-fort|map-underground|map-pirate/i;

/** Lobby / Chicken Gun plates stay one map entity — do not pull every tile. */
export function isMapShellUrl(url: string): boolean {
  return MAP_SHELL.test(url);
}

export function isSkinnedPlayKit(root: THREE.Object3D): boolean {
  let skinned = 0;
  let bones = 0;
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) skinned += 1;
    const b = o as THREE.Bone;
    if (b.isBone) bones += 1;
  });
  return skinned >= 1 && bones >= 8;
}

function isRenderableMesh(o: THREE.Object3D): boolean {
  const t = (o as { type?: string }).type;
  return t === "Mesh" || t === "InstancedMesh";
}

/** Static asset mesh we can isolate. Skinned play-kit parts stay on the body. */
export function isPullableMesh(o: THREE.Object3D): boolean {
  if (!isRenderableMesh(o)) return false;
  if ((o as THREE.Bone).isBone) return false;
  if ((o as THREE.SkinnedMesh).isSkinnedMesh) return false;
  const raw = (o.name || "").trim();
  if (/^(Bip001|mixamo|mixamorig|Armature|Skeleton)/i.test(raw)) return false;
  return true;
}

function relativeTRS(
  root: THREE.Object3D,
  node: THREE.Object3D,
): Pick<GlbChildNode, "position" | "rotation" | "scale"> {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4().multiplyMatrices(inv, node.matrixWorld);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  local.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return {
    position: [p.x, p.y, p.z],
    rotation: [e.x, e.y, e.z],
    scale: [s.x, s.y, s.z],
  };
}

export const MAX_PULL_MESHES = 128;

export function subNodeRefFor(meshName: string, ordinal: number, sameNameCount: number): string {
  const n = meshName.trim();
  if (!n || sameNameCount > 1) return `#${ordinal}`;
  return n;
}

/** Same walk order as `collectPullableMeshes`. `ref` is a name or `#ordinal`. */
export function findPullableMesh(root: THREE.Object3D, ref: string): THREE.Object3D | null {
  const want = ref.trim();
  if (!want) return null;
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (isPullableMesh(o)) meshes.push(o);
  });
  const ordinalMatch = /^#(\d+)$/.exec(want);
  if (ordinalMatch) return meshes[Number(ordinalMatch[1])] ?? null;
  return meshes.find((o) => o.name === want) ?? null;
}

export function collectPullableMeshes(root: THREE.Object3D): GlbChildNode[] {
  return collectPullableMeshesResult(root).nodes;
}

export function collectPullableMeshesResult(root: THREE.Object3D): {
  nodes: GlbChildNode[];
  truncated: boolean;
} {
  const meshes: THREE.Object3D[] = [];
  let truncated = false;
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!isPullableMesh(o)) return;
    if (meshes.length >= MAX_PULL_MESHES) {
      truncated = true;
      return;
    }
    meshes.push(o);
  });
  const nameCount = new Map<string, number>();
  for (const o of meshes) {
    const raw = (o.name || "").trim();
    if (!raw) continue;
    nameCount.set(raw, (nameCount.get(raw) ?? 0) + 1);
  }
  const meshIndex = new Map<THREE.Object3D, number>();
  meshes.forEach((o, i) => meshIndex.set(o, i));
  const used = new Set<string>();
  const nodes: GlbChildNode[] = meshes.map((o, i) => {
    const meshName = (o.name || "").trim();
    const raw = meshName || `Mesh_${i + 1}`;
    let name = raw;
    let n = 2;
    while (used.has(name)) {
      name = `${raw}_${n}`;
      n += 1;
    }
    used.add(name);
    const subNode = subNodeRefFor(meshName, i, nameCount.get(meshName) ?? 0);
    let parentOrdinal: number | null = null;
    let trsRoot = root;
    let walk: THREE.Object3D | null = o.parent;
    while (walk && walk !== root) {
      const idx = meshIndex.get(walk);
      if (idx !== undefined) {
        parentOrdinal = idx;
        trsRoot = walk;
        break;
      }
      walk = walk.parent;
    }
    return {
      name,
      meshName,
      subNode,
      ordinal: i,
      parentOrdinal,
      kind: "mesh" as const,
      ...relativeTRS(trsRoot, o),
    };
  });
  return { nodes, truncated };
}

export async function loadGlbPullableNodes(url: string): Promise<{
  skinned: boolean;
  mapShell: boolean;
  truncated: boolean;
  nodes: GlbChildNode[];
}> {
  const mapShell = isMapShellUrl(url);
  const root = await loadSceneRoot(url);
  const skinned = isSkinnedPlayKit(root);
  if (mapShell || skinned) return { skinned, mapShell, truncated: false, nodes: [] };
  const { nodes, truncated } = collectPullableMeshesResult(root);
  return { skinned, mapShell, truncated, nodes };
}
