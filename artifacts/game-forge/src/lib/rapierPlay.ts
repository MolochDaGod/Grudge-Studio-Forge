/**
 * Rapier play helpers — kinematic CCT + physics rays.
 * Same world as Forge <Physics>. SI metres. Do not add a second engine.
 *
 * CCT: autostep, snap-to-ground, slide, push dynamics.
 * Rays: feet / LOS hit colliders (not THREE mesh AABB).
 */

import type { RaycastHit } from "@/scene/csTranspile";

/** Same shape as PlayRuntime.MaterialRayFilter — keep this file free of PlayRuntime imports. */
export interface MaterialRayFilter {
  requireBlocksLineOfSight?: boolean;
  requireBlocksProjectiles?: boolean;
  requireBlocksAudio?: boolean;
  kinds?: string[];
}

export interface GroundProbeHit {
  point: [number, number, number];
  distance: number;
  normal: [number, number, number];
  surface: string;
  entityId: string | null;
}

/** Humanoid capsule — 1.8 m: 2*half + 2*r. */
export const PLAY_CCT = {
  offset: 0.01,
  radius: 0.32,
  halfHeight: 0.58,
  mass: 70,
  autostepHeight: 0.4,
  autostepMinWidth: 0.2,
  snapDistance: 0.5,
  maxSlopeClimb: (50 * Math.PI) / 180,
  minSlopeSlide: (35 * Math.PI) / 180,
  jumpSpeed: 5.4,
} as const;

export type Vec3Like = { x: number; y: number; z: number };

export type RapierNsLike = {
  Ray: new (orig: Vec3Like, dir: Vec3Like) => unknown;
  Capsule?: new (halfHeight: number, radius: number) => unknown;
  Ball?: new (radius: number) => unknown;
  Cylinder?: new (halfHeight: number, radius: number) => unknown;
  JointData?: {
    revolute?: (anchor1: Vec3Like, anchor2: Vec3Like, axis: Vec3Like) => unknown;
    spherical?: (anchor1: Vec3Like, anchor2: Vec3Like) => unknown;
  };
  QueryFilterFlags?: { EXCLUDE_SENSORS?: number };
};

export type RapierColliderLike = {
  parent?: () => RapierBodyLike | null;
  handle?: number;
};

export type RapierBodyLike = {
  translation: () => Vec3Like;
  linvel?: () => Vec3Like;
  setNextKinematicTranslation?: (t: Vec3Like) => void;
  setTranslation?: (t: Vec3Like, wake: boolean) => void;
  numColliders?: () => number;
  collider?: (i: number) => RapierColliderLike;
  applyImpulse?: (imp: Vec3Like, wake: boolean) => void;
  applyImpulseAtPoint?: (imp: Vec3Like, point: Vec3Like, wake: boolean) => void;
  wakeUp?: () => void;
  isSleeping?: () => boolean;
  setBodyType?: (t: number, wake: boolean) => void;
  setEnabledRotations?: (x: boolean, y: boolean, z: boolean, wake: boolean) => void;
  setGravityScale?: (s: number, wake: boolean) => void;
  setLinvel?: (v: Vec3Like, wake: boolean) => void;
  setAngvel?: (v: Vec3Like, wake: boolean) => void;
  mass?: () => number;
  bodyType?: () => number;
  userData?: {
    entityId?: string;
    name?: string;
    layer?: string;
    surface?: string;
    material?: string;
    materialDensity?: number;
    materialBlocksLineOfSight?: boolean;
    materialBlocksProjectiles?: boolean;
    materialBlocksAudio?: boolean;
  };
};

export type RapierCctLike = {
  setApplyImpulsesToDynamicBodies?: (v: boolean) => void;
  setCharacterMass?: (m: number) => void;
  enableAutostep?: (h: number, w: number, dynamic: boolean) => void;
  enableSnapToGround?: (d: number) => void;
  setMaxSlopeClimbAngle?: (a: number) => void;
  setMinSlopeSlideAngle?: (a: number) => void;
  setSlideEnabled?: (v: boolean) => void;
  computeColliderMovement: (collider: unknown, desired: Vec3Like) => void;
  computedMovement: () => Vec3Like;
  computedGrounded: () => boolean;
};

export type RapierWorldLike = {
  createCharacterController: (offset: number) => RapierCctLike;
  removeCharacterController?: (c: RapierCctLike) => void;
  castRay: (...args: unknown[]) => unknown;
  castRayAndGetNormal?: (...args: unknown[]) => unknown;
  castShape?: (...args: unknown[]) => unknown;
  bodies?: { forEach: (fn: (b: RapierBodyLike) => void) => void };
  createImpulseJoint?: (params: unknown, a: RapierBodyLike, b: RapierBodyLike, wake: boolean) => unknown;
  takeSnapshot?: () => Uint8Array;
  debugRender?: () => { vertices: Float32Array; colors: Float32Array };
};

