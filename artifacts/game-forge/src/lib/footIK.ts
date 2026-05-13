import * as THREE from "three";

/**
 * Two-bone analytic inverse kinematics solver — pure math.
 *
 * Given a hip → knee → ankle chain (or shoulder → elbow → hand) in
 * world space and a desired ankle target, produce world-space
 * quaternions for the hip and knee that place the ankle as close to
 * the target as the chain length allows.
 *
 * The solver is purely analytic (no Jacobians, no iteration), which
 * keeps it fast enough to run on every character every frame and
 * makes its behaviour easy to reason about: the only failure modes
 * are over-reach (target farther than `len(hip→knee) + len(knee→
 * ankle)` — chain extends straight at the target) and under-reach
 * (target closer than `|len(hip→knee) − len(knee→ankle)|` — chain
 * folds maximally and the ankle doesn't touch the target).
 *
 * The pole hint controls the swivel of the knee around the hip→
 * ankle axis. For human legs this should be roughly the world-space
 * forward direction of the character so the knee bends forward
 * (the natural direction); without it the knee can flip behind the
 * character on certain stances.
 */

/** World-space input poses for the chain. We pass plain Vector3s
 *  so the solver is unit-testable without constructing a full bone
 *  hierarchy. The caller (footPlanting) reads these via
 *  `bone.getWorldPosition(tmp)` once per frame. */
export interface TwoBoneInput {
  hip: THREE.Vector3;
  knee: THREE.Vector3;
  ankle: THREE.Vector3;
  /** Desired world-space position for the ankle. */
  target: THREE.Vector3;
  /** World-space "forward" direction the knee should bend toward.
   *  Should be unit length; doesn't need to be exactly perpendicular
   *  to (target − hip) — the solver projects it. */
  pole: THREE.Vector3;
}

/** World-space rotation deltas to apply to the hip and knee bones.
 *  Returned as quaternions that rotate the *current* bone direction
 *  to the *desired* bone direction in world space. The caller
 *  converts these to local-space rotations by applying the parent's
 *  inverse world quaternion (see `applyTwoBoneIK`). */
