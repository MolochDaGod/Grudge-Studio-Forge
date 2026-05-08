import {
  DEFAULT_WIND,
  type SoftBodyComponent,
  type Vec3,
} from "@workspace/scene-schema";
import type { SceneEntity } from "./types";

/** Pure helpers for the cloth / flag verlet integrator and the
 *  particle pool emitter. Extracted from `SoftBodies.tsx` so they can
 *  be unit-tested without spinning up an R3F renderer. */

export interface VerletGrid {
  positions: Float32Array;
  previous: Float32Array;
  pinned: Uint8Array;
  rest: { a: number; b: number; len: number }[];
  initial: Float32Array;
  cols: number;
  rows: number;
}

export function buildGrid(
  cols: number,
  rows: number,
  width: number,
  height: number,
  pinFn: (i: number, j: number) => boolean,
): VerletGrid {
  const n = cols * rows;
  const positions = new Float32Array(n * 3);
  const previous = new Float32Array(n * 3);
  const pinned = new Uint8Array(n);
  const initial = new Float32Array(n * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const x = (i / (cols - 1) - 0.5) * width;
      // y axis runs from +height/2 (top, j=0) to -height/2 (bottom)
      // so "pin top" = pin row 0.
      const y = (0.5 - j / (rows - 1)) * height;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = 0;
      previous[idx * 3] = x;
      previous[idx * 3 + 1] = y;
      previous[idx * 3 + 2] = 0;
      initial[idx * 3] = x;
      initial[idx * 3 + 1] = y;
      initial[idx * 3 + 2] = 0;
      pinned[idx] = pinFn(i, j) ? 1 : 0;
    }
  }
  const rest: { a: number; b: number; len: number }[] = [];
  const dx = width / (cols - 1);
  const dy = height / (rows - 1);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (i + 1 < cols) rest.push({ a: idx, b: idx + 1, len: dx });
      if (j + 1 < rows) rest.push({ a: idx, b: idx + cols, len: dy });
      if (i + 1 < cols && j + 1 < rows) {
        const diag = Math.hypot(dx, dy);
        rest.push({ a: idx, b: idx + cols + 1, len: diag });
        rest.push({ a: idx + 1, b: idx + cols, len: diag });
      }
    }
  }
  return { positions, previous, pinned, rest, initial, cols, rows };
}

/** Verlet step in *local* space. The caller supplies the per-frame
 *  acceleration already rotated into the entity's local frame. */
export function stepVerlet(
  g: VerletGrid,
  dt: number,
  damping: number,
  ax: number,
  ay: number,
  az: number,
  iterations = 3,
): void {
  const h = Math.min(dt, 1 / 30);
  const dragFactor = Math.max(0, 1 - damping * h);
  const axh = ax * h * h;
  const ayh = ay * h * h;
  const azh = az * h * h;
  const p = g.positions;
  const prev = g.previous;
  const pinned = g.pinned;
  const init = g.initial;
  const n = pinned.length;
  for (let i = 0; i < n; i++) {
    if (pinned[i]) {
      p[i * 3] = init[i * 3];
      p[i * 3 + 1] = init[i * 3 + 1];
      p[i * 3 + 2] = init[i * 3 + 2];
      prev[i * 3] = init[i * 3];
      prev[i * 3 + 1] = init[i * 3 + 1];
      prev[i * 3 + 2] = init[i * 3 + 2];
      continue;
    }
    const ix = i * 3;
    const iy = ix + 1;
    const iz = ix + 2;
    const cx = p[ix];
    const cy = p[iy];
    const cz = p[iz];
    const vx = (cx - prev[ix]) * dragFactor;
    const vy = (cy - prev[iy]) * dragFactor;
    const vz = (cz - prev[iz]) * dragFactor;
    p[ix] = cx + vx + axh;
    p[iy] = cy + vy + ayh;
    p[iz] = cz + vz + azh;
    prev[ix] = cx;
    prev[iy] = cy;
    prev[iz] = cz;
  }
  for (let it = 0; it < iterations; it++) {
    for (const r of g.rest) {
      const ax2 = r.a * 3;
      const bx2 = r.b * 3;
      const dx = p[bx2] - p[ax2];
      const dy = p[bx2 + 1] - p[ax2 + 1];
      const dz = p[bx2 + 2] - p[ax2 + 2];
      const dist = Math.hypot(dx, dy, dz) || 1e-6;
      const diff = (dist - r.len) / dist;
      const pa = pinned[r.a];
      const pb = pinned[r.b];
      if (pa && pb) continue;
      const wA = pa ? 0 : pb ? 1 : 0.5;
      const wB = pb ? 0 : pa ? 1 : 0.5;
      p[ax2] += dx * diff * wA;
      p[ax2 + 1] += dy * diff * wA;
      p[ax2 + 2] += dz * diff * wA;
      p[bx2] -= dx * diff * wB;
      p[bx2 + 1] -= dy * diff * wB;
      p[bx2 + 2] -= dz * diff * wB;
    }
  }
}