export const CONTACT = {
  landing: 350,
  stagger: 1400,
  ragdoll: 4500,
  knockDecay: 8,
} as const;

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

export function configurePlayCct(cct: RapierCctLike): RapierCctLike {
  cct.setApplyImpulsesToDynamicBodies?.(true);
  cct.setCharacterMass?.(PLAY_CCT.mass);
  cct.enableAutostep?.(PLAY_CCT.autostepHeight, PLAY_CCT.autostepMinWidth, true);
  cct.enableSnapToGround?.(PLAY_CCT.snapDistance);
  cct.setMaxSlopeClimbAngle?.(PLAY_CCT.maxSlopeClimb);
  cct.setMinSlopeSlideAngle?.(PLAY_CCT.minSlopeSlide);
  cct.setSlideEnabled?.(true);
  return cct;
}

export function firstCollider(body: RapierBodyLike): RapierColliderLike | null {
  const n = body.numColliders?.() ?? 0;
  if (n < 1 || !body.collider) return null;
  return body.collider(0) ?? null;
}

export function stepPlayCct(opts: {
  controller: RapierCctLike;
  body: RapierBodyLike;
  desiredVel: Vec3Like;
  dt: number;
  gravityY: number;
  jumpSpeed: number;
  wantJump: boolean;
  climbing: boolean;
  verticalVel: { current: number };
}): { grounded: boolean; moved: Vec3Like } {
  const { controller, body, desiredVel, dt, gravityY, jumpSpeed, wantJump, climbing, verticalVel } =
    opts;
  const col = firstCollider(body);
  const cur = body.translation();
  const t = Math.min(0.05, Math.max(0, dt));

  if (climbing) {
    verticalVel.current = 0;
  } else {
    const wasGround = controller.computedGrounded?.() ?? false;
    if (wantJump && wasGround) {
      verticalVel.current = jumpSpeed;
    } else if (!wasGround || verticalVel.current > 0) {
      verticalVel.current += gravityY * t;
    } else {
      verticalVel.current = 0;
    }
  }

  const desired: Vec3Like = {
    x: desiredVel.x * t,
    y: climbing ? desiredVel.y * t : verticalVel.current * t,
    z: desiredVel.z * t,
  };

  if (!col) {
    const next = { x: cur.x + desired.x, y: cur.y + desired.y, z: cur.z + desired.z };
    body.setNextKinematicTranslation?.(next) ?? body.setTranslation?.(next, true);
    return { grounded: false, moved: desired };
  }

  controller.computeColliderMovement(col, desired);
  const mv = controller.computedMovement();
  const grounded = controller.computedGrounded();
  if (grounded && verticalVel.current < 0) verticalVel.current = 0;

  const next = { x: cur.x + mv.x, y: cur.y + mv.y, z: cur.z + mv.z };
  if (typeof body.setNextKinematicTranslation === "function") {
    body.setNextKinematicTranslation(next);
  } else {
    body.setTranslation?.(next, true);
  }
  return { grounded, moved: mv };
}

function toiOf(hit: unknown): number | null {
  if (hit == null) return null;
  if (typeof hit === "number" && Number.isFinite(hit)) return hit;
  if (typeof hit === "object") {
    const o = hit as { timeOfImpact?: number; toi?: number };
    if (typeof o.timeOfImpact === "number") return o.timeOfImpact;
    if (typeof o.toi === "number") return o.toi;
  }
  return null;
}

function colliderOf(hit: unknown): RapierColliderLike | null {
  if (!hit || typeof hit !== "object") return null;
  const o = hit as { collider?: RapierColliderLike };
  return o.collider ?? null;
}

function normalOf(hit: unknown): [number, number, number] {
  if (hit && typeof hit === "object") {
    const n = (hit as { normal?: Vec3Like }).normal;
    if (n && Number.isFinite(n.x)) return [n.x, n.y, n.z];
  }
  return [0, 1, 0];
}

function readUserData(col: RapierColliderLike | null): RapierBodyLike["userData"] {
  const rb = col?.parent?.() ?? null;
  return rb?.userData;
}