export interface TwoBoneOutput {
  hipDeltaWorld: THREE.Quaternion;
  kneeDeltaWorld: THREE.Quaternion;
  /** True when the chain reaches the target exactly. False when
   *  over-reached (chain extends straight) or under-reached (chain
   *  folded maximally). Useful for debugging + for caller-side
   *  decisions like "skip foot rotation when we couldn't reach". */
  reached: boolean;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _vHipToTarget = new THREE.Vector3();
const _vHipToAnkle = new THREE.Vector3();
const _vHipToKnee = new THREE.Vector3();
const _vKneeToAnkle = new THREE.Vector3();
const _axis = new THREE.Quaternion();

/** Numerical safety floor for division-by-distance / acos clamp.
 *  At this scale (metres) 1e-6 is well below any visible jitter and
 *  large enough that quat construction stays well-conditioned. */
const EPS = 1e-6;

/**
 * Solve a two-bone IK chain.
 *
 * Algorithm:
 *   1. Compute current upper / lower bone lengths from the input
 *      pose (hip→knee and knee→ankle distances). These define the
 *      chain's reach budget.
 *   2. Compute current direction (hip → ankle) and desired direction
 *      (hip → target). The first delta rotates the chain root so
 *      the ankle line points at the target.
 *   3. Compute the desired hip-to-knee axis by law-of-cosines on the
 *      triangle (hip, knee, ankle) with the new ankle distance =
 *      min(|target − hip|, upperLen + lowerLen − EPS). The pole
 *      hint disambiguates which side of the hip→ankle axis the knee
 *      sits on.
 *   4. The second delta rotates the lower bone (knee) so the
 *      knee→ankle segment closes the triangle.
 *
 * Note: the deltas are **world-space relative rotations** to apply
 *  ON TOP of the bone's current world rotation. Callers must convert
 *  to local space before writing to `bone.quaternion` (see
 *  `applyTwoBoneIK`).
 */
export function solveTwoBoneIK(input: TwoBoneInput): TwoBoneOutput {
  const { hip, knee, ankle, target, pole } = input;

  _vHipToKnee.subVectors(knee, hip);
  _vKneeToAnkle.subVectors(ankle, knee);
  _vHipToAnkle.subVectors(ankle, hip);
  _vHipToTarget.subVectors(target, hip);

  const upperLen = _vHipToKnee.length();
  const lowerLen = _vKneeToAnkle.length();
  const currentDist = _vHipToAnkle.length();
  const targetDist = _vHipToTarget.length();

  // Clamp the effective target distance into [|upper - lower|, upper + lower].
  // Outside this range the triangle is degenerate; we still rotate the
  // chain to point at the target but the ankle won't reach.
  const maxReach = upperLen + lowerLen - EPS;
  const minReach = Math.abs(upperLen - lowerLen) + EPS;
  const clamped = Math.max(minReach, Math.min(maxReach, targetDist));
  const reached = targetDist >= minReach && targetDist <= maxReach;

  // ── Delta 1: hip rotation that aligns the (hip→ankle) direction
  // with the (hip→target) direction. setFromUnitVectors handles the
  // 180° antipodal case internally.
  const hipDelta = new THREE.Quaternion();
  if (currentDist > EPS && targetDist > EPS) {
    _v1.copy(_vHipToAnkle).normalize();
    _v2.copy(_vHipToTarget).normalize();
    hipDelta.setFromUnitVectors(_v1, _v2);
  }

  // ── Knee bend angle by law of cosines on the new triangle.
  //   cos(hipAngle) = (upper² + clamped² − lower²) / (2 · upper · clamped)
  //   cos(kneeAngle) = (upper² + lower² − clamped²) / (2 · upper · lower)
  // We compute the *current* hip and knee angles too so the deltas
  // describe the change, not the absolute rotation.
  const cosHipNew = clampCos((upperLen * upperLen + clamped * clamped - lowerLen * lowerLen) / (2 * upperLen * clamped));
  const cosHipCur = clampCos(
    currentDist > EPS
      ? (upperLen * upperLen + currentDist * currentDist - lowerLen * lowerLen) / (2 * upperLen * currentDist)
      : 1,
  );
  const cosKneeNew = clampCos((upperLen * upperLen + lowerLen * lowerLen - clamped * clamped) / (2 * upperLen * lowerLen));
  const cosKneeCur = clampCos(
    currentDist > EPS
      ? (upperLen * upperLen + lowerLen * lowerLen - currentDist * currentDist) / (2 * upperLen * lowerLen)
      : 1,
  );

  const dHip = Math.acos(cosHipNew) - Math.acos(cosHipCur);
  const dKnee = Math.acos(cosKneeCur) - Math.acos(cosKneeNew);
  // Sign convention: positive `dKnee` extends the leg (closes
  // toward straight) when target distance grows; negative folds.
  // Negate so the rotation we apply reduces the knee's bend angle
  // when the chain straightens.

  // ── Knee bend axis: orthogonal to (hip→target) and biased toward
  // the pole hint. We project the pole into the plane perpendicular
  // to the hip→target axis, then take the cross product to get the
  // bend axis.
  const bendAxis = new THREE.Vector3();
  if (targetDist > EPS) {
    const targetDir = _v1.copy(_vHipToTarget).normalize();
    // pole projected into plane ⟂ targetDir
    const poleDot = pole.dot(targetDir);
    bendAxis.copy(pole).addScaledVector(targetDir, -poleDot);
    if (bendAxis.lengthSq() < EPS) {
      // pole was colinear with targetDir — pick any orthogonal axis
      bendAxis.set(targetDir.y, -targetDir.x, 0);
      if (bendAxis.lengthSq() < EPS) bendAxis.set(0, 0, 1);
    }
    bendAxis.normalize();
    // The bend axis is perpendicular to BOTH targetDir and the
    // projected pole — that's the rotation axis the knee revolves
    // around. cross(targetDir, projectedPole) gives a stable axis.
    bendAxis.crossVectors(targetDir, bendAxis).normalize();
  } else {
    bendAxis.set(1, 0, 0);
  }

  // Hip delta = hipDelta (alignment) ∘ axis-angle(bendAxis, dHip)
  const hipBend = _axis.setFromAxisAngle(bendAxis, dHip);
  const hipDeltaWorld = hipDelta.multiply(hipBend).clone();

  // Knee delta = axis-angle(bendAxis, dKnee). Knee rotates around the
  // same bend axis but in the opposite sense (the hip opens, the knee
  // closes by an equal-and-opposite share of the bend change).
  const kneeDeltaWorld = new THREE.Quaternion().setFromAxisAngle(bendAxis, dKnee);

  return { hipDeltaWorld, kneeDeltaWorld, reached };
}

/** Clamp a cosine to [−1, 1] to keep `Math.acos` real. NaN returns 1
 *  (treat as zero angle) to keep the caller robust against degenerate
 *  poses (e.g. zero-length bones during the first frame of a clone). */
function clampCos(x: number): number {
  if (Number.isNaN(x)) return 1;
  return Math.max(-1, Math.min(1, x));
}

/**
 * Apply a world-space delta rotation to a bone. Converts the delta
 * to local space using the bone's parent's world quaternion, then
 * pre-multiplies into the bone's local rotation.
 *
 *   newWorldQ = deltaWorld · oldWorldQ
 *   newLocalQ = parentWorldInv · deltaWorld · parentWorld · oldLocalQ
 *
 * Pulled out as a helper because both the foot-IK driver and any
 * future hand-IK / look-at code will need the exact same conversion.
 */
export function applyDeltaWorld(bone: THREE.Object3D, deltaWorld: THREE.Quaternion): void {
  bone.updateWorldMatrix(true, false);
  const parentInv = new THREE.Quaternion();
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentInv).invert();
  }
  // local = parentInv · deltaWorld · (parentInv⁻¹) · localOld
  // simpler: world = parent · local, so newLocal = parentInv · (delta · oldWorld)
  const oldWorld = new THREE.Quaternion();
  bone.getWorldQuaternion(oldWorld);
  const newWorld = deltaWorld.clone().multiply(oldWorld);
  bone.quaternion.copy(parentInv.multiply(newWorld));
}
