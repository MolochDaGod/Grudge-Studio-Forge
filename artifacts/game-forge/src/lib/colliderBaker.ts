/**
 * V-HACD convex-decomposition baker.
 *
 * Backed by `vhacd-js` (a wasm port of the canonical V-HACD library).
 * For concave assets — rooms with interior walls, characters with
 * limbs, U/L-shaped props — V-HACD produces multiple hulls that
 * collectively approximate the concavity. The output flows through
 * the same {@link buildHulls} contract the call sites (Inspector,
 * EntityRenderer, AI tool) already speak: each entry becomes one
 * Rapier `convexHull` collider at runtime.
 *
 * The wasm module is ~6 MB and slow to load, so we import it lazily
 * and cache the decomposer instance across calls. If V-HACD fails to
 * load or throws on a degenerate mesh we fall back to a single
 * `quickhull3d` hull for that mesh so the bake still produces
 * usable colliders.
 *
 * Output shape:
 *
 *   {
 *     hulls: [
 *       { vertices: Float32Array (flat xyz), indices: Uint32Array (tris) },
 *       …
 *     ]
 *   }
 *
 * Stored as a sibling JSON next to the source GLB and pointed to by
 * {@link import("@workspace/scene-schema").PhysicsComponent.collidersAssetId}.
 * EntityRenderer reads it at runtime and emits one Rapier
 * `convexHull` collider per entry.
 */
import * as THREE from "three";

export interface ConvexHull {
  /** Flat xyz vertex buffer (3 floats per vertex). */
  vertices: Float32Array;
  /** Triangle indices into `vertices` (3 per triangle). Optional —
   *  Rapier's `convexHull` collider only needs the vertex set. */
  indices?: Uint32Array;
}

export interface ConvexHullSet {
  hulls: ConvexHull[];
  /** Rough metric so the inspector can show "1 hull, 38 verts" without
   *  re-walking the buffers. */
  totalVerts: number;
}

export interface BuildHullsOptions {
  /** Hard cap on hull count per mesh. Forwarded straight to V-HACD. */
  maxHulls?: number;
  /** Drop hulls below this volume (m³). */
  minHullVolume?: number;
}

/** vhacd-js typings (kept local so this file doesn't leak the dep into
 *  consumers' types). The real package shape is documented in
 *  `vhacd-js/lib/vhacd.d.ts`. */
interface VhacdMesh {
  positions: Float64Array;
  indices: Uint32Array;
}
interface VhacdDecomposer {
  computeConvexHulls(
    mesh: VhacdMesh,
    options?: { maxHulls?: number; maxVerticesPerHull?: number },
  ): VhacdMesh[];
}

let decomposerPromise: Promise<VhacdDecomposer | null> | null = null;
async function getDecomposer(): Promise<VhacdDecomposer | null> {
  if (!decomposerPromise) {
    decomposerPromise = (async () => {
      try {
        // vhacd-js@0.0.1 declares only `"module"` (no `"main"` or
        // `"exports"`), so most resolvers can't find its entry by the
        // bare specifier. Reach into the published lib path directly.
        const mod = (await import("vhacd-js/lib/vhacd.js")) as unknown as {
          ConvexMeshDecomposition: { create(): Promise<VhacdDecomposer> };
        };
        return await mod.ConvexMeshDecomposition.create();
      } catch (err) {
        console.warn(
          "[colliderBaker] vhacd-js failed to load, falling back to quickhull",
          err,
        );
        return null;
      }
    })();
  }
  return decomposerPromise;
}

/** Compute the volume of a closed indexed triangle mesh via the
 *  divergence theorem. Used to drop tiny `minHullVolume` slivers
 *  V-HACD sometimes emits on busy geometry. */
function meshVolume(
  positions: Float32Array | Float64Array,
  indices: Uint32Array,
): number {
  let v = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const ax = positions[ia],
      ay = positions[ia + 1],
      az = positions[ia + 2];
    const bx = positions[ib],
      by = positions[ib + 1],
      bz = positions[ib + 2];
    const cx = positions[ic],
      cy = positions[ic + 1],
      cz = positions[ic + 2];
    v +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return Math.abs(v);
}

/** Build convex hulls for a collection of meshes (typically every
 *  rendered mesh of a GLB after `THREE.SkeletonUtils` flatten). The
 *  result is JSON-serializable through `serializeHullSet`. */
export async function buildHulls(
  meshes: THREE.Mesh[],
  options: BuildHullsOptions = {},
): Promise<ConvexHullSet> {
  if (meshes.length === 0) {
    return { hulls: [], totalVerts: 0 };
  }

  const decomposer = await getDecomposer();
  const hulls: ConvexHull[] = [];
  let totalVerts = 0;

  for (const mesh of meshes) {
    const meshHulls = await buildHullsForMesh(mesh, decomposer, options);
    for (const h of meshHulls) {
      hulls.push(h);
      totalVerts += h.vertices.length / 3;
    }
  }

  return { hulls, totalVerts };
}