/** A simplified collider snapshot used by the cloth/flag collision
 *  pass. We deliberately don't read Rapier directly — the scene tree
 *  already exposes everything we need (transform + entity type). */
export interface SoftCollider {
  /** Sphere if `kind === "sphere"`, otherwise a box (axis-aligned when
   *  `rot` is omitted, oriented when `rot` carries a non-identity
   *  quaternion). */
  kind: "sphere" | "box";
  /** World-space center. */
  cx: number; cy: number; cz: number;
  /** Sphere: world-space radius (rx === ry === rz).
   *  Box: half-extents along the collider's *local* axes (when oriented
   *  via `rot`) or world axes (when `rot` is absent). */
  rx: number; ry: number; rz: number;
  /** Optional unit quaternion `[x,y,z,w]` rotating *local→world* for
   *  oriented boxes. Spheres ignore rotation. When omitted, the box is
   *  treated as axis-aligned (cheap fast path used by tests + legacy
   *  callers). */
  rot?: [number, number, number, number];
  /** Source entity id (when the collider was attached to a Rapier
   *  rigid body whose `userData.entityId` was stamped by EntityRenderer).
   *  Used by the soft-body gather pass to dedup the scene-tree fallback
   *  so a single dynamic entity doesn't appear at both its current
   *  Rapier position AND its stale author-time transform. */
  entityId?: string;
}

/** Convert a three.js-style XYZ Euler (radians) to a unit quaternion
 *  `[x,y,z,w]`. Matches `THREE.Quaternion.setFromEuler(_, "XYZ")` so
 *  oriented boxes derived from `transform.rotation` line up with the
 *  rendered mesh. Returns `undefined` when the Euler is the identity
 *  so callers can short-circuit to the AABB fast path. */
