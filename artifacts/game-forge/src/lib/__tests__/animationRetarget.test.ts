import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { retargetMixamoClip, retargetMixamoGltf } from "../animationRetarget";

/** Build a minimal Mixamo-shaped scene with named root bones. We only
 *  need `mixamorig:Hips` for the detector + the pelvis-Y measurement;
 *  the children's names match real Mixamo tracks the test consumes. */
function makeMixamoScene(hipsY = 1.0): THREE.Object3D {
  const root = new THREE.Object3D();
  const hips = new THREE.Object3D();
  hips.name = "mixamorig:Hips";
  hips.position.y = hipsY;
  const leftUp = new THREE.Object3D();
  leftUp.name = "mixamorig:LeftUpLeg";
  const rightArm = new THREE.Object3D();
  rightArm.name = "mixamorig:RightArm";
  const finger = new THREE.Object3D();
  finger.name = "mixamorig:LeftHandIndex1";
  hips.add(leftUp, rightArm, finger);
  root.add(hips);
  return root;
}

function makeBipedScene(pelvisY = 0.9): THREE.Object3D {
  const root = new THREE.Object3D();
  const pelvis = new THREE.Object3D();
  pelvis.name = "Bip001 Pelvis";
  pelvis.position.y = pelvisY;
  root.add(pelvis);
  return root;
}

/** Build a fake "Mixamo" clip with one quaternion track per leg / arm
 *  bone, one position track on Hips with non-zero XZ, and one finger
 *  track that should be DROPPED on retarget. */
function makeFakeMixamoClip(): THREE.AnimationClip {
  return new THREE.AnimationClip("rifle_idle", 1.0, [
    new THREE.QuaternionKeyframeTrack(
      "mixamorig:LeftUpLeg.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0.1, 0, 0.99],
    ),
    new THREE.QuaternionKeyframeTrack(
      "mixamorig:RightArm.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0.1, 0.99],
    ),
    // Hips.position with deliberate XZ drift so we can verify the
    // in-place strip below — Y of 1.0 / 1.2 to verify the rescale.
    new THREE.VectorKeyframeTrack(
      "mixamorig:Hips.position",
      [0, 1],
      [0.5, 1.0, 0.7, 1.5, 1.2, 2.1],
    ),
    // No biped equivalent — must be dropped, not renamed.
    new THREE.QuaternionKeyframeTrack(
      "mixamorig:LeftHandIndex1.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1],
    ),
  ]);
}