/** Bake the world-space triangle soup of `mesh` into convex hulls,
 *  preferring V-HACD and falling back to a single quickhull when the
 *  decomposer is unavailable or rejects the input. */
async function buildHullsForMesh(
  mesh: THREE.Mesh,
  decomposer: VhacdDecomposer | null,
  options: BuildHullsOptions,
): Promise<ConvexHull[]> {
  const geom = mesh.geometry;
  if (!geom || !geom.attributes.position) return [];
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const pos = geom.attributes.position;
  if (pos.count < 4) return [];

  // Bake world-space positions once. V-HACD wants Float64 + Uint32
  // index buffers; the quickhull fallback wants number[][].
  const positions = new Float64Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  const indices = extractIndices(geom, pos.count);

  if (decomposer && indices.length >= 3) {
    let out: VhacdMesh[] | null = null;
    try {
      out = decomposer.computeConvexHulls(
        { positions, indices },
        { maxHulls: options.maxHulls ?? 32 },
      );
    } catch (err) {
      console.warn(
        "[colliderBaker] V-HACD decomposition failed, falling back to quickhull",
        err,
      );
    }
    if (out) {
      // V-HACD ran successfully — honor `minHullVolume` strictly,
      // even when filtering removes everything (callers asked for
      // hulls above that threshold; falling back to one giant hull
      // would be the wrong shape).
      const minVol = options.minHullVolume ?? 0;
      const result: ConvexHull[] = [];
      for (const h of out) {
        if (minVol > 0 && meshVolume(h.positions, h.indices) < minVol) {
          continue;
        }
        result.push({
          vertices: new Float32Array(h.positions),
          indices: new Uint32Array(h.indices),
        });
      }
      return result;
    }
  }

  return quickhullFallback(positions);
}

function extractIndices(
  geom: THREE.BufferGeometry,
  vertexCount: number,
): Uint32Array {
  if (geom.index) {
    const arr = geom.index.array;
    const out = new Uint32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i];
    return out;
  }
  // Non-indexed geometry: synthesize sequential triangle indices.
  const triCount = Math.floor(vertexCount / 3) * 3;
  const out = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) out[i] = i;
  return out;
}

/** Single-hull quickhull3d fallback used when V-HACD is unavailable. */
async function quickhullFallback(
  positions: Float64Array,
): Promise<ConvexHull[]> {
  const qhMod = (await import("quickhull3d")) as unknown as {
    default?: (pts: number[][]) => number[][];
  } & ((pts: number[][]) => number[][]);
  const qh = (qhMod.default ?? qhMod) as (pts: number[][]) => number[][];

  const points: number[][] = [];
  for (let i = 0; i < positions.length; i += 3) {
    points.push([positions[i], positions[i + 1], positions[i + 2]]);
  }
  if (points.length < 4) return [];

  let faces: number[][];
  try {
    faces = qh(points);
  } catch {
    return [];
  }
  if (!faces || faces.length === 0) return [];

  const used = new Set<number>();
  for (const f of faces) for (const idx of f) used.add(idx);
  const remap = new Map<number, number>();
  const verts: number[] = [];
  for (const oldIdx of used) {
    const newIdx = remap.size;
    remap.set(oldIdx, newIdx);
    const p = points[oldIdx];
    verts.push(p[0], p[1], p[2]);
  }
  const tris: number[] = [];
  for (const f of faces) {
    for (let j = 1; j < f.length - 1; j++) {
      tris.push(remap.get(f[0])!, remap.get(f[j])!, remap.get(f[j + 1])!);
    }
  }
  return [
    {
      vertices: new Float32Array(verts),
      indices: new Uint32Array(tris),
    },
  ];
}

/** Pack a hull set into a JSON-friendly shape (Float32Array → number[]
 *  arrays) for upload to R2. The reverse operation is
 *  {@link deserializeHullSet}. */
export function serializeHullSet(set: ConvexHullSet): {
  hulls: { vertices: number[]; indices?: number[] }[];
  totalVerts: number;
} {
  return {
    totalVerts: set.totalVerts,
    hulls: set.hulls.map((h) => ({
      vertices: Array.from(h.vertices),
      indices: h.indices ? Array.from(h.indices) : undefined,
    })),
  };
}

export function deserializeHullSet(json: {
  hulls: { vertices: number[]; indices?: number[] }[];
  totalVerts?: number;
}): ConvexHullSet {
  const hulls = json.hulls.map((h) => ({
    vertices: new Float32Array(h.vertices),
    indices: h.indices ? new Uint32Array(h.indices) : undefined,
  }));
  const totalVerts =
    json.totalVerts ??
    hulls.reduce((acc, h) => acc + h.vertices.length / 3, 0);
  return { hulls, totalVerts };
}