function passMaterial(
  ud: RapierBodyLike["userData"],
  filter?: MaterialRayFilter,
): boolean {
  if (!filter) return true;
  if (filter.requireBlocksLineOfSight && ud?.materialBlocksLineOfSight === false) return false;
  if (filter.requireBlocksProjectiles && ud?.materialBlocksProjectiles === false) return false;
  if (filter.requireBlocksAudio && ud?.materialBlocksAudio === false) return false;
  if (filter.kinds?.length && ud?.material && !filter.kinds.includes(ud.material)) return false;
  return true;
}

function passLayer(ud: RapierBodyLike["userData"], layerMask?: string[]): boolean {
  if (!layerMask?.length) return true;
  if (!ud?.entityId) return true;
  return layerMask.includes(ud.layer ?? "Default");
}

function queryPredicate(
  exclude: Set<string>,
  layerMask?: string[],
  materialFilter?: MaterialRayFilter,
) {
  return (col: RapierColliderLike) => {
    const ud = readUserData(col);
    if (ud?.entityId && exclude.has(ud.entityId)) return false;
    if (!passLayer(ud, layerMask)) return false;
    if (!passMaterial(ud, materialFilter)) return false;
    return true;
  };
}

/**
 * Rapier ray the right way:
 *  - unit direction, maxToi = metres along that unit
 *  - solid=true: first hit including interiors (LOS / bullets)
 *  - solid=false: hit the shell even if the origin starts inside (ground from capsule)
 *  - exclude ALL excludeIds via predicate (not only the first body)
 *  - EXCLUDE_SENSORS unless layerMask includes Trigger/Water
 */
export function rapierCastRay(
  world: RapierWorldLike,
  rapier: RapierNsLike,
  origin: [number, number, number],
  direction: [number, number, number],
  maxDistance: number,
  opts?: {
    excludeIds?: readonly string[];
    layerMask?: string[];
    materialFilter?: MaterialRayFilter;
    excludeBody?: RapierBodyLike | null;
    solid?: boolean;
    includeSensors?: boolean;
  },
): RaycastHit | null {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (len < 1e-8 || maxDistance <= 0) return null;
  const dir = {
    x: direction[0] / len,
    y: direction[1] / len,
    z: direction[2] / len,
  };
  const orig = { x: origin[0], y: origin[1], z: origin[2] };
  const ray = new rapier.Ray(orig, dir);
  const exclude = new Set(opts?.excludeIds ?? []);
  const solid = opts?.solid !== false;
  const includeSensors =
    opts?.includeSensors === true ||
    (opts?.layerMask ?? []).some((l) => l === "Trigger" || l === "Water");
  const flags = includeSensors ? undefined : rapier.QueryFilterFlags?.EXCLUDE_SENSORS;
  const pred = queryPredicate(exclude, opts?.layerMask, opts?.materialFilter);

  const hit = world.castRayAndGetNormal
    ? world.castRayAndGetNormal(
        ray,
        maxDistance,
        solid,
        flags,
        undefined,
        undefined,
        opts?.excludeBody ?? undefined,
        pred,
      )
    : world.castRay(
        ray,
        maxDistance,
        solid,
        flags,
        undefined,
        undefined,
        opts?.excludeBody ?? undefined,
        pred,
      );

  const toi = toiOf(hit);
  if (toi == null || toi > maxDistance) return null;
  const col = colliderOf(hit);
  const ud = readUserData(col);
  const n = normalOf(hit);
  return {
    entityId: ud?.entityId ?? null,
    point: [orig.x + dir.x * toi, orig.y + dir.y * toi, orig.z + dir.z * toi],
    distance: toi,
    normal: n,
    material: ud?.material ?? null,
    density: ud?.materialDensity ?? null,
    blocksLineOfSight: ud?.materialBlocksLineOfSight ?? null,
    blocksProjectiles: ud?.materialBlocksProjectiles ?? null,
    blocksAudio: ud?.materialBlocksAudio ?? null,
    surface: ud?.surface ?? null,
    layer: ud?.layer ?? null,
  } as RaycastHit & { surface?: string | null; layer?: string | null };
}

export function rapierGroundProbe(
  world: RapierWorldLike,
  rapier: RapierNsLike,
  position: [number, number, number],
  options?: {
    originOffset?: number;
    maxDistance?: number;
    excludeIds?: readonly string[];
    layerMask?: string[];
    excludeBody?: RapierBodyLike | null;
  },
): GroundProbeHit | null {
  const originOffset = options?.originOffset ?? 0.15;
  const maxDistance = options?.maxDistance ?? 0.55;
  const hit = rapierCastRay(
    world,
    rapier,
    [position[0], position[1] + originOffset, position[2]],
    [0, -1, 0],
    originOffset + maxDistance,
    {
      excludeIds: options?.excludeIds,
      layerMask: options?.layerMask ?? ["Terrain"],
      excludeBody: options?.excludeBody,
      solid: false,
    },
  );
  if (!hit) return null;
  const extra = hit as RaycastHit & { surface?: string | null };
  return {
    point: hit.point,
    distance: hit.distance - originOffset,
    normal: hit.normal,
    surface: extra.surface ?? "walk",
    entityId: hit.entityId,
  };
}

