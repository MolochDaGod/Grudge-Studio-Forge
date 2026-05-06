/**
 * Pure, deterministic layout generators used by the design tools. No
 * React, no zustand, no THREE — just math, so unit tests can pin
 * outputs to seeded RNG values.
 *
 * Each generator returns `Vec3[]` positions. The tool layer wraps them
 * into SceneEntity objects via the editor store.
 */

export type Vec3 = [number, number, number];

/** Mulberry32 — tiny seeded PRNG (matches systems/cluster.ts). */
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

export interface GridOpts {
  count: number;
  spacing?: number;
  /** Force a specific column count; otherwise sqrt(count) ceiling. */
  cols?: number;
  origin?: Vec3;
  /** When true, distribute on the XZ ground plane (Y is constant). Default true. */
  ground?: boolean;
  /** Y for the ground/origin plane. Default origin[1]. */
  yLevel?: number;
}

/** Square-ish grid centered on origin. */
export function gridLayout(o: GridOpts): Vec3[] {
  const n = Math.max(0, Math.floor(o.count));
  if (n === 0) return [];
  const spacing = o.spacing ?? 2;
  const cols = Math.max(1, Math.floor(o.cols ?? Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  const ox = o.origin?.[0] ?? 0;
  const oy = o.yLevel ?? o.origin?.[1] ?? 0;
  const oz = o.origin?.[2] ?? 0;
  const ground = o.ground !== false;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const dx = (c - (cols - 1) / 2) * spacing;
    const dz = (r - (rows - 1) / 2) * spacing;
    out.push(ground ? [ox + dx, oy, oz + dz] : [ox + dx, oy + dz, oz]);
  }
  return out;
}

export interface RingOpts {
  count: number;
  radius?: number;
  origin?: Vec3;
  /** Start angle in radians (0 = +X). Default 0. */
  startAngle?: number;
  /** Total arc to cover in radians. Default 2π (full circle). */
  arc?: number;
}

export function ringLayout(o: RingOpts): Vec3[] {
  const n = Math.max(0, Math.floor(o.count));
  if (n === 0) return [];
  const r = o.radius ?? 6;
  const ox = o.origin?.[0] ?? 0;
  const oy = o.origin?.[1] ?? 0;
  const oz = o.origin?.[2] ?? 0;
  const start = o.startAngle ?? 0;
  const arc = o.arc ?? Math.PI * 2;
  // For a full circle, divide by n; for an arc, place endpoints inclusive
  // when n>1.
  const isFull = Math.abs(arc - Math.PI * 2) < 1e-6;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = isFull ? i / n : n > 1 ? i / (n - 1) : 0;
    const a = start + arc * t;
    out.push([ox + Math.cos(a) * r, oy, oz + Math.sin(a) * r]);
  }
  return out;
}

export interface LineOpts {
  count: number;
  spacing?: number;
  origin?: Vec3;
  /** Direction vector (will be normalized). Default [1,0,0]. */
  direction?: Vec3;
}

export function lineLayout(o: LineOpts): Vec3[] {
  const n = Math.max(0, Math.floor(o.count));
  if (n === 0) return [];
  const spacing = o.spacing ?? 2;
  const ox = o.origin?.[0] ?? 0;
  const oy = o.origin?.[1] ?? 0;
  const oz = o.origin?.[2] ?? 0;
  const dir = o.direction ?? [1, 0, 0];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / len;
  const dy = dir[1] / len;
  const dz = dir[2] / len;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i - (n - 1) / 2;
    out.push([ox + dx * spacing * t, oy + dy * spacing * t, oz + dz * spacing * t]);
  }
  return out;
}

export interface ScatterOpts {
  count: number;
  /** Half-extent of the scatter box on XZ. Default 10. */
  radius?: number;
  origin?: Vec3;
  /** Minimum spacing between samples (Poisson-like rejection). Default 1. */
  minSpacing?: number;
  seed?: number;
}

/** Poisson-disc-ish scatter via uniform sampling + rejection. Bounded
 *  attempt count keeps it fast and deterministic for a given seed. */
export function scatterLayout(o: ScatterOpts): Vec3[] {
  const n = Math.max(0, Math.floor(o.count));
  if (n === 0) return [];
  const radius = o.radius ?? 10;
  const minSpacing = Math.max(0, o.minSpacing ?? 1);
  const min2 = minSpacing * minSpacing;
  const ox = o.origin?.[0] ?? 0;
  const oy = o.origin?.[1] ?? 0;
  const oz = o.origin?.[2] ?? 0;
  const rng = mulberry32(o.seed ?? 1);
  const out: Vec3[] = [];
  const maxAttempts = n * 30;
  let attempts = 0;
  while (out.length < n && attempts < maxAttempts) {
    attempts++;
    const x = ox + (rng() * 2 - 1) * radius;
    const z = oz + (rng() * 2 - 1) * radius;
    let ok = true;
    if (min2 > 0) {
      for (const p of out) {
        const dx = p[0] - x;
        const dz = p[2] - z;
        if (dx * dx + dz * dz < min2) {
          ok = false;
          break;
        }
      }
    }
    if (ok) out.push([x, oy, z]);
  }
  return out;
}

export interface ClusterOpts {
  count: number;
  /** Number of cluster centers. Default 3. */
  clusters?: number;
  /** Half-extent of the field within which centers are placed. Default 12. */
  fieldRadius?: number;
  /** Standard-deviation-ish spread of points around each center. Default 1.5. */
  clusterRadius?: number;
  origin?: Vec3;
  seed?: number;
}

/** K-cluster scatter: pick K centers, distribute remaining points around
 *  them with a small jitter. Output count is exactly `count` (the centers
 *  count toward the total). */
export function clusterLayout(o: ClusterOpts): Vec3[] {
  const n = Math.max(0, Math.floor(o.count));
  if (n === 0) return [];
  const k = Math.max(1, Math.floor(o.clusters ?? 3));
  const fieldR = o.fieldRadius ?? 12;
  const clusterR = o.clusterRadius ?? 1.5;
  const ox = o.origin?.[0] ?? 0;
  const oy = o.origin?.[1] ?? 0;
  const oz = o.origin?.[2] ?? 0;
  const rng = mulberry32(o.seed ?? 1);
  const centers: Array<[number, number]> = [];
  for (let i = 0; i < k; i++) {
    centers.push([
      ox + (rng() * 2 - 1) * fieldR,
      oz + (rng() * 2 - 1) * fieldR,
    ]);
  }
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const c = centers[i % k];
    // Box-Muller for cheap gaussian-ish jitter.
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1)) * clusterR;
    const theta = 2 * Math.PI * u2;
    out.push([c[0] + r * Math.cos(theta), oy, c[1] + r * Math.sin(theta)]);
  }
  return out;
}

export type LayoutKind = "grid" | "ring" | "line" | "scatter" | "cluster";
