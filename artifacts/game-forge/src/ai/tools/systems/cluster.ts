/**
 * Pure spatial-clustering helpers used by `describe_layout`.
 *
 * Kept side-effect free (no React, no zustand, no fetch) so the math can
 * be unit-tested deterministically with a seeded PRNG.
 */

export interface Point3 {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface Cluster {
  /** 1-based label so prompts read naturally ("Cluster 1, 2, …"). */
  index: number;
  /** Centroid (mean) of the cluster members. */
  center: { x: number; y: number; z: number };
  /** Axis-aligned bounding box of the members. */
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  /** Member ids sorted lexicographically for stable output. */
  memberIds: string[];
  /** Mean distance from members to the centroid (proxy for tightness). */
  meanRadius: number;
}

export interface AABB {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** Mulberry32 — tiny seeded PRNG. We need a deterministic seed initializer
 *  so cluster outputs are stable per call (useful for AI continuity and
 *  unit tests). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist2(a: Point3, c: { x: number; y: number; z: number }): number {
  const dx = a.x - c.x;
  const dy = a.y - c.y;
  const dz = a.z - c.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Simple AABB over points; returns a degenerate cube at origin if empty. */
export function bounds(points: readonly Point3[]): AABB {
  if (points.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

/** Mean of all input points (the global centroid). Returns origin for an
 *  empty set so callers don't have to guard. */
export function centroid(points: readonly Point3[]): {
  x: number;
  y: number;
  z: number;
} {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  let sx = 0,
    sy = 0,
    sz = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  const n = points.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

export interface NearestNeighborStats {
  /** Smallest pairwise distance found. */
  min: number;
  /** Largest "nearest distance" — the loneliest entity. */
  max: number;
  /** Mean of every point's distance to its nearest other point. */
  mean: number;
  /** Median — robust against outliers. */
  median: number;
  /** Ids of the closest pair (lexicographically sorted). */
  closestPair: [string, string] | null;
  /** Id of the loneliest entity (largest nearest-distance). */
  loneliest: string | null;
}

/** Brute-force O(N²) nearest-neighbor scan. Fine for the hundreds of
 *  entities a single scene typically holds; no spatial index needed. */
export function nearestNeighborStats(
  points: readonly Point3[],
): NearestNeighborStats {
  if (points.length < 2) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      closestPair: null,
      loneliest: null,
    };
  }
  const nearest: number[] = new Array(points.length).fill(Infinity);
  let closestPair: [string, string] | null = null;
  let bestPair = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d2 = dist2(points[i], points[j]);
      if (d2 < nearest[i]) nearest[i] = d2;
      if (d2 < nearest[j]) nearest[j] = d2;
      if (d2 < bestPair) {
        bestPair = d2;
        const a = points[i].id;
        const b = points[j].id;
        closestPair = a < b ? [a, b] : [b, a];
      }
    }
  }
  const dists = nearest.map((v) => Math.sqrt(v));
  let loneliestIdx = 0;
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] > dists[loneliestIdx]) loneliestIdx = i;
  }
  const sorted = [...dists].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  let sum = 0;
  for (const d of dists) sum += d;
  return {
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(sum / dists.length),
    median: round(median),
    closestPair,
    loneliest: points[loneliestIdx].id,
  };
}

/** k-means++ seeding — picks the first center at random, then each subsequent
 *  center weighted by squared distance to the nearest already-chosen one.
 *  This is the standard "smart" init; vs random it gives better clusters in
 *  far fewer iterations on small N. */
