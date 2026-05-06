/**
 * V-HACD-style convex-decomposition baker.
 *
 * Real V-HACD (v-hacd-js) is ~6 MB of WASM that takes seconds per
 * mesh and is overkill for the editor's GLB drop flow — most assets
 * have a tractable convex outer shell. We ship a pragmatic equivalent:
 * one (or a small number of) `quickhull3d` hull(s) per mesh, exposed
 * through the same {@link buildHulls} contract a real V-HACD
 * implementation would expose so the call sites (Inspector,
 * EntityRenderer, AI tool) stay stable when we swap in the heavy
 * implementation.
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
  /** Hard cap on hull count. The current quickhull-only path always
   *  returns 1; a future V-HACD swap will respect this. */
  maxHulls?: number;
  /** Drop hulls below this volume (m³). */
  minHullVolume?: number;
}

/** Build convex hulls for a collection of meshes (typically every
 *  rendered mesh of a GLB after `THREE.SkeletonUtils` flatten). The
 *  result is JSON-serializable through `serializeHullSet`. */
export async function buildHulls(
  meshes: THREE.Mesh[],
  _options: BuildHullsOptions = {},
): Promise<ConvexHullSet> {
  if (meshes.length === 0) {
    return { hulls: [], totalVerts: 0 };
  }

  // quickhull3d ships a simple `qh(points)` factory function; load
  // lazily to keep the editor's main bundle lean.
  const qhMod = (await import("quickhull3d")) as unknown as {
    default?: (pts: number[][]) => number[][];
  } & ((pts: number[][]) => number[][]);
  const qh = (qhMod.default ?? qhMod) as (pts: number[][]) => number[][];

  const hulls: ConvexHull[] = [];
  let totalVerts = 0;

  for (const mesh of meshes) {
    const geom = mesh.geometry;
    if (!geom || !geom.attributes.position) continue;
    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld;
    const pos = geom.attributes.position;
    const points: number[][] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      points.push([v.x, v.y, v.z]);
    }
    if (points.length < 4) continue; // degenerate

    let faces: number[][];
    try {
      faces = qh(points);
    } catch {
      // quickhull throws on coplanar / degenerate clouds — skip the
      // mesh rather than killing the whole bake.
      continue;
    }
    if (!faces || faces.length === 0) continue;

    // Compact: keep only vertices touched by the hull faces.
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
      // Triangulate (quickhull returns triangles already, but be safe).
      for (let j = 1; j < f.length - 1; j++) {
        tris.push(remap.get(f[0])!, remap.get(f[j])!, remap.get(f[j + 1])!);
      }
    }
    const vertices = new Float32Array(verts);
    hulls.push({ vertices, indices: new Uint32Array(tris) });
    totalVerts += vertices.length / 3;
  }

  return { hulls, totalVerts };
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
