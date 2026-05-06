import { describe, it, expect } from "vitest";
import {
  gridLayout,
  ringLayout,
  lineLayout,
  scatterLayout,
  clusterLayout,
} from "../layouts";

describe("gridLayout", () => {
  it("returns empty for count 0", () => {
    expect(gridLayout({ count: 0 })).toEqual([]);
  });

  it("centers the grid on origin and respects spacing", () => {
    const pts = gridLayout({ count: 4, spacing: 2, cols: 2 });
    expect(pts).toHaveLength(4);
    // 2x2 grid centered: corners at (-1, 0, -1) and (1, 0, 1)
    const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
    const zs = pts.map((p) => p[2]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-1);
    expect(xs[3]).toBeCloseTo(1);
    expect(zs[0]).toBeCloseTo(-1);
    expect(zs[3]).toBeCloseTo(1);
  });

  it("keeps Y constant on the ground plane by default", () => {
    const pts = gridLayout({ count: 5, origin: [0, 3, 0] });
    for (const p of pts) expect(p[1]).toBe(3);
  });
});

describe("ringLayout", () => {
  it("places points at the requested radius around origin", () => {
    const pts = ringLayout({ count: 8, radius: 5, origin: [1, 2, 3] });
    expect(pts).toHaveLength(8);
    for (const p of pts) {
      const dx = p[0] - 1;
      const dz = p[2] - 3;
      expect(Math.hypot(dx, dz)).toBeCloseTo(5, 5);
      expect(p[1]).toBe(2);
    }
  });

  it("spaces a full ring evenly", () => {
    const pts = ringLayout({ count: 4, radius: 1 });
    // First point at angle 0 → (1, 0, 0)
    expect(pts[0][0]).toBeCloseTo(1);
    expect(pts[0][2]).toBeCloseTo(0);
  });
});

describe("lineLayout", () => {
  it("places points along a normalized direction with even spacing", () => {
    const pts = lineLayout({ count: 3, spacing: 2, direction: [0, 0, 1] });
    expect(pts.map((p) => p[2])).toEqual([-2, 0, 2]);
    expect(pts.every((p) => p[0] === 0)).toBe(true);
  });
});

describe("scatterLayout", () => {
  it("is deterministic for a fixed seed", () => {
    const a = scatterLayout({ count: 10, radius: 8, seed: 42, minSpacing: 0 });
    const b = scatterLayout({ count: 10, radius: 8, seed: 42, minSpacing: 0 });
    expect(a).toEqual(b);
  });

  it("respects minSpacing as a Poisson-like floor", () => {
    const pts = scatterLayout({ count: 12, radius: 6, seed: 7, minSpacing: 1.5 });
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0];
        const dz = pts[i][2] - pts[j][2];
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(1.5 - 1e-9);
      }
    }
  });
});

describe("clusterLayout", () => {
  it("produces exactly count points", () => {
    const pts = clusterLayout({ count: 20, clusters: 4, seed: 1 });
    expect(pts).toHaveLength(20);
  });

  it("is deterministic for a fixed seed", () => {
    const a = clusterLayout({ count: 15, clusters: 3, seed: 99 });
    const b = clusterLayout({ count: 15, clusters: 3, seed: 99 });
    expect(a).toEqual(b);
  });
});
