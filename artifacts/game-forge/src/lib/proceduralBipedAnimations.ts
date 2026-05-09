import * as THREE from "three";

/**
 * Procedural locomotion clips for the toon-rts character pack.
 *
 * Why this exists: the public toon-rts character GLBs ship with zero
 * baked animations (verified by direct CDN probe — see the comment in
 * `builtinModels.ts → BUILTIN_MODEL_CLIPS`). The manifest references
 * separate `animationsweapons/male_locomotion/` packs but those URLs
 * return 404 today. Until the asset pack is re-exported with clips
 * baked in, we synthesize a small procedural set against the shared
 * 3ds-Max biped skeleton (`Bip001 …` bone names) at load time and
 * inject the result into `gltf.animations`. The existing crossfade
 * bridge in `EntityRenderer.LoadedModel` then "just works" — drei's
 * `useAnimations` discovers `idle / walk / run / attack` and the
 * 0.2s crossfade in `pickClipName` transitions between them.
 *
 * The synthesizer is a no-op for any rig that doesn't expose the
 * tell-tale Bip001 bone names, so it never fights the bundled
 * `builtin:character` rig (which already faces -Z and may carry its
 * own clips) or any user-imported model.
 *
 * Design choices:
 *   - We capture each animated bone's REST quaternion + position from
 *     the source `gltf.scene` once, then build absolute tracks as
 *     `restQ * deltaQ` per keyframe. This avoids needing additive
 *     blending support and keeps standard crossfading working.
 *   - All swing rotations use the bone's LOCAL Z axis. In the Max
 *     biped convention used here, Z is the "swing" axis for limb
 *     bones (legs/arms in the sagittal plane).
 *   - Clip names match the writer call sites in
 *     `CameraControllers.writeAgentClip` and
 *     `deathmatchBehaviors → enemy-rpg → publishClip` so writes
 *     resolve to a real action without renaming.
 */

const ANIM_BONES = [
  "Bip001 Pelvis",
  "Bip001 Spine",
  "Bip001 Neck",
  "Bip001 Head",
  "Bip001 L Clavicle",
  "Bip001 L UpperArm",
  "Bip001 L Forearm",
  "Bip001 R Clavicle",
  "Bip001 R UpperArm",
  "Bip001 R Forearm",
  "Bip001 L Thigh",
  "Bip001 L Calf",
  "Bip001 R Thigh",
  "Bip001 R Calf",
] as const;

interface BoneRest {
  q: THREE.Quaternion;
  p: THREE.Vector3;
}

function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/** Cheap structural test — present on every toon-rts race rig and absent
 *  from non-biped imports / the bundled `builtin:character` rig. */