export function rapierClimbProbe(
  world: RapierWorldLike,
  rapier: RapierNsLike,
  position: [number, number, number],
  direction: [number, number, number],
  options?: {
    originHeight?: number;
    maxDistance?: number;
    excludeIds?: readonly string[];
    excludeBody?: RapierBodyLike | null;
  },
): GroundProbeHit | null {
  const originHeight = options?.originHeight ?? 1.1;
  const maxDistance = options?.maxDistance ?? 0.85;
  const hit = rapierCastRay(
    world,
    rapier,
    [position[0], position[1] + originHeight, position[2]],
    direction,
    maxDistance,
    {
      excludeIds: options?.excludeIds,
      layerMask: ["Terrain", "Trigger"],
      excludeBody: options?.excludeBody,
    },
  );
  if (!hit) return null;
  const extra = hit as RaycastHit & { surface?: string | null };
  return {
    point: hit.point,
    distance: hit.distance,
    normal: hit.normal,
    surface: extra.surface ?? "walk",
    entityId: hit.entityId,
  };
}

/** Surface tag still lives on THREE userData — overlay after Rapier hit. */
export function stampProbeSurface(
  probe: GroundProbeHit | null,
  threeFallback: GroundProbeHit | null,
): GroundProbeHit | null {
  if (!probe) return threeFallback;
  if (threeFallback?.surface && threeFallback.surface !== "walk") {
    return { ...probe, surface: threeFallback.surface };
  }
  if (threeFallback?.entityId && !probe.entityId) {
    return { ...probe, entityId: threeFallback.entityId, surface: threeFallback.surface };
  }
  return probe;
}

export type ShapeCastHit = RaycastHit & { toi: number };

/**
 * Sweep a shape along a direction. Use this for melee volumes, landing
 * prediction, and vehicle wheels — not a thin ray.
 *
 * `shapeVel` is a **unit** direction; `maxToi` is metres of travel.
 */
export function rapierCastShape(
  world: RapierWorldLike,
  rapier: RapierNsLike,
  shape: unknown,
  origin: [number, number, number],
  direction: [number, number, number],
  maxToi: number,
  opts?: {
    rotation?: { x: number; y: number; z: number; w: number };
    excludeIds?: readonly string[];
    layerMask?: string[];
    materialFilter?: MaterialRayFilter;
    excludeBody?: RapierBodyLike | null;
    includeSensors?: boolean;
  },
): ShapeCastHit | null {
  if (!world.castShape || !shape) return null;
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (len < 1e-8 || maxToi <= 0) return null;
  const vel = {
    x: direction[0] / len,
    y: direction[1] / len,
    z: direction[2] / len,
  };
  const pos = { x: origin[0], y: origin[1], z: origin[2] };
  const rot = opts?.rotation ?? IDENTITY_ROT;
  const exclude = new Set(opts?.excludeIds ?? []);
  const flags = opts?.includeSensors ? undefined : rapier.QueryFilterFlags?.EXCLUDE_SENSORS;
  const pred = queryPredicate(exclude, opts?.layerMask, opts?.materialFilter);
  const hit = world.castShape(
    pos,
    rot,
    vel,
    shape,
    0,
    maxToi,
    true,
    flags,
    undefined,
    undefined,
    opts?.excludeBody ?? undefined,
    pred,
  );
  const toi = toiOf(hit);
  if (toi == null) return null;
  const col = colliderOf(hit);
  const ud = readUserData(col);
  const n = normalOf(hit);
  return {
    entityId: ud?.entityId ?? null,
    point: [pos.x + vel.x * toi, pos.y + vel.y * toi, pos.z + vel.z * toi],
    distance: toi,
    toi,
    normal: n,
    material: ud?.material ?? null,
    density: ud?.materialDensity ?? null,
    blocksLineOfSight: ud?.materialBlocksLineOfSight ?? null,
    blocksProjectiles: ud?.materialBlocksProjectiles ?? null,
    blocksAudio: ud?.materialBlocksAudio ?? null,
  };
}