export function quatFromEulerXYZ(
  ex: number,
  ey: number,
  ez: number,
): [number, number, number, number] | undefined {
  if (ex === 0 && ey === 0 && ez === 0) return undefined;
  const c1 = Math.cos(ex / 2);
  const c2 = Math.cos(ey / 2);
  const c3 = Math.cos(ez / 2);
  const s1 = Math.sin(ex / 2);
  const s2 = Math.sin(ey / 2);
  const s3 = Math.sin(ez / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Build a flat collider list from the scene snapshot. We treat each
 *  static-shaped entity (box/sphere/cylinder/plane/model) as a coarse
 *  AABB or sphere derived from its transform.scale. Soft entity types
 *  + the entity itself are skipped so cloth doesn't self-collide.
 *
 *  This is intentionally cheap and approximate — verlet cloth doesn't
 *  need exact contact, and a coarse pass keeps the collision step
 *  O(verts × colliders) small for typical scenes (< 100 colliders). */
export function snapshotColliders(
  entities: ReadonlyArray<SceneEntity>,
  selfId: string,
): SoftCollider[] {
  const out: SoftCollider[] = [];
  for (const e of entities) {
    if (e.id === selfId) continue;
    if (e.type === "cloth" || e.type === "flag" || e.type === "particles") continue;
    if (e.type === "light" || e.type === "camera" || e.type === "empty") continue;
    const [px, py, pz] = e.transform.position;
    const [sx, sy, sz] = e.transform.scale;
    const [rxe, rye, rze] = e.transform.rotation;
    const rot = quatFromEulerXYZ(rxe, rye, rze);
    if (e.type === "sphere") {
      // Default sphereGeometry radius = 0.5, scale = uniform.
      // Spheres are rotation-invariant so `rot` is intentionally unset.
      const r = 0.5 * Math.max(sx, sy, sz);
      out.push({ kind: "sphere", cx: px, cy: py, cz: pz, rx: r, ry: r, rz: r, entityId: e.id });
    } else if (e.type === "plane") {
      // Plane = a thin slab. Use a small Y half-extent so cloth can
      // rest on top of it without disappearing through.
      out.push({
        kind: "box",
        cx: px,
        cy: py,
        cz: pz,
        rx: 0.5 * Math.abs(sx),
        ry: 0.05,
        rz: 0.5 * Math.abs(sz),
        rot,
        entityId: e.id,
      });
    } else {
      // box / cylinder / model — coarse OBB sized off the entity's
      // local-1 default extents (1×1×1) times its scale, oriented by
      // its transform.rotation so cloth drapes over tilted props.
      out.push({
        kind: "box",
        cx: px,
        cy: py,
        cz: pz,
        rx: 0.5 * Math.abs(sx),
        ry: 0.5 * Math.abs(sy),
        rz: 0.5 * Math.abs(sz),
        rot,
        entityId: e.id,
      });
    }
  }
  return out;
}

/** Minimal structural shape of the live Rapier world we read from
 *  during play mode. We deliberately type this loosely so the helper
 *  stays unit-testable with a hand-rolled stub (no rapier wasm boot
 *  required in vitest). */
export interface RapierLikeWorld {
  forEachCollider(fn: (c: RapierLikeCollider) => void): void;
}
export interface RapierLikeCollider {
  isSensor(): boolean;
  translation(): { x: number; y: number; z: number };
  /** Optional — real Rapier colliders return the world-space rotation
   *  as a quaternion. We treat it as identity when missing so existing
   *  hand-rolled stubs (and tests) keep working. */
  rotation?(): { x: number; y: number; z: number; w: number };
  parent(): { userData?: unknown } | null;
  shape: {
    type?: number;
    halfExtents?: { x: number; y: number; z: number };
    radius?: number;
    halfHeight?: number;
  };
}

/** Read a Rapier collider's rotation as a `[x,y,z,w]` quaternion, or
 *  `undefined` when it's the identity (so the AABB fast path applies).
 *  Tolerates collider stubs without a `rotation()` method. */
function readRapierRot(
  c: RapierLikeCollider,
): [number, number, number, number] | undefined {
  if (typeof c.rotation !== "function") return undefined;
  const q = c.rotation();
  if (!q) return undefined;
  if (q.x === 0 && q.y === 0 && q.z === 0 && (q.w === 1 || q.w === -1)) {
    return undefined;
  }
  return [q.x, q.y, q.z, q.w];
}

/** Snapshot Rapier's live collider list into the same {@link SoftCollider}
 *  shape used by the verlet collision pass. Pulls **dynamic** body
 *  positions from the running physics step (so a cloth tossed onto a
 *  moving crate stays on top of it), not the scene-tree author-time
 *  transform. Static colliders are included too — when both this and
 *  {@link snapshotColliders} fire, the caller can just concatenate;
 *  duplicate AABBs are no-ops in {@link projectOutOfColliders}.
 *
 *  The entity-bearing rigid body's `userData.entityId` is checked so
 *  the cloth/flag/particle entity itself can be excluded if it ever
 *  acquires a Rapier body. Decorative colliders without an entity ID
 *  are kept (they still block cloth — same rule the raycast uses). */
export function snapshotRapierColliders(
  world: RapierLikeWorld | null | undefined,
  selfId: string,
): SoftCollider[] {
  const out: SoftCollider[] = [];
  if (!world) return out;
  world.forEachCollider((c) => {
    if (c.isSensor()) return;
    const ud = c.parent()?.userData as { entityId?: string } | undefined;
    const entityId = ud?.entityId;
    if (entityId && entityId === selfId) return;
    const t = c.translation();
    const sh = c.shape;
    const rot = readRapierRot(c);
    // Cuboid (rapier shape type 1) → straight half-extents.
    if (sh.halfExtents) {
      out.push({
        kind: "box",
        cx: t.x,
        cy: t.y,
        cz: t.z,
        rx: Math.abs(sh.halfExtents.x),
        ry: Math.abs(sh.halfExtents.y),
        rz: Math.abs(sh.halfExtents.z),
        rot,
        entityId,
      });
      return;
    }
    // Capsule / Cylinder / RoundCylinder → tight box around the shaft.
    if (typeof sh.halfHeight === "number" && typeof sh.radius === "number") {
      const r = Math.abs(sh.radius);
      out.push({
        kind: "box",
        cx: t.x,
        cy: t.y,
        cz: t.z,
        rx: r,
        ry: Math.abs(sh.halfHeight) + r,
        rz: r,
        rot,
        entityId,
      });
      return;
    }
    // Ball → sphere (rotation-invariant).
    if (typeof sh.radius === "number") {
      const r = Math.abs(sh.radius);
      out.push({ kind: "sphere", cx: t.x, cy: t.y, cz: t.z, rx: r, ry: r, rz: r, entityId });
      return;
    }
    // Unknown shape (trimesh / convex hull / heightfield) — fall back
    // to a unit AABB at the collider origin. Authors with custom hulls
    // can still rely on the scene-tree snapshot path for accuracy.
    out.push({ kind: "box", cx: t.x, cy: t.y, cz: t.z, rx: 0.5, ry: 0.5, rz: 0.5, rot, entityId });
  });
  return out;
}

/** Build the per-frame collider list. Pulls live AABBs from the Rapier
 *  world (so dynamic bodies that have moved since the scene snapshot
 *  are included) and overlays the scene-tree fallback for entities
 *  that don't have a Rapier body yet (static decoration not stamped
 *  with a PhysicsComponent, or edit mode where `world` is null).
 *
 *  Dedup: any entity already present in the Rapier snapshot (via
 *  `userData.entityId`) is excluded from the scene-tree fallback so a
 *  dynamic crate that has drifted at runtime doesn't appear at BOTH
 *  its current and stale author-time positions.
 *
 *  Pure / no React deps so it can be unit-tested without booting R3F. */
export function gatherSoftColliders(
  world: RapierLikeWorld | null | undefined,
  entities: ReadonlyArray<SceneEntity>,
  selfId: string,
): SoftCollider[] {
  const live = snapshotRapierColliders(world, selfId);
  if (live.length === 0) return snapshotColliders(entities, selfId);
  const seen = new Set<string>();
  for (const c of live) if (c.entityId) seen.add(c.entityId);
  const fallback = snapshotColliders(entities, selfId).filter(
    (c) => !c.entityId || !seen.has(c.entityId),
  );
  return [...live, ...fallback];
}

/** Project a single world-space point out of any collider it has
 *  penetrated. Updates the point in place; returns true if any
 *  resolution happened (so the verlet `previous` slot can be reset
 *  to kill velocity along the contact normal — prevents jitter). */
export function projectOutOfColliders(
  pt: { x: number; y: number; z: number },
  colliders: ReadonlyArray<SoftCollider>,
): boolean {
  let hit = false;
  for (const c of colliders) {
    if (c.kind === "sphere") {
      const dx = pt.x - c.cx;
      const dy = pt.y - c.cy;
      const dz = pt.z - c.cz;
      const d = Math.hypot(dx, dy, dz);
      if (d < c.rx && d > 1e-6) {
        const inv = c.rx / d;
        pt.x = c.cx + dx * inv;
        pt.y = c.cy + dy * inv;
        pt.z = c.cz + dz * inv;
        hit = true;
      } else if (d <= 1e-6) {
        // Coincident with center — push straight up.
        pt.y = c.cy + c.ry;
        hit = true;
      }
    } else if (!c.rot) {
      // Axis-aligned fast path.
      const dx = pt.x - c.cx;
      const dy = pt.y - c.cy;
      const dz = pt.z - c.cz;
      const ox = c.rx - Math.abs(dx);
      const oy = c.ry - Math.abs(dy);
      const oz = c.rz - Math.abs(dz);
      if (ox > 0 && oy > 0 && oz > 0) {
        // Inside the box — push out along the axis of least penetration.
        if (ox <= oy && ox <= oz) {
          pt.x = c.cx + (dx >= 0 ? c.rx : -c.rx);
        } else if (oy <= ox && oy <= oz) {
          pt.y = c.cy + (dy >= 0 ? c.ry : -c.ry);
        } else {
          pt.z = c.cz + (dz >= 0 ? c.rz : -c.rz);
        }
        hit = true;
      }
    } else {
      // Oriented box. Rotate the world-space offset into the box's
      // local frame (via q⁻¹), do the same axis-of-least-penetration
      // push there, then rotate the resolved local point back to
      // world space (via q).
      //
      // We use the standard "rotate vector by unit quaternion" formula
      //   v' = 2·(u·v)·u + (2w² − 1)·v + 2w·(u × v)
      // with u = (qx,qy,qz), w = qw. For the inverse (q⁻¹), the cross
      // term flips sign (u → −u; the dot-product term is even in u).
      const wx = pt.x - c.cx;
      const wy = pt.y - c.cy;
      const wz = pt.z - c.cz;
      const [qx, qy, qz, qw] = c.rot;
      const dot = qx * wx + qy * wy + qz * wz;
      const k = 2 * qw * qw - 1;
      // local = q⁻¹ * v * q  (cross sign flipped vs forward rotation)
      const lx = 2 * dot * qx + k * wx - 2 * qw * (qy * wz - qz * wy);
      const ly = 2 * dot * qy + k * wy - 2 * qw * (qz * wx - qx * wz);
      const lz = 2 * dot * qz + k * wz - 2 * qw * (qx * wy - qy * wx);
      const ox = c.rx - Math.abs(lx);
      const oy = c.ry - Math.abs(ly);
      const oz = c.rz - Math.abs(lz);
      if (ox > 0 && oy > 0 && oz > 0) {
        let rlx = lx;
        let rly = ly;
        let rlz = lz;
        if (ox <= oy && ox <= oz) rlx = lx >= 0 ? c.rx : -c.rx;
        else if (oy <= ox && oy <= oz) rly = ly >= 0 ? c.ry : -c.ry;
        else rlz = lz >= 0 ? c.rz : -c.rz;
        // world = q * local * q⁻¹  (forward rotation)
        const dot2 = qx * rlx + qy * rly + qz * rlz;
        const wxr = 2 * dot2 * qx + k * rlx + 2 * qw * (qy * rlz - qz * rly);
        const wyr = 2 * dot2 * qy + k * rly + 2 * qw * (qz * rlx - qx * rlz);
        const wzr = 2 * dot2 * qz + k * rlz + 2 * qw * (qx * rly - qy * rlx);
        pt.x = c.cx + wxr;
        pt.y = c.cy + wyr;
        pt.z = c.cz + wzr;
        hit = true;
      }
    }
  }
  return hit;
}

// ── Particle pool ───────────────────────────────────────────────────

export interface ParticlePool {
  positions: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  alive: Uint8Array;
  capacity: number;
}

export function makeParticlePool(capacity: number): ParticlePool {
  return {
    positions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    ages: new Float32Array(capacity),
    alive: new Uint8Array(capacity),
    capacity,
  };
}

function findFreeSlot(pool: ParticlePool): number {
  for (let i = 0; i < pool.capacity; i++) if (!pool.alive[i]) return i;
  // Pool saturated — recycle the oldest live particle.
  let oldest = 0;
  let maxAge = -1;
  for (let i = 0; i < pool.capacity; i++) {
    if (pool.ages[i] > maxAge) {
      maxAge = pool.ages[i];
      oldest = i;
    }
  }
  return oldest;
}

export interface SpawnConfig {
  windX: number;
  windY: number;
  windZ: number;
  emitVelocity: number;
  /** Scratch random source — defaults to `Math.random`. Tests inject
   *  a deterministic generator. */
  rand?: () => number;
}

export function spawnParticle(pool: ParticlePool, cfg: SpawnConfig): number {
  const rand = cfg.rand ?? Math.random;
  const slot = findFreeSlot(pool);
  pool.positions[slot * 3] = (rand() - 0.5) * 0.2;
  pool.positions[slot * 3 + 1] = 0;
  pool.positions[slot * 3 + 2] = (rand() - 0.5) * 0.2;
  pool.velocities[slot * 3] = cfg.windX * 0.5 + (rand() - 0.5) * 0.3;
  pool.velocities[slot * 3 + 1] = cfg.emitVelocity + rand() * 0.4;
  pool.velocities[slot * 3 + 2] = cfg.windZ * 0.5 + (rand() - 0.5) * 0.3;
  pool.ages[slot] = 0;
  pool.alive[slot] = 1;
  return slot;
}

/** Resolved emitter parameters with defaults applied. */
export interface ResolvedEmitter {
  mode: "continuous" | "burst";
  emitRate: number;
  lifetime: number;
  emitVelocity: number;
  damping: number;
  burstCount: number;
  burstInterval: number;
  capacity: number;
  collideGround: boolean;
  /** Bounciness on contact, 0…1. 0 = slide (inward velocity zeroed),
   *  > 0 = reflect inward component scaled by this factor. */
  bounciness: number;
}

export function resolveEmitter(
  sb: SoftBodyComponent | undefined,
  matDrag: number,
  matRestitution = 0,
): ResolvedEmitter {
  const mode = sb?.mode ?? "continuous";
  const emitRate = Math.max(0, sb?.emitRate ?? 20);
  const lifetime = Math.max(0.1, sb?.lifetime ?? 2);
  const burstCount = Math.max(1, Math.round(sb?.burstCount ?? 30));
  const burstInterval = Math.max(0.05, sb?.burstInterval ?? 1);
  const steadyState =
    mode === "burst" ? burstCount : Math.ceil(emitRate * lifetime);
  return {
    mode,
    emitRate,
    lifetime,
    emitVelocity: sb?.emitVelocity ?? 1.5,
    damping: sb?.damping ?? matDrag,
    burstCount,
    burstInterval,
    capacity: Math.max(8, steadyState + 16),
    collideGround: sb?.collideGround ?? false,
    bounciness: Math.max(0, Math.min(1, sb?.bounciness ?? matRestitution)),
  };
}

export interface EmitState {
  /** Continuous: fractional emit accumulator. Burst: time-since-last-burst. */
  accum: number;
  /** Burst-only — set true after the first burst so we can fire one
   *  immediately on the first tick. */
  fired: boolean;
}

/** Advance the emitter — spawns new particles if it's time. Returns
 *  the number of particles spawned this tick. Pure (no R3F deps). */
export function tickEmitter(
  pool: ParticlePool,
  state: EmitState,
  cfg: ResolvedEmitter,
  spawn: SpawnConfig,
  dt: number,
): number {
  let spawned = 0;
  if (cfg.mode === "burst") {
    if (!state.fired) {
      // Fire an opening burst the very first tick so users see motion
      // immediately rather than waiting `burstInterval` seconds.
      for (let k = 0; k < cfg.burstCount; k++) {
        spawnParticle(pool, spawn);
        spawned++;
      }
      state.fired = true;
      state.accum = 0;
      return spawned;
    }
    state.accum += dt;
    while (state.accum >= cfg.burstInterval) {
      state.accum -= cfg.burstInterval;
      for (let k = 0; k < cfg.burstCount; k++) {
        spawnParticle(pool, spawn);
        spawned++;
      }
    }
  } else {
    state.accum += cfg.emitRate * dt;
    while (state.accum >= 1) {
      state.accum -= 1;
      spawnParticle(pool, spawn);
      spawned++;
    }
  }
  return spawned;
}

/** Project a single live particle out of any collider it has
 *  penetrated. When `out` reports a hit, the inward (normal-aligned)
 *  velocity component is reflected back out scaled by `bounciness`
 *  (0 = pure slide / kill the inward component, 1 = elastic bounce),
 *  while the tangential component is preserved and bled by `friction`.
 *  Pure helper exported for unit testing. */
export function collideParticle(
  pool: ParticlePool,
  i: number,
  colliders: ReadonlyArray<SoftCollider>,
  friction = 0.7,
  bounciness = 0,
): boolean {
  if (colliders.length === 0) return false;
  const ix = i * 3;
  const px = pool.positions[ix];
  const py = pool.positions[ix + 1];
  const pz = pool.positions[ix + 2];
  const scratch = { x: px, y: py, z: pz };
  if (!projectOutOfColliders(scratch, colliders)) return false;
  pool.positions[ix] = scratch.x;
  pool.positions[ix + 1] = scratch.y;
  pool.positions[ix + 2] = scratch.z;
  const dx = scratch.x - px;
  const dy = scratch.y - py;
  const dz = scratch.z - pz;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-6) {
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const vx = pool.velocities[ix];
    const vy = pool.velocities[ix + 1];
    const vz = pool.velocities[ix + 2];
    const vn = vx * nx + vy * ny + vz * nz;
    if (vn < 0) {
      // Split velocity into tangential (slide) + normal (inward)
      // components. The tangent is bled by friction so particles don't
      // skate forever; the normal is reflected back out scaled by
      // bounciness — 0 zeroes it (pure slide), 1 is fully elastic.
      const b = Math.max(0, Math.min(1, bounciness));
      const tx = (vx - vn * nx) * friction;
      const ty = (vy - vn * ny) * friction;
      const tz = (vz - vn * nz) * friction;
      pool.velocities[ix] = tx - vn * nx * b;
      pool.velocities[ix + 1] = ty - vn * ny * b;
      pool.velocities[ix + 2] = tz - vn * nz * b;
    }
  }
  return true;
}

/** Per-particle integration step: ages, drag, gravity, wind. Returns
 *  the upper bound of the live index range so the renderer can limit
 *  the buffer drawRange. When `colliders` is provided and the emitter
 *  has `collideGround:true`, each live particle is projected out of
 *  intersecting colliders after its position update so it slides along
 *  the contact surface. */
export function tickParticles(
  pool: ParticlePool,
  cfg: ResolvedEmitter,
  windX: number,
  windY: number,
  windZ: number,
  dt: number,
  colliders?: ReadonlyArray<SoftCollider>,
): { live: number; maxIdx: number } {
  const h = Math.min(dt, 1 / 20);
  const dragFactor = Math.max(0, 1 - cfg.damping * h);
  const gy = -1.5 + windY * 0.5;
  // Wind biases mid-flight velocity slightly — matches the spawn-time
  // bias so a sustained wind keeps particles drifting along it.
  const biasX = windX * 0.5 * h;
  const biasZ = windZ * 0.5 * h;
  let live = 0;
  let maxIdx = 0;
  for (let i = 0; i < pool.capacity; i++) {
    if (!pool.alive[i]) continue;
    pool.ages[i] += h;
    if (pool.ages[i] >= cfg.lifetime) {
      pool.alive[i] = 0;
      pool.positions[i * 3 + 1] = -10000;
      continue;
    }
    const ix = i * 3;
    pool.velocities[ix] = pool.velocities[ix] * dragFactor + biasX;
    pool.velocities[ix + 1] = pool.velocities[ix + 1] * dragFactor + gy * h;
    pool.velocities[ix + 2] = pool.velocities[ix + 2] * dragFactor + biasZ;
    pool.positions[ix] += pool.velocities[ix] * h;
    pool.positions[ix + 1] += pool.velocities[ix + 1] * h;
    pool.positions[ix + 2] += pool.velocities[ix + 2] * h;
    if (cfg.collideGround && colliders && colliders.length > 0) {
      collideParticle(pool, i, colliders, 0.7, cfg.bounciness);
    }
    live++;
    if (i + 1 > maxIdx) maxIdx = i + 1;
  }
  return { live, maxIdx };
}

/** Read the wind vector with the project default. */
export function readWindVec(env: { wind?: Vec3 }): Vec3 {
  return env.wind ?? DEFAULT_WIND;
}
