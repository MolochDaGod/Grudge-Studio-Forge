import { describe, expect, it } from "vitest";
import {
  bounds,
  centroid,
  clusterPoints,
  nearestNeighborStats,
  type Point3,
} from "../cluster";

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

describe("centroid", () => {
  it("returns origin for empty input", () => {
    expect(centroid([])).toEqual({ x: 0, y: 0, z: 0 });
  });
  it("averages each axis", () => {
    const c = centroid([mk("a", 0, 0, 0), mk("b", 4, 8, 12)]);
    expect(c).toEqual({ x: 2, y: 4, z: 6 });
  });
});

describe("nearestNeighborStats", () => {
  it("returns zeros + nulls for fewer than two points", () => {
    const s = nearestNeighborStats([mk("only", 1, 2, 3)]);
    expect(s).toEqual({
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      closestPair: null,
      loneliest: null,
    });
  });
  it("identifies the closest pair and the loneliest entity", () => {
    const s = nearestNeighborStats([
      mk("a", 0, 0, 0),
      mk("b", 1, 0, 0), // a-b are closest (distance 1)
      mk("c", 100, 0, 0), // c is far from everyone
    ]);
    expect(s.closestPair).toEqual(["a", "b"]);
    expect(s.min).toBe(1);
    expect(s.loneliest).toBe("c");
    expect(s.max).toBeGreaterThan(50);
  });
  it("returns sorted ids in closestPair regardless of input order", () => {
    const s = nearestNeighborStats([mk("z", 0, 0, 0), mk("a", 0, 0, 1)]);
    expect(s.closestPair).toEqual(["a", "z"]);
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
    expect(r.clusters[0].center.x).toBeLessThan(r.clusters[1].center.x);
    expect(r.clusters[1].center.x).toBeLessThan(r.clusters[2].center.x);
    for (const c of r.clusters) expect(c.memberIds).toHaveLength(6);
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
