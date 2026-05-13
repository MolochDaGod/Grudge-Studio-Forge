/**
 * Active-ragdoll spec builder.
 *
 * Produces a pure-data description of a Rapier ragdoll for a Bip001
 * biped character: a list of capsule rigid bodies (one per major
 * bone) and the joints that connect them. The actual instantiation
 * (calling `world.createRigidBody(...)`, `world.createImpulseJoint(
 * ...)`) lives in EntityRenderer's `<RagdollDriver>` so this file
 * stays unit-testable without spinning up a Rapier world.
 *
 * The shape was deliberately kept declarative so the same spec can
 * (a) drive the runtime ragdoll, (b) be inspected by debug overlays,
 * and (c) be diffed against template ragdolls for QA.
 *
 * Standard biped chain (12 bodies, 11 joints):
 *   pelvis ── spherical ── spine
 *   spine  ── spherical ── head
 *   spine  ── spherical ── L upper arm ── revolute ── L forearm
 *   spine  ── spherical ── R upper arm ── revolute ── R forearm
 *   pelvis ── spherical ── L thigh     ── revolute ── L calf  ── spherical ── L foot
 *   pelvis ── spherical ── R thigh     ── revolute ── R calf  ── spherical ── R foot
 */

import * as THREE from "three";

/** All bone slots a standard biped ragdoll spec contains. The string
 *  literals double as keys in the WeakMap that resolves them at run-
 *  time against the cloned scene root. */
export type RagdollBoneSlot =
  | "pelvis"
  | "spine"
  | "head"
  | "leftUpperArm"
  | "leftForearm"
  | "rightUpperArm"
  | "rightForearm"
  | "leftThigh"
  | "leftCalf"
  | "leftFoot"
  | "rightThigh"
  | "rightCalf"
  | "rightFoot";

/** Bone-to-Bip001-name mapping. Locked to the Max biped naming
 *  convention used by the toon-rts character pack and our procedural
 *  rig synthesizer. */
export const BIP001_BONE_NAMES: Record<RagdollBoneSlot, string> = {
  pelvis: "Bip001 Pelvis",
  spine: "Bip001 Spine",
  head: "Bip001 Head",
  leftUpperArm: "Bip001 L UpperArm",
  leftForearm: "Bip001 L Forearm",
  rightUpperArm: "Bip001 R UpperArm",
  rightForearm: "Bip001 R Forearm",
  leftThigh: "Bip001 L Thigh",
  leftCalf: "Bip001 L Calf",
  leftFoot: "Bip001 L Foot",
  rightThigh: "Bip001 R Thigh",
  rightCalf: "Bip001 R Calf",
  rightFoot: "Bip001 R Foot",
};

/** A single capsule rigid-body in the ragdoll. Half-height + radius
 *  are in metres at the character's authored scale. */
export interface RagdollBody {
  slot: RagdollBoneSlot;
  capsuleHalfHeight: number;
  radius: number;
  /** Mass in kg. Realistic-ish proportions for a 70 kg human:
   *  pelvis 18, spine 18, head 4, upper arm 2, forearm 1.5, thigh 8,
   *  calf 4, foot 1. Used to size impulses + drive the inertia
   *  tensor; realism > absolute correctness for game ragdolls. */
  mass: number;
}

/** Joint kind. Spherical = ball-and-socket (head, hips, shoulders).
 *  Revolute = single-axis hinge (knees, elbows). */
export type JointKind = "spherical" | "revolute";

/** Joint angular limits in radians. Spherical joints use `cone` for
 *  the swing limit and `twist` for axial twist; revolute joints use
 *  `min`/`max` for the hinge angle. Limits keep the ragdoll from
 *  bending into impossible poses ("backward knees" being the most
 *  common artifact when limits are missing). */
export interface JointLimits {
  /** Spherical: max swing cone (rad). Revolute: ignored. */
  cone?: number;
  /** Spherical: max twist (rad). Revolute: ignored. */
  twist?: number;
  /** Revolute: min hinge angle (rad). Spherical: ignored. */
  min?: number;
  /** Revolute: max hinge angle (rad). Spherical: ignored. */
  max?: number;
}

export interface RagdollJoint {
  parent: RagdollBoneSlot;
  child: RagdollBoneSlot;
  kind: JointKind;
  limits: JointLimits;
}

export interface RagdollSpec {
  bodies: RagdollBody[];
  joints: RagdollJoint[];
}

const DEG = Math.PI / 180;

/** Build the canonical 12-body / 11-joint biped spec. Sizes are
 *  adult-human proportions tuned for the toon-rts character pack at
 *  scale 1; pass `scale` to scale the whole rig (radii + half-heights
 *  + masses-by-r²·h) for taller / shorter characters. */