function kmeansppInit(
  points: readonly Point3[],
  k: number,
  rand: () => number,
): { x: number; y: number; z: number }[] {
  const centers: { x: number; y: number; z: number }[] = [];
  const first = Math.floor(rand() * points.length);
  centers.push({ x: points[first].x, y: points[first].y, z: points[first].z });
  while (centers.length < k) {
    let total = 0;
    const weights = points.map((p) => {
      let nearest = Infinity;
      for (const c of centers) {
        const d = dist2(p, c);
        if (d < nearest) nearest = d;
      }
      total += nearest;
      return nearest;
    });
    if (total === 0) {
      // All remaining points are duplicates — break early; downstream
      // empty-cluster reseed will handle it.
      centers.push({ x: points[0].x, y: points[0].y, z: points[0].z });
      continue;
    }
    let target = rand() * total;
    let pick = 0;
    for (let i = 0; i < weights.length; i++) {
      target -= weights[i];
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centers.push({ x: points[pick].x, y: points[pick].y, z: points[pick].z });
  }
  return centers;
}

export interface ClusterOpts {
  /** Hard cap on K to try; we elbow-pick within [1..maxK]. */
  maxK?: number;
  /** Seed for the internal PRNG so output is deterministic. Defaults to 1. */
  seed?: number;
  /** Max Lloyd iterations per K. */
  iterations?: number;
}

interface KmeansRun {
  k: number;
  /** Cluster assignment per input point (index into points). */
  assignments: number[];
  centers: { x: number; y: number; z: number }[];
  /** Sum of squared distances from each point to its assigned centroid. */
  inertia: number;
}

function runKmeans(
  points: readonly Point3[],
  k: number,
  rand: () => number,
  iterations: number,
): KmeansRun {
  const centers = kmeansppInit(points, k, rand);
  const assignments = new Array<number>(points.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    // Assign step.
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(points[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }
    // Update step.
    const sums = centers.map(() => ({ x: 0, y: 0, z: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assignments[i]];
      s.x += points[i].x;
      s.y += points[i].y;
      s.z += points[i].z;
      s.n += 1;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c].n === 0) {
        // Reseed empty cluster on a random point so K stays honored.
        const reseed = points[Math.floor(rand() * points.length)];
        centers[c] = { x: reseed.x, y: reseed.y, z: reseed.z };
      } else {
        centers[c] = {
          x: sums[c].x / sums[c].n,
          y: sums[c].y / sums[c].n,
          z: sums[c].z / sums[c].n,
        };
      }
    }
    if (!moved && it > 0) break;
  }
  let inertia = 0;
  for (let i = 0; i < points.length; i++) {
    inertia += dist2(points[i], centers[assignments[i]]);
  }
  return { k, assignments, centers, inertia };
}

/**
 * Cluster `points` into K groups, choosing K via the elbow heuristic over
 * [1..maxK]. Returns `{clusters, k, allInertias}` for transparency.
 *
 * Elbow rule used: the K whose marginal improvement (inertia[k-1] - inertia[k])
 * first drops below 30% of the *first* improvement. Falls back to maxK if no
 * elbow is found (i.e. spread is genuinely uniform across K). For small N
 * (<= maxK) we just return one cluster per point.
 */
export function clusterPoints(
  points: readonly Point3[],
  opts: ClusterOpts = {},
): { clusters: Cluster[]; k: number; inertias: number[] } {
  const seed = opts.seed ?? 1;
  const iterations = opts.iterations ?? 16;
  const maxK = Math.max(1, Math.min(opts.maxK ?? 6, points.length));
  if (points.length === 0) return { clusters: [], k: 0, inertias: [] };

  const rand = mulberry32(seed);
  const runs: KmeansRun[] = [];
  for (let k = 1; k <= maxK; k++) {
    runs.push(runKmeans(points, k, rand, iterations));
  }
  const inertias = runs.map((r) => r.inertia);

  // Pick K via elbow.
  let chosenK = maxK;
  if (runs.length >= 2) {
    const improvements: number[] = [];
    for (let i = 1; i < inertias.length; i++) {
      improvements.push(Math.max(0, inertias[i - 1] - inertias[i]));
    }
    const first = improvements[0] ?? 0;
    if (first > 0) {
      for (let i = 0; i < improvements.length; i++) {
        if (improvements[i] < first * 0.3) {
          chosenK = i + 1; // first poor improvement → previous K is the elbow
          break;
        }
      }
    } else {
      chosenK = 1;
    }
  }

  const winner = runs[chosenK - 1];
  const grouped: Point3[][] = winner.centers.map(() => []);
  for (let i = 0; i < points.length; i++) {
    grouped[winner.assignments[i]].push(points[i]);
  }
  const clusters: Cluster[] = [];
  for (let c = 0; c < winner.centers.length; c++) {
    const members = grouped[c];
    if (members.length === 0) continue;
    const center = winner.centers[c];
    const aabb = bounds(members);
    let sumR = 0;
    for (const m of members) sumR += Math.sqrt(dist2(m, center));
    clusters.push({
      index: c + 1,
      center: { x: round(center.x), y: round(center.y), z: round(center.z) },
      bounds: {
        min: roundXYZ(aabb.min),
        max: roundXYZ(aabb.max),
      },
      memberIds: members.map((m) => m.id).sort(),
      meanRadius: round(sumR / members.length),
    });
  }
  // Sort clusters left→right by centroid X for stable output.
  clusters.sort((a, b) => a.center.x - b.center.x);
  for (let i = 0; i < clusters.length; i++) clusters[i].index = i + 1;
  return { clusters, k: clusters.length, inertias };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function roundXYZ(p: { x: number; y: number; z: number }) {
  return { x: round(p.x), y: round(p.y), z: round(p.z) };
}
