import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BIP001_BONE_NAMES,
  buildBipedRagdollSpec,
  captureBonePoses,
  getBipedRagdollBones,
  type RagdollBoneSlot,
} from "../ragdoll";

describe("buildBipedRagdollSpec", () => {
  it("produces 13 bodies (12 listed + spine; canonical biped chain)", () => {
    const spec = buildBipedRagdollSpec();
    // Spec lists pelvis, spine, head, 2 arms × 2 segments, 2 legs ×
    // 3 segments = 13 bodies. The "12-body" docstring counts the
    // user-visible major segments minus pelvis (which is the root).
    expect(spec.bodies).toHaveLength(13);
    const slots = spec.bodies.map((b) => b.slot);
    expect(new Set(slots).size).toBe(slots.length); // no duplicates
  });

  it("produces exactly 11 joints (right ankle intentionally omitted)", () => {
    const spec = buildBipedRagdollSpec();
    expect(spec.joints).toHaveLength(11);
    const hasRightAnkle = spec.joints.some(
      (j) => j.parent === "rightCalf" && j.child === "rightFoot",
    );
    expect(hasRightAnkle).toBe(false);
  });

  it("every joint references valid body slots", () => {
    const spec = buildBipedRagdollSpec();
    const slotSet = new Set(spec.bodies.map((b) => b.slot));
    for (const j of spec.joints) {
      expect(slotSet.has(j.parent)).toBe(true);
      expect(slotSet.has(j.child)).toBe(true);
    }
  });

  it("knees are revolute hinges with anatomical limits (knee bends backward only)", () => {
    const spec = buildBipedRagdollSpec();
    const leftKnee = spec.joints.find((j) => j.parent === "leftThigh" && j.child === "leftCalf");
    expect(leftKnee?.kind).toBe("revolute");
    expect(leftKnee?.limits.max).toBeLessThanOrEqual(0); // can't hyperextend
    expect(leftKnee?.limits.min).toBeLessThan(0);
  });

  it("scale parameter scales both half-heights and radii proportionally", () => {
    const a = buildBipedRagdollSpec(1);
    const b = buildBipedRagdollSpec(2);
    for (let i = 0; i < a.bodies.length; i++) {
      expect(b.bodies[i].radius).toBeCloseTo(a.bodies[i].radius * 2, 6);
      expect(b.bodies[i].capsuleHalfHeight).toBeCloseTo(a.bodies[i].capsuleHalfHeight * 2, 6);
    }
  });

  it("all body masses are positive + finite", () => {
    for (const b of buildBipedRagdollSpec().bodies) {
      expect(b.mass).toBeGreaterThan(0);
      expect(Number.isFinite(b.mass)).toBe(true);
    }
  });
});

describe("getBipedRagdollBones", () => {
  function makeRig(slots: RagdollBoneSlot[]): THREE.Object3D {
    const root = new THREE.Group();
    for (const s of slots) {
      const o = new THREE.Object3D();
      o.name = BIP001_BONE_NAMES[s];
      root.add(o);
    }
    return root;
  }

  it("returns null when pelvis is missing", () => {
    const rig = makeRig(["spine", "head"]);
    expect(getBipedRagdollBones(rig)).toBeNull();
  });

  it("returns null when spine is missing", () => {
    const rig = makeRig(["pelvis", "head"]);
    expect(getBipedRagdollBones(rig)).toBeNull();
  });

  it("resolves all present bones when pelvis + spine are present", () => {
    const rig = makeRig(["pelvis", "spine", "head", "leftThigh", "leftCalf"]);
    const r = getBipedRagdollBones(rig);
    expect(r).not.toBeNull();
    expect(r?.pelvis?.name).toBe("Bip001 Pelvis");
    expect(r?.head?.name).toBe("Bip001 Head");
    expect(r?.leftCalf?.name).toBe("Bip001 L Calf");
    expect(r?.rightFoot).toBeUndefined();
  });

  it("caches the result per scene root (idempotent calls)", () => {
    const rig = makeRig(["pelvis", "spine"]);
    const a = getBipedRagdollBones(rig);
    const b = getBipedRagdollBones(rig);
    expect(a).toBe(b);
  });
});

describe("captureBonePoses", () => {
  it("records world positions + quaternions for every supplied bone", () => {
    const root = new THREE.Group();
    const pelvis = new THREE.Object3D();
    pelvis.name = BIP001_BONE_NAMES.pelvis;
    pelvis.position.set(1, 2, 3);
    pelvis.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    root.add(pelvis);
    root.updateMatrixWorld(true);
    const poses = captureBonePoses({ pelvis });
    expect(poses.pelvis).toBeDefined();
    expect(poses.pelvis?.position[0]).toBeCloseTo(1, 5);
    expect(poses.pelvis?.position[1]).toBeCloseTo(2, 5);
    expect(poses.pelvis?.position[2]).toBeCloseTo(3, 5);
    // Quaternion magnitude ≈ 1
    const [x, y, z, w] = poses.pelvis!.quaternion;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 5);
  });

  it("returns empty when given no bones", () => {
    expect(captureBonePoses({})).toEqual({});
  });
});
