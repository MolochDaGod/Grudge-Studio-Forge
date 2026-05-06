import { describe, it, expect } from "vitest";
import { frameCamera } from "../camera";

describe("frameCamera", () => {
  it("returns a sane fallback for an empty point list", () => {
    const r = frameCamera({ points: [] });
    expect(r.target).toEqual([0, 0, 0]);
    expect(r.position[1]).toBeGreaterThan(0);
  });

  it("centers the target on the centroid of the inputs", () => {
    const r = frameCamera({
      points: [
        [-2, 0, 0],
        [2, 0, 0],
        [0, 0, 4],
      ],
    });
    expect(r.target[0]).toBeCloseTo(0);
    expect(r.target[2]).toBeCloseTo(4 / 3);
  });

  it("supports the required shot kinds", () => {
    const pts: [number, number, number][] = [
      [-2, 0, 0],
      [2, 0, 0],
    ];
    for (const shot of ["hero", "wide", "over-shoulder", "top-down", "establishing"] as const) {
      const r = frameCamera({ points: pts, shot, fromPoint: [-5, 1, -5] });
      expect(r.position).toHaveLength(3);
      expect(r.target).toHaveLength(3);
      expect(Number.isFinite(r.position[0])).toBe(true);
    }
  });

  it("'top-down' shot looks straight down (camera Y >> camera horizontal)", () => {
    const r = frameCamera({
      points: [
        [-3, 0, -3],
        [3, 0, 3],
      ],
      shot: "top-down",
    });
    const horiz = Math.hypot(r.position[0] - r.target[0], r.position[2] - r.target[2]);
    const vert = r.position[1] - r.target[1];
    expect(vert).toBeGreaterThan(horiz * 5);
  });

  it("'wide' shot backs further from the subject than 'hero'", () => {
    const pts: [number, number, number][] = [
      [-3, 0, 0],
      [3, 0, 0],
    ];
    const hero = frameCamera({ points: pts, shot: "hero" });
    const wide = frameCamera({ points: pts, shot: "wide" });
    const dh = Math.hypot(
      hero.position[0] - hero.target[0],
      hero.position[1] - hero.target[1],
      hero.position[2] - hero.target[2],
    );
    const dw = Math.hypot(
      wide.position[0] - wide.target[0],
      wide.position[1] - wide.target[1],
      wide.position[2] - wide.target[2],
    );
    expect(dw).toBeGreaterThan(dh);
  });

  it("'establishing' is wider still than 'wide'", () => {
    const pts: [number, number, number][] = [
      [-3, 0, 0],
      [3, 0, 0],
    ];
    const wide = frameCamera({ points: pts, shot: "wide" });
    const est = frameCamera({ points: pts, shot: "establishing" });
    const dw = Math.hypot(wide.position[0], wide.position[1], wide.position[2]);
    const de = Math.hypot(est.position[0], est.position[1], est.position[2]);
    expect(de).toBeGreaterThan(dw);
  });

  it("'over-shoulder' places the camera roughly along fromPoint→centroid", () => {
    const r = frameCamera({
      points: [[10, 0, 0]],
      shot: "over-shoulder",
      fromPoint: [-5, 0, 0],
    });
    // Camera should be on the negative-X side of the target, beyond the shoulder.
    expect(r.position[0]).toBeLessThan(r.target[0]);
  });

  it("padding multiplier moves the camera further out", () => {
    const pts: [number, number, number][] = [
      [-1, 0, 0],
      [1, 0, 0],
    ];
    const a = frameCamera({ points: pts, padding: 1 });
    const b = frameCamera({ points: pts, padding: 2 });
    const da = Math.hypot(a.position[0] - a.target[0], a.position[2] - a.target[2]);
    const db = Math.hypot(b.position[0] - b.target[0], b.position[2] - b.target[2]);
    expect(db).toBeGreaterThan(da);
  });
});