/** Capsule sweep along look dir — melee volume, not a pin ray. */
export function meleeVolumeCast(
  world: RapierWorldLike,
  rapier: RapierNsLike,
  origin: [number, number, number],
  direction: [number, number, number],
  range: number,
  opts?: { radius?: number; halfHeight?: number; excludeIds?: readonly string[]; excludeBody?: RapierBodyLike | null },
): ShapeCastHit | null {
  const Capsule = rapier.Capsule;
  if (!Capsule) return null;
  const shape = new Capsule(opts?.halfHeight ?? 0.35, opts?.radius ?? 0.28);
  return rapierCastShape(world, rapier, shape, origin, direction, range, {
    excludeIds: opts?.excludeIds,
    excludeBody: opts?.excludeBody,
    materialFilter: { requireBlocksProjectiles: true },
  });
}

/** Ball sweep along velocity — predicted landing / fall. */
export function predictLanding(
  world: RapierWorldLike,
  rapier: RapierNsLike,
  origin: [number, number, number],
  velocity: [number, number, number],
  maxTime: number,
  opts?: { radius?: number; excludeIds?: readonly string[]; excludeBody?: RapierBodyLike | null },
): ShapeCastHit | null {
  const Ball = rapier.Ball;
  if (!Ball) return null;
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  if (speed < 1e-4) {
    return rapierCastRay(world, rapier, origin, [0, -1, 0], 40, {
      excludeIds: opts?.excludeIds,
      excludeBody: opts?.excludeBody,
      layerMask: ["Terrain"],
      solid: true,
    }) as ShapeCastHit | null;
  }
  const shape = new Ball(opts?.radius ?? PLAY_CCT.radius);
  const dist = speed * maxTime;
  return rapierCastShape(world, rapier, shape, origin, velocity, dist, {
    excludeIds: opts?.excludeIds,
    excludeBody: opts?.excludeBody,
    layerMask: ["Terrain"],
  });
}

/** Sphere cast down — vehicle / cart wheel contact. */
export function wheelCast(
  world: RapierWorldLike,
  rapier: RapierNsLike,
  origin: [number, number, number],
  maxDrop: number,
  radius: number,
  opts?: { excludeIds?: readonly string[]; excludeBody?: RapierBodyLike | null },
): ShapeCastHit | null {
  const Ball = rapier.Ball;
  if (!Ball) return null;
  return rapierCastShape(world, rapier, new Ball(radius), origin, [0, -1, 0], maxDrop, {
    excludeIds: opts?.excludeIds,
    excludeBody: opts?.excludeBody,
    layerMask: ["Terrain"],
  });
}

export function applyKnockbackImpulse(
  body: RapierBodyLike,
  direction: [number, number, number],
  force: number,
): boolean {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  const nx = len > 1e-4 ? direction[0] / len : 0;
  const ny = len > 1e-4 ? direction[1] / len : 0.15;
  const nz = len > 1e-4 ? direction[2] / len : 0;
  const m = Math.max(body.mass?.() ?? 1, 0.5);
  const k = force * m;
  body.wakeUp?.();
  if (body.bodyType?.() === 2 || body.bodyType?.() === 3) {
    /* kinematic CCT: caller stores knock vel; still wake */
    return false;
  }
  body.applyImpulse?.({ x: nx * k, y: ny * k, z: nz * k }, true);
  return true;
}

export function blowAwayBodies(
  bodies: Iterable<RapierBodyLike>,
  origin: [number, number, number],
  force: number,
  radius: number,
): number {
  let n = 0;
  const r2 = radius * radius;
  for (const b of bodies) {
    const t = b.translation();
    const dx = t.x - origin[0];
    const dy = t.y - origin[1];
    const dz = t.z - origin[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-6 || d2 > r2) continue;
    const d = Math.sqrt(d2);
    const falloff = 1 - d / radius;
    if (applyKnockbackImpulse(b, [dx, dy + 0.4, dz], force * falloff)) n++;
  }
  return n;
}

export function applyBuoyancy(body: RapierBodyLike, gravityY: number, submerged: number): void {
  const m = Math.max(body.mass?.() ?? 1, 0.2);
  const lift = -gravityY * m * Math.min(1, Math.max(0, submerged)) * 1.15;
  body.wakeUp?.();
  body.applyImpulse?.({ x: 0, y: lift / 60, z: 0 }, true);
}

export function heightfieldArgs(
  ncols: number,
  nrows: number,
  heights: number[],
  scale: { x: number; y: number; z: number },
): [number, number, number[], { x: number; y: number; z: number }] {
  return [ncols, nrows, heights, scale];
}

