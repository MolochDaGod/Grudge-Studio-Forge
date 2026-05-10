import { describe, it, expect } from "vitest";
import { computeFramingPose } from "../framing";

describe("computeFramingPose", () => {
  it("centers the orbit target on the AABB centroid", () => {
    const pose = computeFramingPose({
      bbox: { min: [-1, 0, -2], max: [3, 4, 2] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    expect(pose.target[0]).toBeCloseTo(1);
    expect(pose.target[1]).toBeCloseTo(2);
    expect(pose.target[2]).toBeCloseTo(0);
  });

  it("frames a unit cube at a sane camera distance", () => {
    const pose = computeFramingPose({
      bbox: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    // Bounding sphere ≈ 0.866 → distance / sin(22.5°) * 1.4 ≈ 3.17
    expect(pose.distance).toBeGreaterThan(1.5);
    expect(pose.distance).toBeLessThan(6);
  });

  it("frames a 10x10 plane MUCH farther than a unit cube", () => {
    const small = computeFramingPose({
      bbox: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    const big = computeFramingPose({
      bbox: { min: [-5, -0.01, -5], max: [5, 0.01, 5] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    expect(big.distance).toBeGreaterThan(small.distance * 5);
  });

  it("preserves the camera direction relative to the target", () => {
    const pose = computeFramingPose({
      bbox: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      cameraPosition: [3, 4, 0], // 5 units from origin in XY plane
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    const len = Math.hypot(pose.position[0], pose.position[1], pose.position[2]);
    expect(pose.position[0] / len).toBeCloseTo(0.6, 4);
    expect(pose.position[1] / len).toBeCloseTo(0.8, 4);
    expect(pose.position[2] / len).toBeCloseTo(0, 4);
  });

  it("is idempotent: framing the same entity twice converges", () => {
    const a = computeFramingPose({
      bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    const b = computeFramingPose({
      bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      cameraPosition: a.position,
      currentTarget: a.target,
      fovDegrees: 45,
    });
    expect(b.distance).toBeCloseTo(a.distance, 5);
    expect(b.position[0]).toBeCloseTo(a.position[0], 5);
    expect(b.position[1]).toBeCloseTo(a.position[1], 5);
    expect(b.position[2]).toBeCloseTo(a.position[2], 5);
    expect(b.target[0]).toBeCloseTo(a.target[0], 5);
  });

  it("falls back to a default direction when camera sits on the target", () => {
    const pose = computeFramingPose({
      bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      cameraPosition: [0, 0, 0],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    // No NaNs, finite, nonzero offset from target
    const off = Math.hypot(pose.position[0], pose.position[1], pose.position[2]);
    expect(Number.isFinite(off)).toBe(true);
    expect(off).toBeGreaterThan(0);
  });

  it("clamps to maxDistance so a giant Map AABB doesn't fling the camera past the editor's far plane", () => {
    // The encampment / deserttown / yard maps span 100–300 world
    // units; without a clamp `radius / sin(fov/2) * margin` returns
    // distances in the THOUSANDS, which sits past the editor camera's
    // default `far=2000` plane and shows the user a black viewport
    // (the focus / F hotkey stops appearing to do anything). The
    // 200-unit default cap keeps the camera inside the far plane while
    // still framing the full map silhouette comfortably.
    const huge = computeFramingPose({
      bbox: { min: [-150, -10, -150], max: [150, 80, 150] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
    });
    expect(huge.distance).toBeLessThanOrEqual(200);
    // ...and that distance must STILL preserve view direction — the
    // clamp must not zero out the position.
    const off = Math.hypot(
      huge.position[0] - huge.target[0],
      huge.position[1] - huge.target[1],
      huge.position[2] - huge.target[2],
    );
    expect(off).toBeCloseTo(huge.distance, 4);
  });

  it("respects an explicit maxDistance override", () => {
    const pose = computeFramingPose({
      bbox: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
      maxDistance: 50,
    });
    expect(pose.distance).toBeLessThanOrEqual(50);
  });

  it("widens distance for narrow (tall) viewports via aspect", () => {
    const wide = computeFramingPose({
      bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
      aspect: 16 / 9,
    });
    const narrow = computeFramingPose({
      bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      cameraPosition: [10, 10, 10],
      currentTarget: [0, 0, 0],
      fovDegrees: 45,
      aspect: 0.5,
    });
    // Narrow viewport must back off further so horizontal silhouette still fits.
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });
});
