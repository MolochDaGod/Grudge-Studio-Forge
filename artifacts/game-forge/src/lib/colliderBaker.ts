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
 * The wasm module is ~6 MB and a single bake on a busy GLB can take
 * several seconds, so the heavy work runs **off the main thread** in
 * a small pool of dedicated Web Workers (`colliderBaker.worker.ts`).
 * Each worker loads the wasm exactly once and is reused across calls,
 * which keeps the editor — viewport, undo, AI chat — interactive
 * while a bake is in flight and lets independent bakes run in
 * parallel up to {@link MAX_WORKERS}.
 *
 * The pure decomposition logic (V-HACD + quickhull3d fallback) lives
 * in `./colliderBakerCore` and is shared between the worker entry
 * point and the inline fallback used in environments without a
 * `Worker` constructor (Node-based unit tests, SSR).
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
import {
  bakeSoups,
  type CoreBakeOptions,
  type CoreHull,
  type MeshSoup,
} from "./colliderBakerCore";

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

/** Fill modes V-HACD supports for voxel interior reconstruction. Mirrors
 *  `vhacd-js`'s `HullFillMode` so consumers don't need to import the dep. */
export type HullFillMode = "flood" | "raycast" | "surface";

export interface BuildHullsOptions {
  /** Hard cap on hull count per mesh. Forwarded straight to V-HACD.
   *  V-HACD default: 64. */
  maxHulls?: number;
  /** Drop hulls below this volume (m³). */
  minHullVolume?: number;
  /** Voxel grid resolution V-HACD uses to approximate the source mesh.
   *  Higher = finer detail and slower bake. V-HACD default: 400000. */
  voxelResolution?: number;
  /** Cap on vertices in any single output hull. V-HACD default: 64. */
  maxVerticesPerHull?: number;
  /** How V-HACD fills the voxel interior. `flood` (default) is fastest
   *  but assumes a watertight mesh; `raycast` is robust for open meshes;
   *  `surface` treats the mesh as hollow and only decomposes its skin. */
  fillMode?: HullFillMode;
  /** Optional sink for non-fatal warnings (load failures, V-HACD
   *  rejections that fell back to quickhull). Routed verbatim from
   *  the worker. Defaults to `console.warn`. */
  onWarn?: (message: string, detail?: string) => void;
}

/** Build convex hulls for a collection of meshes (typically every
 *  rendered mesh of a GLB after `THREE.SkeletonUtils` flatten). The
 *  result is JSON-serializable through `serializeHullSet`.
 *
 *  Mesh extraction (world-space vertex baking + index extraction) is
 *  cheap and runs on the caller's thread; the actual V-HACD compute
 *  is dispatched to a worker so the editor stays interactive. */
export async function buildHulls(
  meshes: THREE.Mesh[],
  options: BuildHullsOptions = {},
): Promise<ConvexHullSet> {
  if (meshes.length === 0) {
    return { hulls: [], totalVerts: 0 };
  }

  const soups: MeshSoup[] = [];
  for (const mesh of meshes) {
    const soup = extractSoup(mesh);
    if (soup) soups.push(soup);
  }
  if (soups.length === 0) return { hulls: [], totalVerts: 0 };

  const coreOptions: CoreBakeOptions = {
    maxHulls: options.maxHulls,
    minHullVolume: options.minHullVolume,
    voxelResolution: options.voxelResolution,
    maxVerticesPerHull: options.maxVerticesPerHull,
    fillMode: options.fillMode,
  };
  const { hulls, totalVerts } = await dispatchBake(
    soups,
    coreOptions,
    options.onWarn,
  );
  return {
    hulls: hulls as ConvexHull[],
    totalVerts,
  };
}

/** Bake `mesh` into a world-space triangle soup the worker can eat.
 *  Done on the caller's thread because we need live `THREE.Mesh`
 *  references — but it's just buffer copies, not heavy compute. */
function extractSoup(mesh: THREE.Mesh): MeshSoup | null {
  const geom = mesh.geometry;
  if (!geom || !geom.attributes.position) return null;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const pos = geom.attributes.position;
  if (pos.count < 4) return null;

  const positions = new Float64Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  const indices = extractIndices(geom, pos.count);
  return { positions, indices };
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

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

const MAX_WORKERS = (() => {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.max(1, Math.min(3, navigator.hardwareConcurrency - 1));
  }
  return 1;
})();

