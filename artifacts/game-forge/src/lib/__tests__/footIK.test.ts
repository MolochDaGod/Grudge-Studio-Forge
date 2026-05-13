import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { solveTwoBoneIK, applyDeltaWorld } from "../footIK";

/** Build a simple straight-down hip→knee→ankle chain (1m + 1m).
 *  Hip at the origin, knee 1m below, ankle 2m below. Pole pointing
 *  forward (+Z) so the knee bends forward when reaching for a target
 *  in front of the chain. */
function buildLegPose(target: THREE.Vector3) {
  return {
    hip: new THREE.Vector3(0, 0, 0),
    knee: new THREE.Vector3(0, -1, 0),
    ankle: new THREE.Vector3(0, -2, 0),
    target,
    pole: new THREE.Vector3(0, 0, 1),
  };
}

describe("solveTwoBoneIK", () => {
  it("reports `reached: true` when target is inside chain reach", () => {
    // Total chain length is 2m; a target 1.5m below the hip is well
    // within reach (between min-reach 0 and max-reach 2). The solver
    // should be able to plant the ankle exactly there.
    const out = solveTwoBoneIK(buildLegPose(new THREE.Vector3(0.3, -1.5, 0.3)));
    expect(out.reached).toBe(true);
  });

  it("reports `reached: false` when target is past max reach", () => {
    // 5m is well past the 2m chain length; the chain extends fully
    // toward the target but the ankle stops short.
    const out = solveTwoBoneIK(buildLegPose(new THREE.Vector3(0, -5, 0)));
    expect(out.reached).toBe(false);
  });

  it("reports `reached: false` for under-reach when limbs are uneven", () => {
    // upper = 2, lower = 1 → min reach = |2-1| = 1. Target 0.5m away
    // is inside the dead zone where the chain can't fold tightly
    // enough to touch.
    const out = solveTwoBoneIK({
      hip: new THREE.Vector3(0, 0, 0),
      knee: new THREE.Vector3(0, -2, 0),
      ankle: new THREE.Vector3(0, -3, 0),
      target: new THREE.Vector3(0, -0.5, 0),
      pole: new THREE.Vector3(0, 0, 1),
    });
    expect(out.reached).toBe(false);
  });

  it("returns identity-ish rotations when target equals current ankle", () => {
    // No-op case: target sits exactly on the current ankle. Both
    // delta quaternions should be ~identity (any axis, ~0 angle).
    const out = solveTwoBoneIK(buildLegPose(new THREE.Vector3(0, -2, 0)));
    expect(out.hipDeltaWorld.w).toBeCloseTo(1, 4);
    expect(out.kneeDeltaWorld.w).toBeCloseTo(1, 4);
  });

  it("survives degenerate zero-length chains without producing NaN", () => {
    // First-frame robustness: cloned scenes briefly have collapsed
    // bone positions during the very first matrix update. The solver
    // must return finite quaternions instead of NaN.
    const out = solveTwoBoneIK({
      hip: new THREE.Vector3(0, 0, 0),
      knee: new THREE.Vector3(0, 0, 0),
      ankle: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(0, -1, 0),
      pole: new THREE.Vector3(0, 0, 1),
    });
    for (const q of [out.hipDeltaWorld, out.kneeDeltaWorld]) {
      expect(Number.isFinite(q.x)).toBe(true);
      expect(Number.isFinite(q.y)).toBe(true);
      expect(Number.isFinite(q.z)).toBe(true);
      expect(Number.isFinite(q.w)).toBe(true);
    }
  });

  it("survives a colinear pole hint without producing NaN", () => {
    // When `pole` is parallel to (hip → target) the standard cross-
    // product would give a zero-length bend axis. The solver picks
    // an arbitrary orthogonal axis instead.
    const out = solveTwoBoneIK({
      hip: new THREE.Vector3(0, 0, 0),
      knee: new THREE.Vector3(0, -1, 0),
      ankle: new THREE.Vector3(0, -2, 0),
      target: new THREE.Vector3(0, -1.5, 0), // straight along the chain axis
      pole: new THREE.Vector3(0, -1, 0), // colinear with hip→target
    });
    expect(Number.isFinite(out.hipDeltaWorld.x)).toBe(true);
    expect(Number.isFinite(out.kneeDeltaWorld.x)).toBe(true);
  });
});

describe("applyDeltaWorld", () => {
  it("composes the world-space delta with the bone's existing rotation", () => {
    // Set up: a parent at world identity with one child whose local
    // rotation is 90° about Y. Apply a world-space delta of 90° about
    // X. The child's new world rotation should be (90° X) ∘ (90° Y).
    const parent = new THREE.Object3D();
    const child = new THREE.Object3D();
    parent.add(child);
    child.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    parent.updateWorldMatrix(true, true);

    const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    applyDeltaWorld(child, delta);

    const expected = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    child.updateWorldMatrix(true, false);
    const actual = new THREE.Quaternion();
    child.getWorldQuaternion(actual);
    expect(actual.x).toBeCloseTo(expected.x, 5);
    expect(actual.y).toBeCloseTo(expected.y, 5);
    expect(actual.z).toBeCloseTo(expected.z, 5);
    expect(actual.w).toBeCloseTo(expected.w, 5);
  });
});
