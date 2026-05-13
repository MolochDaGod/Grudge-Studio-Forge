import { describe, expect, it } from "vitest";
import { computeBodyLean, computeGaitWeights } from "../gaitBlend";

describe("computeGaitWeights", () => {
  const walk = 1.5;
  const run = 4;

  it("idle when speed is zero", () => {
    const w = computeGaitWeights(0, walk, run);
    expect(w).toEqual({ idle: 1, walk: 0, run: 0 });
  });

  it("idle when speed is NaN", () => {
    const w = computeGaitWeights(Number.NaN, walk, run);
    expect(w).toEqual({ idle: 1, walk: 0, run: 0 });
  });

  it("blends idle ⇆ walk in [0, walkSpeed]", () => {
    const w = computeGaitWeights(walk / 2, walk, run);
    expect(w.idle).toBeCloseTo(0.5, 5);
    expect(w.walk).toBeCloseTo(0.5, 5);
    expect(w.run).toBe(0);
  });

  it("hits pure walk at walkSpeed", () => {
    const w = computeGaitWeights(walk, walk, run);
    expect(w).toEqual({ idle: 0, walk: 1, run: 0 });
  });

  it("blends walk ⇆ run in [walkSpeed, runSpeed]", () => {
    const w = computeGaitWeights((walk + run) / 2, walk, run);
    expect(w.idle).toBe(0);
    expect(w.walk).toBeCloseTo(0.5, 5);
    expect(w.run).toBeCloseTo(0.5, 5);
  });

  it("clamps to pure run above runSpeed", () => {
    const w = computeGaitWeights(run * 2, walk, run);
    expect(w).toEqual({ idle: 0, walk: 0, run: 1 });
  });

  it("weights always sum to 1 across the full speed range", () => {
    for (let s = 0; s <= run * 1.5; s += 0.1) {
      const w = computeGaitWeights(s, walk, run);
      expect(w.idle + w.walk + w.run).toBeCloseTo(1, 5);
      expect(w.idle).toBeGreaterThanOrEqual(0);
      expect(w.walk).toBeGreaterThanOrEqual(0);
      expect(w.run).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles degenerate thresholds without dividing by zero", () => {
    expect(computeGaitWeights(2, 0, 4)).toEqual({ idle: 0, walk: 0, run: 1 });
    expect(computeGaitWeights(2, 4, 4)).toEqual({ idle: 0, walk: 0, run: 1 });
  });
});

describe("computeBodyLean", () => {
  it("no lean at zero speed and zero angular", () => {
    const r = computeBodyLean({ speed: 0, angularVelocity: 0, runSpeed: 4 });
    expect(r.forwardPitch).toBe(0);
    expect(Math.abs(r.rollLean)).toBe(0);
  });

  it("ramps forward pitch from 0 to maxPitch as speed approaches runSpeed", () => {
    const max = (10 * Math.PI) / 180;
    const half = computeBodyLean({ speed: 2, angularVelocity: 0, runSpeed: 4 });
    expect(half.forwardPitch).toBeCloseTo(max / 2, 5);
    const full = computeBodyLean({ speed: 4, angularVelocity: 0, runSpeed: 4 });
    expect(full.forwardPitch).toBeCloseTo(max, 5);
  });

  it("clamps forward pitch above runSpeed (caps at maxPitch)", () => {
    const max = (10 * Math.PI) / 180;
    const r = computeBodyLean({ speed: 100, angularVelocity: 0, runSpeed: 4 });
    expect(r.forwardPitch).toBeCloseTo(max, 5);
  });

  it("banks INTO a right turn (negative yaw rate → positive roll)", () => {
    const r = computeBodyLean({ speed: 4, angularVelocity: -Math.PI / 2, runSpeed: 4 });
    expect(r.rollLean).toBeGreaterThan(0);
  });

  it("banks INTO a left turn (positive yaw rate → negative roll)", () => {
    const r = computeBodyLean({ speed: 4, angularVelocity: Math.PI / 2, runSpeed: 4 });
    expect(r.rollLean).toBeLessThan(0);
  });

  it("clamps roll lean to ±maxRoll for very fast spins", () => {
    const max = (15 * Math.PI) / 180;
    const r = computeBodyLean({ speed: 4, angularVelocity: -1000, runSpeed: 4 });
    expect(r.rollLean).toBeCloseTo(max, 5);
    const l = computeBodyLean({ speed: 4, angularVelocity: 1000, runSpeed: 4 });
    expect(l.rollLean).toBeCloseTo(-max, 5);
  });

  it("ignores NaN inputs", () => {
    const r = computeBodyLean({ speed: Number.NaN, angularVelocity: Number.NaN, runSpeed: 4 });
    expect(r.forwardPitch).toBe(0);
    expect(Math.abs(r.rollLean)).toBe(0);
  });
});