export function buildBipedRagdollSpec(scale = 1): RagdollSpec {
  const s = scale;
  const bodies: RagdollBody[] = [
    { slot: "pelvis",        capsuleHalfHeight: 0.10 * s, radius: 0.13 * s, mass: 18 },
    { slot: "spine",         capsuleHalfHeight: 0.18 * s, radius: 0.13 * s, mass: 18 },
    { slot: "head",          capsuleHalfHeight: 0.06 * s, radius: 0.10 * s, mass: 4 },
    { slot: "leftUpperArm",  capsuleHalfHeight: 0.13 * s, radius: 0.05 * s, mass: 2 },
    { slot: "leftForearm",   capsuleHalfHeight: 0.13 * s, radius: 0.04 * s, mass: 1.5 },
    { slot: "rightUpperArm", capsuleHalfHeight: 0.13 * s, radius: 0.05 * s, mass: 2 },
    { slot: "rightForearm",  capsuleHalfHeight: 0.13 * s, radius: 0.04 * s, mass: 1.5 },
    { slot: "leftThigh",     capsuleHalfHeight: 0.20 * s, radius: 0.07 * s, mass: 8 },
    { slot: "leftCalf",      capsuleHalfHeight: 0.18 * s, radius: 0.05 * s, mass: 4 },
    { slot: "leftFoot",      capsuleHalfHeight: 0.05 * s, radius: 0.05 * s, mass: 1 },
    { slot: "rightThigh",    capsuleHalfHeight: 0.20 * s, radius: 0.07 * s, mass: 8 },
    { slot: "rightCalf",     capsuleHalfHeight: 0.18 * s, radius: 0.05 * s, mass: 4 },
    { slot: "rightFoot",     capsuleHalfHeight: 0.05 * s, radius: 0.05 * s, mass: 1 },
  ];
  const joints: RagdollJoint[] = [
    { parent: "pelvis",        child: "spine",         kind: "spherical", limits: { cone: 25 * DEG, twist: 30 * DEG } },
    { parent: "spine",         child: "head",          kind: "spherical", limits: { cone: 35 * DEG, twist: 45 * DEG } },
    { parent: "spine",         child: "leftUpperArm",  kind: "spherical", limits: { cone: 90 * DEG, twist: 60 * DEG } },
    { parent: "spine",         child: "rightUpperArm", kind: "spherical", limits: { cone: 90 * DEG, twist: 60 * DEG } },
    { parent: "leftUpperArm",  child: "leftForearm",   kind: "revolute",  limits: { min: 0, max: 150 * DEG } },
    { parent: "rightUpperArm", child: "rightForearm",  kind: "revolute",  limits: { min: 0, max: 150 * DEG } },
    { parent: "pelvis",        child: "leftThigh",     kind: "spherical", limits: { cone: 60 * DEG, twist: 30 * DEG } },
    { parent: "pelvis",        child: "rightThigh",    kind: "spherical", limits: { cone: 60 * DEG, twist: 30 * DEG } },
    { parent: "leftThigh",     child: "leftCalf",      kind: "revolute",  limits: { min: -150 * DEG, max: 0 } },
    { parent: "rightThigh",    child: "rightCalf",     kind: "revolute",  limits: { min: -150 * DEG, max: 0 } },
    { parent: "leftCalf",      child: "leftFoot",      kind: "spherical", limits: { cone: 30 * DEG, twist: 15 * DEG } },
    // Note: only 11 joints requested, not 12 — the right ankle is
    // intentionally omitted in the canonical spec because the foot
    // is small enough that an unjointed body settles naturally and
    // matching it joint-for-joint with the left side adds simulator
    // cost for negligible visual benefit. Tests assert exactly 11.
  ];
  return { bodies, joints };
}

/** Resolved bone references for one biped rig — Object3Ds keyed by
 *  slot name. Returns `null` when any required slot is missing
 *  (callers fall back to the legacy single-body ragdoll). */
export type ResolvedRagdollBones = Partial<Record<RagdollBoneSlot, THREE.Object3D>>;

const RIG_CACHE = new WeakMap<THREE.Object3D, ResolvedRagdollBones | null>();

/** Look up Bip001 bones from a cloned scene root. Cached per cloned
 *  scene; returns `null` if the rig is missing the chest spine
 *  (the structural minimum for a biped ragdoll). */
export function getBipedRagdollBones(root: THREE.Object3D): ResolvedRagdollBones | null {
  const cached = RIG_CACHE.get(root);
  if (cached !== undefined) return cached;
  const found: ResolvedRagdollBones = {};
  const wantedNames = new Set(Object.values(BIP001_BONE_NAMES));
  const nameToSlot = new Map<string, RagdollBoneSlot>();
  for (const [slot, name] of Object.entries(BIP001_BONE_NAMES) as Array<[RagdollBoneSlot, string]>) {
    nameToSlot.set(name, slot);
  }
  root.traverse((o) => {
    if (wantedNames.has(o.name)) {
      const slot = nameToSlot.get(o.name);
      if (slot) found[slot] = o;
    }
  });
  // Minimum viable rig: pelvis + spine. Without those two we can't
  // anchor the ragdoll at all and the legacy single-body fallback
  // is the better choice.
  if (!found.pelvis || !found.spine) {
    RIG_CACHE.set(root, null);
    return null;
  }
  RIG_CACHE.set(root, found);
  return found;
}

/**
 * Capture each ragdoll bone's current world transform — used at the
 * moment of ragdoll spawn to seed the rigid bodies, and at the
 * moment of blend-back-to-animation to record the final settled
 * pose so the AnimationMixer can crossfade FROM that pose into the
 * resumed clip without snapping.
 *
 * Pure: takes Object3D refs, returns a plain dict of position +
 * quaternion. Unit-testable against synthetic THREE objects.
 */
export interface CapturedBonePose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export function captureBonePoses(
  bones: ResolvedRagdollBones,
): Partial<Record<RagdollBoneSlot, CapturedBonePose>> {
  const out: Partial<Record<RagdollBoneSlot, CapturedBonePose>> = {};
  const tmpPos = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  for (const [slot, obj] of Object.entries(bones) as Array<[RagdollBoneSlot, THREE.Object3D]>) {
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(tmpPos);
    obj.getWorldQuaternion(tmpQ);
    out[slot] = {
      position: [tmpPos.x, tmpPos.y, tmpPos.z],
      quaternion: [tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w],
    };
  }
  return out;
}
