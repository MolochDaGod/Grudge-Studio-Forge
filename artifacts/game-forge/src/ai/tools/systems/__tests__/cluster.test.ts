import { describe, expect, it } from "vitest";
import { bounds, clusterPoints, type Point3 } from "../cluster";

const mk = (id: string, x: number, y: number, z: number): Point3 => ({ id, x, y, z });

describe("bounds", () => {
  it("returns degenerate cube for empty input", () => {
    const b = bounds([]);
    expect(b.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.max).toEqual({ x: 0, y: 0, z: 0 });
  });
  it("computes min/max across all axes", () => {
    const b = bounds([
      mk("a", -1, 0, 5),
      mk("b", 3, 4, -2),
      mk("c", 0, -7, 1),
    ]);
    expect(b.min).toEqual({ x: -1, y: -7, z: -2 });
    expect(b.max).toEqual({ x: 3, y: 4, z: 5 });
  });
});

describe("clusterPoints", () => {
  it("returns empty for no points", () => {
    const r = clusterPoints([]);
    expect(r.clusters).toEqual([]);
    expect(r.k).toBe(0);
  });

  it("collapses three tight blobs to k=3", () => {
    const blob = (cx: number, cz: number, prefix: string): Point3[] =>
      Array.from({ length: 6 }, (_, i) =>
        mk(`${prefix}-${i}`, cx + (i % 3) * 0.1, 0, cz + Math.floor(i / 3) * 0.1),
      );
    const points = [...blob(-50, 0, "L"), ...blob(0, 0, "M"), ...blob(50, 0, "R")];
    const r = clusterPoints(points, { maxK: 6, seed: 7 });
    expect(r.k).toBe(3);
    // Sorted by centroid X ascending.
    expect(r.clusters[0].center.x).toBeLessThan(r.clusters[1].center.x);
    expect(r.clusters[1].center.x).toBeLessThan(r.clusters[2].center.x);
    // Each cluster captures exactly its 6 members.
    for (const c of r.clusters) expect(c.memberIds).toHaveLength(6);
    // 1-based, contiguous labels.
    expect(r.clusters.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it("is deterministic for a fixed seed", () => {
    const points: Point3[] = Array.from({ length: 30 }, (_, i) =>
      mk(`p${i}`, Math.cos(i) * 10, 0, Math.sin(i) * 10),
    );
    const a = clusterPoints(points, { seed: 42 });
    const b = clusterPoints(points, { seed: 42 });
    expect(a.k).toBe(b.k);
    expect(a.clusters.map((c) => c.memberIds)).toEqual(
      b.clusters.map((c) => c.memberIds),
    );
  });
});
