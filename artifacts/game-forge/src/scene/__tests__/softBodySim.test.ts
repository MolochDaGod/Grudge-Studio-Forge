import { describe, expect, it } from "vitest";
import {
  buildGrid,
  makeParticlePool,
  projectOutOfColliders,
  resolveEmitter,
  snapshotColliders,
  stepVerlet,
  tickEmitter,
  tickParticles,
  type EmitState,
} from "../softBodySim";
import type { SceneEntity } from "../types";

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
