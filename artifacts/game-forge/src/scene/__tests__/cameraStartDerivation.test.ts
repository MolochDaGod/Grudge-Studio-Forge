import { describe, expect, it } from "vitest";
import {
  deriveOrbitFromCameraStart,
  deriveLookFromCameraStart,
} from "../CameraControllers";

describe("deriveOrbitFromCameraStart", () => {
  it("returns yaw=0, pitch=0, dist=10 for a camera due +Z behind the target", () => {
    // back vector = (0, 0, 10) — atan2(0, 10) = 0, asin(0) = 0.
    // This is the canonical "behind the player" pose; the previous
    // hard-coded TPS default (yawRef=0) matches this exactly, so a
    // template that publishes the canonical pose must derive to it
    // bit-for-bit (no surprise rotation on Play press).
    const seed = deriveOrbitFromCameraStart({
      position: [0, 0, 10],
      target: [0, 0, 0],
    });
    expect(seed).not.toBeNull();
    expect(seed!.yaw).toBeCloseTo(0, 6);
    expect(seed!.pitch).toBeCloseTo(0, 6);
    expect(seed!.dist).toBeCloseTo(10, 6);
  });

  it("derives positive pitch when the camera is above the target", () => {
    // back = (0, 6, 8), dist = 10, yaw = 0, pitch = asin(6/10) ≈ 0.6435.
    const seed = deriveOrbitFromCameraStart({
      position: [0, 6, 8],
      target: [0, 0, 0],
    });
    expect(seed).not.toBeNull();
    expect(seed!.yaw).toBeCloseTo(0, 6);
    expect(seed!.pitch).toBeCloseTo(Math.asin(0.6), 6);
    expect(seed!.dist).toBeCloseTo(10, 6);
  });

  it("derives yaw>0 when the camera is to the right (+X) of a behind pose", () => {
    // back = (5, 0, 5) → atan2(5, 5) = π/4 (camera over the player's
    // RIGHT shoulder when at rest yaw=0). The TPS controller will
    // rotate the player to face the opposite direction so the camera
    // stays behind them.
    const seed = deriveOrbitFromCameraStart({
      position: [5, 0, 5],
      target: [0, 0, 0],
    });
    expect(seed).not.toBeNull();
    expect(seed!.yaw).toBeCloseTo(Math.PI / 4, 6);
  });

  it("returns null for a degenerate (camera == target) pose", () => {
    expect(
      deriveOrbitFromCameraStart({ position: [1, 1, 1], target: [1, 1, 1] }),
    ).toBeNull();
  });
});

describe("deriveLookFromCameraStart", () => {
  it("returns yaw=π for forward = -Z (look at the +X/-Z arena half)", () => {
    // forward = target - position = (0, 0, -10). atan2(0, -10) = π.
    // FPS basis: (sin π * cos 0, sin 0, cos π * cos 0) = (0, 0, -1).
    // i.e. the player looks down -Z — exactly what fpsArenaScene wants
    // (enemies sit at z=-10 / -4).
    const look = deriveLookFromCameraStart({
      position: [0, 0, 0],
      target: [0, 0, -10],
    });
    expect(look).not.toBeNull();
    expect(Math.abs(look!.yaw)).toBeCloseTo(Math.PI, 6);
    expect(look!.pitch).toBeCloseTo(0, 6);
  });

  it("clamps pitch to within ±π/2 (asin domain)", () => {
    // straight-up forward — pitch should saturate at +π/2 (or just
    // under, depending on caller-side clamps).
    const look = deriveLookFromCameraStart({
      position: [0, 0, 0],
      target: [0, 10, 0],
    });
    expect(look).not.toBeNull();
    expect(look!.pitch).toBeCloseTo(Math.PI / 2, 6);
  });

  it("returns null for a degenerate pose", () => {
    expect(
      deriveLookFromCameraStart({ position: [0, 0, 0], target: [0, 0, 0] }),
    ).toBeNull();
  });
});
