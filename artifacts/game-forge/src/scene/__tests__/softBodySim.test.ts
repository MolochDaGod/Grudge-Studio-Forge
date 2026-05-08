import { describe, expect, it } from "vitest";
import {
  buildGrid,
  makeParticlePool,
  projectOutOfColliders,
  resolveEmitter,
  gatherSoftColliders,
  snapshotColliders,
  snapshotRapierColliders,
  stepVerlet,
  tickEmitter,
  tickParticles,
  type EmitState,
  type RapierLikeCollider,
  type RapierLikeWorld,
} from "../softBodySim";
import type { SceneEntity } from "../types";

function mkRapierWorld(colliders: RapierLikeCollider[]): RapierLikeWorld {
  return { forEachCollider: (fn) => colliders.forEach(fn) };
}
function mkRapierCollider(over: Partial<RapierLikeCollider> & {
  translation: { x: number; y: number; z: number };
  shape: RapierLikeCollider["shape"];
}): RapierLikeCollider {
  return {
    isSensor: () => false,
    parent: () => null,
    ...over,
    translation: () => over.translation,
  };
}

function mkEntity(over: Partial<SceneEntity>): SceneEntity {
  return {
    id: "x",
    name: "x",
    type: "box",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...over,
  } as SceneEntity;
}

describe("verlet grid", () => {
  it("keeps pinned vertices clamped at their initial position", () => {
    const g = buildGrid(4, 4, 1, 1, (i, j) => j === 0);
    for (let step = 0; step < 30; step++) {
      stepVerlet(g, 1 / 60, 0.1, 0, -9.81, 0, 3);
    }
    for (let i = 0; i < 4; i++) {
      const idx = i * 3;
      expect(g.positions[idx + 1]).toBeCloseTo(g.initial[idx + 1], 4);
    }
  });

  it("free vertices fall under gravity", () => {
    const g = buildGrid(3, 3, 1, 1, () => false);
    const startY = g.positions[1];
    for (let step = 0; step < 30; step++) {
      stepVerlet(g, 1 / 60, 0, 0, -9.81, 0, 1);
    }
    expect(g.positions[1]).toBeLessThan(startY - 0.5);
  });

  it("wind biases motion in the wind direction", () => {
    // Compare two identical grids — one with wind, one without — and
    // assert the windy one drifted further in +X. This is robust to
    // damping / constraint tuning.
    const a = buildGrid(4, 4, 1, 1, (_i, j) => j === 0);
    const b = buildGrid(4, 4, 1, 1, (_i, j) => j === 0);
    for (let step = 0; step < 60; step++) {
      stepVerlet(a, 1 / 60, 0, 0, 0, 0, 2);
      stepVerlet(b, 1 / 60, 0, 8, 0, 0, 2);
    }
    const bottomCenter = (4 * 3 + 1) * 3;
    expect(b.positions[bottomCenter]).toBeGreaterThan(a.positions[bottomCenter] + 0.01);
  });
});

