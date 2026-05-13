import type * as THREE from "three";

/**
 * Mixamo → 3ds-Max biped bone-name remap.
 *
 * Why this exists: Mixamo's free animation library (the de-facto source
 * of off-the-shelf rifle / pistol / sword / locomotion clips for indie
 * games) bakes every clip against a fixed naming convention —
 * `mixamorig:Hips`, `mixamorig:LeftUpLeg`, `mixamorig:RightArm`, etc.
 * Our six toon-rts character GLBs are rigged with the **3ds-Max biped**
 * convention — `Bip001 Pelvis`, `Bip001 L Thigh`, `Bip001 R UpperArm`.
 * The bone hierarchies are *semantically* identical (root-pelvis-spine-
 * neck-head plus 3-bone legs / arms / 5-finger hands) but every name is
 * different, so a Mixamo `AnimationClip` plugged straight into our rig
 * silently no-ops — the AnimationMixer can't find any of its target
 * bones.
 *
 * This table is the bridge. The runtime retargeter (`animationRetarget.ts`)
 * walks every track of a Mixamo clip, looks up the new node name here,
 * and rewrites the track in place (cached). The reverse direction is
 * also useful (e.g. for the asset browser drop-zone preview), so we
 * provide `mixamoBoneFor(bipedName)` too.
 *
 * Coverage: only the bones the Bip001 character pack actually exports.
 * Mixamo rigs ship a full 5-finger hand (`mixamorig:LeftHandIndex1` …);
 * the toon-rts characters do not — those tracks must be dropped, not
 * mapped to nothing, otherwise the mixer warns once per frame. The
 * retargeter handles drop-on-undefined.
 *
 * Pure data + two pure functions; no THREE imports needed at runtime.
 * Type-only `THREE` import keeps the detector signature accurate
 * without forcing the bundler to drag THREE into this module.
 */

/** Canonical map: Mixamo bone path → Bip001 bone name. Keys are the
 *  `nodeName` portion of a track (no `.quaternion` / `.position`
 *  suffix). Values are the exact bone names produced by the toon-rts
 *  exporter and asserted by `proceduralBipedAnimations.ts → ANIM_BONES`. */
export const MIXAMO_TO_BIPED: Readonly<Record<string, string>> = Object.freeze({
  // Root + spine
  "mixamorig:Hips": "Bip001 Pelvis",
  "mixamorig:Spine": "Bip001 Spine",
  "mixamorig:Spine1": "Bip001 Spine1",
  "mixamorig:Spine2": "Bip001 Spine2",
  "mixamorig:Neck": "Bip001 Neck",
  "mixamorig:Head": "Bip001 Head",

  // Left arm
  "mixamorig:LeftShoulder": "Bip001 L Clavicle",
  "mixamorig:LeftArm": "Bip001 L UpperArm",
  "mixamorig:LeftForeArm": "Bip001 L Forearm",
  "mixamorig:LeftHand": "Bip001 L Hand",

  // Right arm
  "mixamorig:RightShoulder": "Bip001 R Clavicle",
  "mixamorig:RightArm": "Bip001 R UpperArm",
  "mixamorig:RightForeArm": "Bip001 R Forearm",
  "mixamorig:RightHand": "Bip001 R Hand",

  // Left leg (3-bone chain — Mixamo's Foot maps to biped Foot;
  // ToeBase has no equivalent on the toon-rts rig and is intentionally
  // OMITTED from this table so the retargeter drops it cleanly).
  "mixamorig:LeftUpLeg": "Bip001 L Thigh",
  "mixamorig:LeftLeg": "Bip001 L Calf",
  "mixamorig:LeftFoot": "Bip001 L Foot",

  // Right leg
  "mixamorig:RightUpLeg": "Bip001 R Thigh",
  "mixamorig:RightLeg": "Bip001 R Calf",
  "mixamorig:RightFoot": "Bip001 R Foot",
});

/** Reverse lookup index, lazily built on first use (the keyset above
 *  is closed/frozen so building it once is safe). */
let _reverse: Map<string, string> | null = null;
function reverse(): Map<string, string> {
  if (_reverse) return _reverse;
  _reverse = new Map();
  for (const [src, dst] of Object.entries(MIXAMO_TO_BIPED)) {
    _reverse.set(dst, src);
  }
  return _reverse;
}

/** Map a Mixamo node name to its Bip001 equivalent. Returns `undefined`
 *  for bones with no equivalent (fingers, toes) — callers MUST treat
 *  this as "drop the track" not "use the original name". */
export function bipedBoneFor(mixamoName: string): string | undefined {
  return MIXAMO_TO_BIPED[mixamoName];
}

/** Inverse of {@link bipedBoneFor}. Useful when surfacing a Mixamo clip
 *  for preview before retargeting. */
export function mixamoBoneFor(bipedName: string): string | undefined {
  return reverse().get(bipedName);
}

/** True when the scene root contains the tell-tale `mixamorig:Hips`
 *  bone — the cheapest reliable signal that a GLB came out of Mixamo.
 *
 *  Cheaper than walking every track of every animation clip, and
 *  unambiguous: the `mixamorig:` prefix is unique to Mixamo's exporter
 *  and isn't used by Maya / Blender / Max stock rigs. The toon-rts
 *  pack's `Bip001 *` convention won't match.
 *
 *  We also accept the rare un-prefixed variant ("Hips" + "LeftUpLeg")
 *  some users get when running Mixamo files through Blender's "Strip
 *  prefix" option — same skeleton topology, same retargeting math
 *  applies. */
export function isMixamoSkeleton(root: THREE.Object3D): boolean {
  let prefixed = false;
  let bareHips = false;
  let bareLeftUp = false;
  root.traverse((o) => {
    if (prefixed) return;
    if (o.name === "mixamorig:Hips") {
      prefixed = true;
      return;
    }
    if (o.name === "Hips") bareHips = true;
    if (o.name === "LeftUpLeg") bareLeftUp = true;
  });
  return prefixed || (bareHips && bareLeftUp);
}

/** Strip the optional `mixamorig:` prefix so callers can treat both
 *  exporter variants uniformly. Returns the original string when no
 *  prefix is present — never throws. */
export function stripMixamoPrefix(name: string): string {
  return name.startsWith("mixamorig:") ? name.slice("mixamorig:".length) : name;
}
