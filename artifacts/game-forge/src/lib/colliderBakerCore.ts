/**
 * Pure (no-DOM, no-THREE) convex-decomposition core. Shared by the
 * main-thread fallback in {@link import("./colliderBaker").buildHulls}
 * and by the off-main-thread worker (`colliderBaker.worker.ts`) so the
 * V-HACD / quickhull3d code lives in exactly one place.
 *
 * The input is a "triangle soup" — flat Float64 world-space positions
 * plus a Uint32 index buffer — already extracted from the source
 * `THREE.Mesh` by the main thread. The output matches the
 * `ConvexHull` shape the runtime collider builder consumes.
 */

export interface MeshSoup {
  /** Flat xyz Float64 positions in world space (3 floats per vertex). */
  positions: Float64Array;
  /** Triangle indices into `positions` (3 per triangle). */
  indices: Uint32Array;
}

export interface CoreHull {
  vertices: Float32Array;
  indices?: Uint32Array;
}

/** Fill modes V-HACD supports for voxel interior reconstruction. Mirrors
 *  `vhacd-js`'s `HullFillMode`. Re-declared here (rather than imported
 *  from the public `colliderBaker`) so the worker entry — which only
 *  depends on this core file — stays lean. */
export type CoreHullFillMode = "flood" | "raycast" | "surface";

export interface CoreBakeOptions {
  maxHulls?: number;
  minHullVolume?: number;
  voxelResolution?: number;
  maxVerticesPerHull?: number;
  fillMode?: CoreHullFillMode;
}

/** Optional sink the caller can pass to receive non-fatal warnings.
 *  In the worker these are forwarded back to the main thread; in the
 *  inline fallback they go straight to `console.warn`. */
export type WarnSink = (message: string, detail?: unknown) => void;

interface VhacdMesh {
  positions: Float64Array;
  indices: Uint32Array;
}
interface VhacdOptions {
  maxHulls?: number;
  maxVerticesPerHull?: number;
  voxelResolution?: number;
  fillMode?: CoreHullFillMode;
}
interface VhacdDecomposer {
  computeConvexHulls(mesh: VhacdMesh, options?: VhacdOptions): VhacdMesh[];
}

let decomposerPromise: Promise<VhacdDecomposer | null> | null = null;
/** Lazily load the V-HACD wasm. Cached per realm — i.e. once per
 *  worker, or once on the main thread when running inline. */
export async function getDecomposer(
  warn: WarnSink = defaultWarn,
): Promise<VhacdDecomposer | null> {
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
        warn("vhacd-js failed to load, falling back to quickhull", err);
        return null;
      }
    })();
  }
  return decomposerPromise;
}

/** Bake a single triangle soup into convex hulls, preferring V-HACD
 *  and falling back to a single quickhull3d hull on failure. */
export async function bakeSoup(
  soup: MeshSoup,
  decomposer: VhacdDecomposer | null,
  options: CoreBakeOptions,
  warn: WarnSink = defaultWarn,
): Promise<CoreHull[]> {
  if (soup.positions.length < 12) return []; // <4 vertices
  if (decomposer && soup.indices.length >= 3) {
    let out: VhacdMesh[] | null = null;
    try {
      // Pass through V-HACD options only when set so the documented
      // V-HACD defaults apply — overriding here would silently
      // contradict the Inspector / AI tool descriptions.
      const vhacdOpts: VhacdOptions = {};
      if (options.maxHulls !== undefined) vhacdOpts.maxHulls = options.maxHulls;
      if (options.maxVerticesPerHull !== undefined)
        vhacdOpts.maxVerticesPerHull = options.maxVerticesPerHull;
      if (options.voxelResolution !== undefined)
        vhacdOpts.voxelResolution = options.voxelResolution;
      if (options.fillMode !== undefined) vhacdOpts.fillMode = options.fillMode;
      out = decomposer.computeConvexHulls(
        { positions: soup.positions, indices: soup.indices },
        vhacdOpts,
      );
    } catch (err) {
      warn("V-HACD decomposition failed, falling back to quickhull", err);
    }
    if (out) {
      const minVol = options.minHullVolume ?? 0;
      const result: CoreHull[] = [];
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
  return quickhullFallback(soup.positions);
}

/** Bake a batch of soups into a single hull set. Used by both the
 *  worker entry point and the inline fallback. */
export async function bakeSoups(
  soups: MeshSoup[],
  options: CoreBakeOptions,
  warn: WarnSink = defaultWarn,
): Promise<{ hulls: CoreHull[]; totalVerts: number }> {
  if (soups.length === 0) return { hulls: [], totalVerts: 0 };
  const decomposer = await getDecomposer(warn);
  const hulls: CoreHull[] = [];
  let totalVerts = 0;
  for (const soup of soups) {
    const meshHulls = await bakeSoup(soup, decomposer, options, warn);
    for (const h of meshHulls) {
      hulls.push(h);
      totalVerts += h.vertices.length / 3;
    }
  }
  return { hulls, totalVerts };
}

/** Closed-mesh volume via the divergence theorem. Used to drop tiny
 *  `minHullVolume` slivers V-HACD sometimes emits. */
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

async function quickhullFallback(
  positions: Float64Array,
): Promise<CoreHull[]> {
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

function defaultWarn(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.warn(`[colliderBaker] ${message}`, detail);
  } else {
    console.warn(`[colliderBaker] ${message}`);
  }
}