export function hasBipedSkeleton(root: THREE.Object3D): boolean {
  return (
    findBone(root, "Bip001 Pelvis") !== null &&
    findBone(root, "Bip001 R UpperArm") !== null &&
    findBone(root, "Bip001 L Thigh") !== null
  );
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function deltaQ(axis: THREE.Vector3, angle: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(axis, angle);
}

/** Per-bone delta for a locomotion gait at normalized phase t∈[0,1].
 *  Returns null for bones we don't drive (so the track is skipped). */
function locoDelta(
  boneName: string,
  t: number,
  ampLeg: number,
  ampArm: number,
  ampKnee: number,
): THREE.Quaternion | null {
  // Two-step cycle: L leg leads on the rising half, R leg leads on the
  // falling half. Arms swing opposite to the same-side leg.
  const phaseL = Math.sin(t * Math.PI * 2);
  const phaseR = Math.sin((t + 0.5) * Math.PI * 2);
  // Knee bend kicks in only on the backswing (negative phase) so the
  // foot lifts behind the body, not in front of it.
  const kneeL = Math.max(0, -phaseL);
  const kneeR = Math.max(0, -phaseR);

  switch (boneName) {
    case "Bip001 L Thigh":    return deltaQ(Z_AXIS,  phaseL * ampLeg);
    case "Bip001 R Thigh":    return deltaQ(Z_AXIS,  phaseR * ampLeg);
    case "Bip001 L Calf":     return deltaQ(Z_AXIS,  kneeL * ampKnee);
    case "Bip001 R Calf":     return deltaQ(Z_AXIS,  kneeR * ampKnee);
    case "Bip001 L UpperArm": return deltaQ(Z_AXIS,  phaseR * ampArm);
    case "Bip001 R UpperArm": return deltaQ(Z_AXIS,  phaseL * ampArm);
    case "Bip001 L Forearm":  return deltaQ(Z_AXIS,  Math.abs(phaseR) * ampArm * 0.4);
    case "Bip001 R Forearm":  return deltaQ(Z_AXIS,  Math.abs(phaseL) * ampArm * 0.4);
    case "Bip001 Spine":      return deltaQ(Y_AXIS,  phaseL * 0.05);
    default:                  return null;
  }
}

function idleDelta(boneName: string, t: number): THREE.Quaternion | null {
  // Subtle breathing + a barely-noticeable head sway.
  const breathe = Math.sin(t * Math.PI * 2) * 0.03;
  switch (boneName) {
    case "Bip001 Spine": return deltaQ(Z_AXIS, breathe);
    case "Bip001 Head":  return deltaQ(Y_AXIS, Math.sin(t * Math.PI * 2) * 0.04);
    default:             return null;
  }
}

function attackDelta(boneName: string, t: number): THREE.Quaternion | null {
  // Triangle wave: 0 → 1 over [0,0.5], 1 → 0 over [0.5,1] — a single
  // overhand strike that returns to the rest pose so the next clip
  // crossfades cleanly back into idle / walk / run.
  const u = t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2;
  switch (boneName) {
    case "Bip001 R UpperArm": return deltaQ(Z_AXIS, -u * 1.6);
    case "Bip001 R Forearm":  return deltaQ(Z_AXIS,  u * 0.8);
    case "Bip001 Spine":      return deltaQ(Y_AXIS,  u * 0.2);
    default:                  return null;
  }
}

/** Vertical pelvis bob — twice per gait cycle (one per foot strike).
 *  Centered around 0 so the entity transform stays on the navmesh. */
function locoPelvisOffset(t: number, bobAmp: number): number {
  return Math.abs(Math.sin(t * Math.PI * 2)) * bobAmp - bobAmp * 0.5;
}

function buildClip(
  name: string,
  duration: number,
  rest: ReadonlyMap<string, BoneRest>,
  perBone: (boneName: string, t: number) => THREE.Quaternion | null,
  pelvisBob: ((t: number) => number) | null,
  steps: number,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i++) times[i] = (i / steps) * duration;

  for (const boneName of ANIM_BONES) {
    const restEntry = rest.get(boneName);
    if (!restEntry) continue;
    const values = new Float32Array((steps + 1) * 4);
    let varied = false;
    for (let i = 0; i <= steps; i++) {
      const t = times[i] / duration;
      const delta = perBone(boneName, t);
      const q = delta ? restEntry.q.clone().multiply(delta) : restEntry.q.clone();
      if (delta && (delta.x !== 0 || delta.y !== 0 || delta.z !== 0)) varied = true;
      values[i * 4]     = q.x;
      values[i * 4 + 1] = q.y;
      values[i * 4 + 2] = q.z;
      values[i * 4 + 3] = q.w;
    }
    if (!varied) continue; // Skip flat tracks — saves mixer work.
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${boneName}.quaternion`,
        Array.from(times),
        Array.from(values),
      ),
    );
  }

  if (pelvisBob) {
    const pelvisRest = rest.get("Bip001 Pelvis");
    if (pelvisRest) {
      const pvalues = new Float32Array((steps + 1) * 3);
      for (let i = 0; i <= steps; i++) {
        const t = times[i] / duration;
        pvalues[i * 3]     = pelvisRest.p.x;
        pvalues[i * 3 + 1] = pelvisRest.p.y + pelvisBob(t);
        pvalues[i * 3 + 2] = pelvisRest.p.z;
      }
      tracks.push(
        new THREE.VectorKeyframeTrack(
          "Bip001 Pelvis.position",
          Array.from(times),
          Array.from(pvalues),
        ),
      );
    }
  }

  return new THREE.AnimationClip(name, duration, tracks);
}

/** Per-source-scene cache so we only walk the bone tree once per GLB,
 *  even when many entities share the same race model. WeakMap so
 *  unloaded scenes can be GC'd. */
const CLIP_CACHE = new WeakMap<THREE.Object3D, THREE.AnimationClip[]>();

/** Build (and cache) idle / walk / run / attack clips for a Bip001 rig.
 *  Returns an empty array if the rig doesn't look like a Max biped. */
export function synthesizeBipedClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const cached = CLIP_CACHE.get(root);
  if (cached) return cached;
  if (!hasBipedSkeleton(root)) {
    CLIP_CACHE.set(root, []);
    return [];
  }
  const rest = new Map<string, BoneRest>();
  for (const name of ANIM_BONES) {
    const bone = findBone(root, name);
    if (!bone) continue;
    rest.set(name, { q: bone.quaternion.clone(), p: bone.position.clone() });
  }

  const clips: THREE.AnimationClip[] = [
    buildClip("idle",   2.4,  rest, idleDelta,                             null,                                  24),
    buildClip("walk",   1.0,  rest, (b, t) => locoDelta(b, t, 0.45, 0.35, 0.6),  (t) => locoPelvisOffset(t, 0.04), 20),
    buildClip("run",    0.55, rest, (b, t) => locoDelta(b, t, 0.70, 0.55, 0.95), (t) => locoPelvisOffset(t, 0.08), 20),
    buildClip("attack", 0.5,  rest, attackDelta,                           null,                                  16),
  ];
  CLIP_CACHE.set(root, clips);
  return clips;
}

/** Canonical clip-name set the synthesizer emits. Exported so the
 *  per-race tables in `builtinModels.ts` and `deathmatchBehaviors.ts`
 *  can reference it instead of duplicating string literals (and so
 *  unit tests can assert the catalog stays in sync). */
export const PROCEDURAL_BIPED_CLIP_NAMES = {
  idle: "idle",
  walk: "walk",
  run: "run",
  attack: "attack",
} as const;