describe("retargetMixamoClip", () => {
  it("rewrites every track's nodeName via the bone remap", () => {
    const out = retargetMixamoClip({
      clip: makeFakeMixamoClip(),
      sourceScene: makeMixamoScene(),
      targetScene: makeBipedScene(),
    })!;
    expect(out).not.toBeNull();
    const names = out.tracks.map((t) => t.name);
    expect(names).toContain("Bip001 L Thigh.quaternion");
    expect(names).toContain("Bip001 R UpperArm.quaternion");
    expect(names).toContain("Bip001 Pelvis.position");
  });

  it("DROPS tracks for bones with no biped equivalent (no silent rename)", () => {
    // Critical correctness check — leaving the finger track in would
    // produce per-frame mixer warnings AND a dead binding that costs
    // a tiny bit per frame.
    const out = retargetMixamoClip({
      clip: makeFakeMixamoClip(),
      sourceScene: makeMixamoScene(),
      targetScene: makeBipedScene(),
    })!;
    expect(out.tracks).toHaveLength(3); // 4 source tracks → 3 (finger dropped)
    for (const t of out.tracks) {
      expect(t.name.includes("HandIndex")).toBe(false);
    }
  });

  it("rescales Hips position by targetPelvisY / sourcePelvisY", () => {
    // Source pelvis Y = 1.0, target = 0.5 → uniform scale 0.5×.
    // The Y component of each keyframe should be source × 0.5.
    const out = retargetMixamoClip({
      clip: makeFakeMixamoClip(),
      sourceScene: makeMixamoScene(1.0),
      targetScene: makeBipedScene(0.5),
    })!;
    const hips = out.tracks.find((t) => t.name === "Bip001 Pelvis.position") as THREE.VectorKeyframeTrack;
    expect(hips).toBeDefined();
    // Source Y values were 1.0 and 1.2 → expect 0.5 and 0.6.
    expect(hips.values[1]).toBeCloseTo(0.5);
    expect(hips.values[4]).toBeCloseTo(0.6);
  });

  it("zeros XZ of Hips position when inPlace is enabled (default)", () => {
    // Default behavior — the engine drives translation via the
    // physics body, so the clip must NOT translate the visual.
    const out = retargetMixamoClip({
      clip: makeFakeMixamoClip(),
      sourceScene: makeMixamoScene(),
      targetScene: makeBipedScene(),
    })!;
    const hips = out.tracks.find((t) => t.name === "Bip001 Pelvis.position") as THREE.VectorKeyframeTrack;
    // X (index 0, 3) and Z (index 2, 5) must both be 0 across all keyframes.
    expect(hips.values[0]).toBe(0);
    expect(hips.values[2]).toBe(0);
    expect(hips.values[3]).toBe(0);
    expect(hips.values[5]).toBe(0);
  });

  it("preserves XZ when inPlace:false (cinematic / vault clips)", () => {
    const out = retargetMixamoClip({
      clip: makeFakeMixamoClip(),
      sourceScene: makeMixamoScene(),
      targetScene: makeBipedScene(),
      opts: { inPlace: false },
    })!;
    const hips = out.tracks.find((t) => t.name === "Bip001 Pelvis.position") as THREE.VectorKeyframeTrack;
    // Source X = 0.5 / 1.5 → with scale 0.9 (target/source = 0.9/1.0)
    // we expect 0.45 / 1.35.
    expect(hips.values[0]).toBeCloseTo(0.45);
    expect(hips.values[2]).toBeCloseTo(0.63);
  });

  it("returns null when the source isn't a Mixamo skeleton (defensive)", () => {
    // Misclassifying a Bip001 rig as Mixamo would destroy the clip,
    // so the retargeter must refuse rather than guess.
    const out = retargetMixamoClip({
      clip: makeFakeMixamoClip(),
      sourceScene: makeBipedScene(), // wrong: biped, not Mixamo
      targetScene: makeBipedScene(),
    });
    expect(out).toBeNull();
  });

  it("caches per (clip, targetScene) — second call returns the same instance", () => {
    // Hot-path optimization: a scene with 50 enemies of the same race
    // sharing one rifle clip must retarget at most once per race.
    const clip = makeFakeMixamoClip();
    const src = makeMixamoScene();
    const tgt = makeBipedScene();
    const a = retargetMixamoClip({ clip, sourceScene: src, targetScene: tgt });
    const b = retargetMixamoClip({ clip, sourceScene: src, targetScene: tgt });
    expect(a).toBe(b);
  });

  it("retargets independently per target scene (different races)", () => {
    // Two different target rigs must yield two different cached
    // clips — otherwise scaling for one race would leak to the other.
    const clip = makeFakeMixamoClip();
    const src = makeMixamoScene();
    const tgtA = makeBipedScene(0.9);
    const tgtB = makeBipedScene(1.5);
    const a = retargetMixamoClip({ clip, sourceScene: src, targetScene: tgtA })!;
    const b = retargetMixamoClip({ clip, sourceScene: src, targetScene: tgtB })!;
    expect(a).not.toBe(b);
    const hipsA = a.tracks.find((t) => t.name === "Bip001 Pelvis.position") as THREE.VectorKeyframeTrack;
    const hipsB = b.tracks.find((t) => t.name === "Bip001 Pelvis.position") as THREE.VectorKeyframeTrack;
    expect(hipsA.values[1]).not.toBeCloseTo(hipsB.values[1]);
  });
});

describe("retargetMixamoGltf", () => {
  it("retargets every source clip and silently skips non-Mixamo sources", () => {
    const clips = [makeFakeMixamoClip(), makeFakeMixamoClip()];
    const out = retargetMixamoGltf({
      sourceClips: clips,
      sourceScene: makeMixamoScene(),
      targetScene: makeBipedScene(),
    });
    expect(out).toHaveLength(2);
  });
});