describe("collider projection", () => {
  it("pushes a point out of a sphere along its center→point ray", () => {
    const colliders = [{ kind: "sphere" as const, cx: 0, cy: 0, cz: 0, rx: 1, ry: 1, rz: 1 }];
    const pt = { x: 0.3, y: 0.2, z: 0 };
    expect(projectOutOfColliders(pt, colliders)).toBe(true);
    const d = Math.hypot(pt.x, pt.y, pt.z);
    expect(d).toBeCloseTo(1, 5);
  });

  it("pushes a point out of a box along the axis of least penetration", () => {
    const colliders = [{ kind: "box" as const, cx: 0, cy: 0, cz: 0, rx: 1, ry: 0.5, rz: 1 }];
    const pt = { x: 0.1, y: 0.4, z: 0.1 };
    expect(projectOutOfColliders(pt, colliders)).toBe(true);
    expect(pt.y).toBeCloseTo(0.5, 5);
  });

  it("snapshotRapierColliders converts cuboid + ball + capsule shapes", () => {
    const world = mkRapierWorld([
      mkRapierCollider({
        translation: { x: 1, y: 2, z: 3 },
        shape: { halfExtents: { x: 0.5, y: 0.25, z: 1 } },
      }),
      mkRapierCollider({
        translation: { x: 0, y: 0, z: 0 },
        shape: { radius: 0.7 },
      }),
      mkRapierCollider({
        translation: { x: -1, y: 0, z: 0 },
        shape: { radius: 0.3, halfHeight: 0.85 },
      }),
    ]);
    const out = snapshotRapierColliders(world, "self");
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ kind: "box", cx: 1, cy: 2, cz: 3, rx: 0.5, ry: 0.25, rz: 1 });
    expect(out[1]).toMatchObject({ kind: "sphere", rx: 0.7 });
    expect(out[2]).toMatchObject({ kind: "box", ry: 0.3 + 0.85, rx: 0.3, rz: 0.3 });
  });

  it("snapshotRapierColliders skips sensors and the self entity", () => {
    const world = mkRapierWorld([
      mkRapierCollider({
        translation: { x: 0, y: 0, z: 0 },
        shape: { halfExtents: { x: 1, y: 1, z: 1 } },
        isSensor: () => true,
      }),
      mkRapierCollider({
        translation: { x: 5, y: 0, z: 0 },
        shape: { halfExtents: { x: 1, y: 1, z: 1 } },
        parent: () => ({ userData: { entityId: "self" } }),
      }),
      mkRapierCollider({
        translation: { x: 9, y: 0, z: 0 },
        shape: { halfExtents: { x: 1, y: 1, z: 1 } },
        parent: () => ({ userData: { entityId: "other" } }),
      }),
    ]);
    const out = snapshotRapierColliders(world, "self");
    expect(out).toHaveLength(1);
    expect(out[0]?.cx).toBe(9);
  });

  it("snapshotRapierColliders tracks dynamic body positions across ticks", () => {
    // Mimic a dynamic body sliding along +X over time. Each call to
    // forEachCollider returns the latest translation, proving that
    // the snapshot reflects live physics state — not the scene-tree
    // author-time transform.
    const dynamic = { x: 0, y: 0, z: 0 };
    const world: RapierLikeWorld = {
      forEachCollider: (fn) =>
        fn(
          mkRapierCollider({
            translation: { ...dynamic },
            shape: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
          }),
        ),
    };
    expect(snapshotRapierColliders(world, "x")[0]?.cx).toBe(0);
    dynamic.x = 4;
    expect(snapshotRapierColliders(world, "x")[0]?.cx).toBe(4);
    dynamic.x = -2;
    expect(snapshotRapierColliders(world, "x")[0]?.cx).toBe(-2);
  });

  it("snapshotRapierColliders returns an empty list when world is null (edit mode)", () => {
    expect(snapshotRapierColliders(null, "x")).toEqual([]);
    expect(snapshotRapierColliders(undefined, "x")).toEqual([]);
  });

  it("gatherSoftColliders falls back to the scene tree when the world is null (edit mode)", () => {
    const ents: SceneEntity[] = [
      mkEntity({ id: "crate", type: "box", transform: { position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
    ];
    const out = gatherSoftColliders(null, ents, "self");
    expect(out).toHaveLength(1);
    expect(out[0]?.cx).toBe(3);
  });

  it("gatherSoftColliders dedups scene-tree entries that already have a Rapier body", () => {
    // The "crate" entity exists at (0,0,0) in the scene tree but has
    // drifted to (5,0,0) at runtime under Rapier control. The dedup
    // pass must drop the stale scene-tree entry so cloth doesn't
    // collide with a ghost crate at the origin.
    const ents: SceneEntity[] = [
      mkEntity({ id: "crate", type: "box", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
      mkEntity({ id: "rock", type: "sphere", transform: { position: [-2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
    ];
    const world = mkRapierWorld([
      mkRapierCollider({
        translation: { x: 5, y: 0, z: 0 },
        shape: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
        parent: () => ({ userData: { entityId: "crate" } }),
      }),
    ]);
    const out = gatherSoftColliders(world, ents, "self");
    // Live Rapier crate at x=5 + scene-tree rock at x=-2; stale crate
    // at the origin must be excluded.
    expect(out).toHaveLength(2);
    const xs = out.map((c) => c.cx).sort((a, b) => a - b);
    expect(xs).toEqual([-2, 5]);
  });

  it("snapshotColliders skips soft entities and self", () => {
    const ents: SceneEntity[] = [
      mkEntity({ id: "self", type: "cloth" }),
      mkEntity({ id: "box1", type: "box", transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
      mkEntity({ id: "flag1", type: "flag" }),
      mkEntity({ id: "light1", type: "light" }),
    ];
    const out = snapshotColliders(ents, "self");
    expect(out).toHaveLength(1);
    expect(out[0]?.cx).toBe(2);
  });
});

describe("particle emitter", () => {
  it("continuous mode spawns roughly emitRate × elapsed particles", () => {
    const cfg = resolveEmitter({ mode: "continuous", emitRate: 30, lifetime: 5 }, 0.1);
    const pool = makeParticlePool(cfg.capacity);
    const state: EmitState = { accum: 0, fired: false };
    let total = 0;
    for (let i = 0; i < 60; i++) {
      total += tickEmitter(
        pool,
        state,
        cfg,
        { windX: 0, windY: 0, windZ: 0, emitVelocity: 1, rand: () => 0.5 },
        1 / 60,
      );
    }
    // 1s × 30/s = 30 ± rounding
    expect(total).toBeGreaterThanOrEqual(29);
    expect(total).toBeLessThanOrEqual(31);
  });

  it("burst mode releases burstCount on the first tick and again per interval", () => {
    const cfg = resolveEmitter(
      { mode: "burst", burstCount: 12, burstInterval: 0.5, lifetime: 2 },
      0.1,
    );
    const pool = makeParticlePool(cfg.capacity);
    const state: EmitState = { accum: 0, fired: false };
    const first = tickEmitter(
      pool,
      state,
      cfg,
      { windX: 0, windY: 0, windZ: 0, emitVelocity: 1, rand: () => 0.5 },
      1 / 60,
    );
    expect(first).toBe(12);
    let later = 0;
    // Run another 0.6s — should fire one more burst (passes the 0.5s mark).
    for (let i = 0; i < 36; i++) {
      later += tickEmitter(
        pool,
        state,
        cfg,
        { windX: 0, windY: 0, windZ: 0, emitVelocity: 1, rand: () => 0.5 },
        1 / 60,
      );
    }
    expect(later).toBe(12);
  });

  it("particles slide along a ground box when collideGround is set", () => {
    const cfg = resolveEmitter(
      { mode: "continuous", emitRate: 0, lifetime: 5, collideGround: true },
      0,
    );
    const pool = makeParticlePool(4);
    // Drop a single particle from above onto a flat box at y=0 with
    // some lateral velocity so we can assert it slides.
    pool.alive[0] = 1;
    pool.positions[0] = 0;
    pool.positions[1] = 0.5;
    pool.positions[2] = 0;
    pool.velocities[0] = 1;
    pool.velocities[1] = -2;
    pool.velocities[2] = 0;
    const colliders = [
      { kind: "box" as const, cx: 0, cy: -0.5, cz: 0, rx: 5, ry: 0.5, rz: 5 },
    ];
    for (let i = 0; i < 60; i++) {
      tickParticles(pool, cfg, 0, 0, 0, 1 / 60, colliders);
    }
    // Particle should rest on top of the box (y >= 0) instead of
    // tunnelling through, and have continued sliding along +X.
    expect(pool.positions[1]).toBeGreaterThanOrEqual(-1e-3);
    expect(pool.positions[0]).toBeGreaterThan(0.1);
  });

  it("particles bounce off the ground when bounciness > 0", () => {
    const cfg = resolveEmitter(
      { mode: "continuous", emitRate: 0, lifetime: 5, collideGround: true, bounciness: 0.8 },
      0,
    );
    expect(cfg.bounciness).toBeCloseTo(0.8);
    const pool = makeParticlePool(4);
    pool.alive[0] = 1;
    pool.positions[0] = 0;
    pool.positions[1] = 0.5;
    pool.positions[2] = 0;
    pool.velocities[0] = 0;
    pool.velocities[1] = -3;
    pool.velocities[2] = 0;
    const colliders = [
      { kind: "box" as const, cx: 0, cy: -0.5, cz: 0, rx: 5, ry: 0.5, rz: 5 },
    ];
    // Step a few frames after the first contact and confirm the
    // particle's vertical velocity becomes positive (rebound) at some
    // point — sliding (bounciness 0) would never produce upward motion.
    let sawUpward = false;
    for (let i = 0; i < 30; i++) {
      tickParticles(pool, cfg, 0, 0, 0, 1 / 60, colliders);
      if (pool.velocities[1] > 0.1) sawUpward = true;
    }
    expect(sawUpward).toBe(true);
  });

  it("falls back to material restitution when bounciness is unset", () => {
    const cfg = resolveEmitter(
      { mode: "continuous", emitRate: 0, lifetime: 5, collideGround: true },
      0,
      0.5,
    );
    expect(cfg.bounciness).toBeCloseTo(0.5);
  });

  it("explicit bounciness on the emitter overrides the material default", () => {
    const cfg = resolveEmitter(
      { collideGround: true, bounciness: 0 },
      0,
      0.9,
    );
    expect(cfg.bounciness).toBe(0);
  });

  it("particles ignore colliders when collideGround is false", () => {
    const cfg = resolveEmitter(
      { mode: "continuous", emitRate: 0, lifetime: 5 },
      0,
    );
    const pool = makeParticlePool(4);
    pool.alive[0] = 1;
    pool.positions[0] = 0;
    pool.positions[1] = 0.5;
    pool.positions[2] = 0;
    pool.velocities[1] = -5;
    const colliders = [
      { kind: "box" as const, cx: 0, cy: -0.5, cz: 0, rx: 5, ry: 0.5, rz: 5 },
    ];
    for (let i = 0; i < 60; i++) {
      tickParticles(pool, cfg, 0, 0, 0, 1 / 60, colliders);
    }
    // Without the flag, the particle falls straight through the box.
    expect(pool.positions[1]).toBeLessThan(-1);
  });

  it("particles age out and free their pool slots for recycling", () => {
    const cfg = resolveEmitter({ mode: "continuous", emitRate: 60, lifetime: 0.2 }, 5);
    const pool = makeParticlePool(cfg.capacity);
    const state: EmitState = { accum: 0, fired: false };
    for (let i = 0; i < 240; i++) {
      tickEmitter(pool, state, cfg, { windX: 0, windY: 0, windZ: 0, emitVelocity: 0, rand: () => 0.5 }, 1 / 60);
      tickParticles(pool, cfg, 0, 0, 0, 1 / 60);
    }
    let live = 0;
    for (let i = 0; i < pool.capacity; i++) if (pool.alive[i]) live++;
    // Steady-state ≈ rate × lifetime = 60 × 0.2 = 12, well under capacity.
    expect(live).toBeLessThanOrEqual(cfg.capacity);
    expect(live).toBeLessThan(20);
  });
});