interface PendingJob {
  resolve: (value: { hulls: CoreHull[]; totalVerts: number }) => void;
  reject: (err: Error) => void;
  onWarn?: (message: string, detail?: string) => void;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

let pool: PoolWorker[] | null = null;
const pending = new Map<number, PendingJob>();
const queue: Array<{
  soups: MeshSoup[];
  options: CoreBakeOptions;
  job: PendingJob;
}> = [];
let nextJobId = 1;

function workersAvailable(): boolean {
  return typeof Worker !== "undefined";
}

function ensurePool(): PoolWorker[] {
  if (!pool) pool = [];
  return pool;
}

/** Set after a `new Worker(...)` throws — prevents thrashing the
 *  spawn path on every subsequent bake when (e.g.) the browser
 *  blocks worker creation. Once set, all dispatch goes inline. */
let workerSpawnDisabled = false;

function spawnWorker(): PoolWorker | null {
  if (workerSpawnDisabled) return null;
  try {
    const w = new Worker(
      new URL("./colliderBaker.worker.ts", import.meta.url),
      { type: "module" },
    );
    const entry: PoolWorker = { worker: w, busy: false };
    w.onmessage = (ev: MessageEvent) => {
      const data = ev.data as
        | {
            id: number;
            type: "result";
            hulls: CoreHull[];
            totalVerts: number;
          }
        | { id: number; type: "error"; error: string }
        | {
            id: number;
            type: "warn";
            message: string;
            detail?: string;
          };
      const job = pending.get(data.id);
      if (!job) return;
      if (data.type === "warn") {
        if (job.onWarn) job.onWarn(data.message, data.detail);
        else if (data.detail !== undefined) {
          console.warn(`[colliderBaker] ${data.message}`, data.detail);
        } else {
          console.warn(`[colliderBaker] ${data.message}`);
        }
        return;
      }
      pending.delete(data.id);
      entry.busy = false;
      if (data.type === "result") {
        job.resolve({ hulls: data.hulls, totalVerts: data.totalVerts });
      } else {
        job.reject(new Error(data.error));
      }
      drainQueue();
    };
    w.onerror = (ev) => {
      // Fail all jobs assigned to this worker. The pool removes the
      // dead worker; subsequent jobs will spawn a fresh one — and
      // any queued jobs that can't get a worker after this will
      // fall back to the inline path via drainQueue().
      entry.busy = false;
      const err = new Error(ev.message || "collider baker worker crashed");
      for (const [id, job] of pending) {
        // We don't track per-worker job ownership, so fail all
        // outstanding jobs to be safe — a crashed wasm runtime taints
        // everything in flight.
        pending.delete(id);
        job.reject(err);
      }
      const idx = (pool ?? []).indexOf(entry);
      if (idx >= 0) (pool ?? []).splice(idx, 1);
      try {
        w.terminate();
      } catch {
        // ignore
      }
      // Make sure no queued job is stranded by the crash — either
      // re-spawn a worker for it or run it inline.
      drainQueue();
    };
    return entry;
  } catch (err) {
    console.warn(
      "[colliderBaker] failed to spawn worker, falling back to main thread",
      err,
    );
    workerSpawnDisabled = true;
    return null;
  }
}

function pickIdleWorker(): PoolWorker | null {
  const p = ensurePool();
  for (const entry of p) {
    if (!entry.busy) return entry;
  }
  if (p.length < MAX_WORKERS) {
    const fresh = spawnWorker();
    if (fresh) {
      p.push(fresh);
      return fresh;
    }
  }
  return null;
}

function dispatchToWorker(
  entry: PoolWorker,
  soups: MeshSoup[],
  options: CoreBakeOptions,
  job: PendingJob,
): void {
  entry.busy = true;
  const id = nextJobId++;
  pending.set(id, job);
  const transfers: ArrayBuffer[] = [];
  for (const s of soups) {
    transfers.push(
      s.positions.buffer as ArrayBuffer,
      s.indices.buffer as ArrayBuffer,
    );
  }
  try {
    entry.worker.postMessage({ id, soups, options }, transfers);
  } catch (err) {
    pending.delete(id);
    entry.busy = false;
    job.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Run a job inline on the calling thread. Used when no worker is
 *  available (Node/SSR), spawning failed permanently, or a worker
 *  crash left a queued job with nowhere to go. */
function runInline(
  soups: MeshSoup[],
  options: CoreBakeOptions,
  job: PendingJob,
): void {
  bakeSoups(soups, options, (msg, detail) => {
    if (job.onWarn) {
      job.onWarn(msg, detail === undefined ? undefined : String(detail));
    } else if (detail !== undefined) {
      console.warn(`[colliderBaker] ${msg}`, detail);
    } else {
      console.warn(`[colliderBaker] ${msg}`);
    }
  }).then(job.resolve, job.reject);
}

function drainQueue(): void {
  while (queue.length > 0) {
    const entry = pickIdleWorker();
    if (entry) {
      const next = queue.shift()!;
      dispatchToWorker(entry, next.soups, next.options, next.job);
      continue;
    }
    // No idle worker. If the pool is empty (spawn failed/disabled),
    // fall back inline for every queued job so they don't strand.
    if (ensurePool().length === 0) {
      while (queue.length > 0) {
        const next = queue.shift()!;
        runInline(next.soups, next.options, next.job);
      }
      return;
    }
    // Otherwise live workers are just busy — wait for completions
    // to call drainQueue() again.
    return;
  }
}

async function dispatchBake(
  soups: MeshSoup[],
  options: CoreBakeOptions,
  onWarn?: (message: string, detail?: string) => void,
): Promise<{ hulls: CoreHull[]; totalVerts: number }> {
  return new Promise((resolve, reject) => {
    const job: PendingJob = { resolve, reject, onWarn };
    if (!workersAvailable()) {
      runInline(soups, options, job);
      return;
    }
    const entry = pickIdleWorker();
    if (entry) {
      dispatchToWorker(entry, soups, options, job);
      return;
    }
    // No idle worker. If the pool has live workers (all busy at
    // cap), queue and wait for one to free. If the pool is empty
    // (spawn failed/disabled), run inline now — queueing would
    // hang forever with nothing to drain it.
    if (ensurePool().length === 0) {
      runInline(soups, options, job);
    } else {
      queue.push({ soups, options, job });
    }
  });
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
