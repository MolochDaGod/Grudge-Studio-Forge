import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MIXAMO_TO_BIPED,
  bipedBoneFor,
  mixamoBoneFor,
  isMixamoSkeleton,
  stripMixamoPrefix,
} from "../mixamoBoneRemap";

describe("MIXAMO_TO_BIPED table integrity", () => {
  it("maps every value to a Bip001-prefixed bone (catches typos)", () => {
    // Cheapest invariant: a Mixamo bone may legitimately have no
    // biped equivalent (fingers/toes are intentionally absent), but
    // EVERY value in the table must point at a real Bip001 bone or
    // the retargeter rewrites tracks to bones that don't exist on
    // the rig — and the AnimationMixer silently drops them.
    for (const dst of Object.values(MIXAMO_TO_BIPED)) {
      expect(dst.startsWith("Bip001 ")).toBe(true);
    }
  });

  it("has no duplicate biped targets (would lose tracks on retarget)", () => {
    const targets = Object.values(MIXAMO_TO_BIPED);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("covers the canonical 6 spine + 8 limb-root bones at minimum", () => {
    // Regression guard against accidental table edits that would
    // remove core bones — without these, no Mixamo locomotion clip
    // can drive our rig at all.
    const required = [
      "mixamorig:Hips",
      "mixamorig:Spine",
      "mixamorig:Neck",
      "mixamorig:Head",
      "mixamorig:LeftArm",
      "mixamorig:RightArm",
      "mixamorig:LeftUpLeg",
      "mixamorig:RightUpLeg",
    ];
    for (const k of required) expect(MIXAMO_TO_BIPED[k]).toBeDefined();
  });
});

describe("bipedBoneFor / mixamoBoneFor", () => {
  it("round-trips every Mixamo bone in the table back to itself", () => {
    for (const src of Object.keys(MIXAMO_TO_BIPED)) {
      const target = bipedBoneFor(src);
      expect(target).toBeDefined();
      expect(mixamoBoneFor(target!)).toBe(src);
    }
  });

  it("returns undefined for bones with no equivalent (fingers, toes)", () => {
    // Caller contract: undefined → DROP the track. If the function
    // returned the original name on miss, the mixer would attach the
    // track to a non-existent `mixamorig:LeftHandIndex1` bone on the
    // biped rig and warn once per frame.
    expect(bipedBoneFor("mixamorig:LeftHandIndex1")).toBeUndefined();
    expect(bipedBoneFor("mixamorig:RightToeBase")).toBeUndefined();
    expect(bipedBoneFor("totally-fake-bone")).toBeUndefined();
  });
});

describe("isMixamoSkeleton", () => {
  it("returns true for the prefixed Mixamo convention", () => {
    const root = new THREE.Object3D();
    const hips = new THREE.Object3D();
    hips.name = "mixamorig:Hips";
    root.add(hips);
    expect(isMixamoSkeleton(root)).toBe(true);
  });

  it("returns true for the un-prefixed (Blender-stripped) variant", () => {
    // Some users run Mixamo .fbx through Blender with "Strip prefix"
    // checked, producing `Hips` + `LeftUpLeg` (no `mixamorig:`).
    // Topology is identical so we accept it as Mixamo.
    const root = new THREE.Object3D();
    const hips = new THREE.Object3D();
    hips.name = "Hips";
    const upLeg = new THREE.Object3D();
    upLeg.name = "LeftUpLeg";
    root.add(hips, upLeg);
    expect(isMixamoSkeleton(root)).toBe(true);
  });

  it("returns false for a Bip001 (toon-rts) rig", () => {
    // Critical negative case: misclassifying a toon-rts rig as Mixamo
    // would route it through the retargeter, which would rewrite all
    // `Bip001 *` track names to undefined and destroy the clip.
    const root = new THREE.Object3D();
    const pelvis = new THREE.Object3D();
    pelvis.name = "Bip001 Pelvis";
    root.add(pelvis);
    expect(isMixamoSkeleton(root)).toBe(false);
  });

  it("returns false when only ONE of the bare-naming markers is present", () => {
    // `Hips` alone is too common (Maya / Blender default rigs use it),
    // so we require BOTH `Hips` AND `LeftUpLeg` for the un-prefixed
    // case to avoid false positives on non-Mixamo rigs.
    const root = new THREE.Object3D();
    const hips = new THREE.Object3D();
    hips.name = "Hips";
    root.add(hips);
    expect(isMixamoSkeleton(root)).toBe(false);
  });
});

describe("stripMixamoPrefix", () => {
  it("removes the prefix when present", () => {
    expect(stripMixamoPrefix("mixamorig:LeftUpLeg")).toBe("LeftUpLeg");
  });
  it("is a no-op for un-prefixed names", () => {
    expect(stripMixamoPrefix("Bip001 Pelvis")).toBe("Bip001 Pelvis");
    expect(stripMixamoPrefix("Hips")).toBe("Hips");
  });
});
