import * as THREE from "three";
import {
  hasBipedSkeleton,
  type BipedAnimProfile,
  DEFAULT_BIPED_PROFILE,
} from "./proceduralBipedAnimations";

/**
 * Procedural rifle pose + locomotion clip set for the toon-rts character pack.
 *
 * Why this exists: the same reason {@link synthesizeBipedClips} exists —
 * the public toon-rts character GLBs ship with zero baked animations and
 * the manifest's separate weapon-locomotion packs return 404. Until real
 * Mixamo rifle clips are dropped via the AssetBrowser, we synthesize a
 * plausible "holding a rifle two-handed" pose set procedurally so a
 * fresh project can show armed characters that don't T-pose.
 *
 * Pose intent (right-handed shooter, butt at right shoulder, support
 * hand on the foregrip):
 *   - Right shoulder slightly raised, right elbow pulled in.
 *   - Left arm extends forward and slightly inward (foregrip cradle).
 *   - Spine rotates ~12° toward the target so the shooter is bladed.
 *   - Locomotion (walk / run) reuses the underlying biped gait but
 *     dampens arm swing to ~25% so the rifle doesn't visually flail.
 *   - `aim`  raises both arms further (sight-picture); short clip,
 *     loops naturally because `fire` and `reload` crossfade off it.
 *   - `fire` is a one-shot recoil pulse (right-arm push back, spine
 *     compress) that returns to aim in ~0.18s.
 *   - `reload` swings the support hand down toward the magazine well
 *     and back over ~1.4s.
 *
 * Clip-name convention: every emitted name is `rifle_<base>` so the
 * `pickClipName(base, pose)` helper in `builtinModels.ts` produces
 * `rifle_walk`, `rifle_aim`, etc. with no string concatenation in
 * the writers. Names are stable across profiles — only the per-bone
 * deltas change with the race profile (heavier races sway less).
 *
 * Pure: emits fresh `AnimationClip` instances; no caller mutation;
 * cached by `(sourceScene, profile.id)` so 50 enemies of the same
 * race holding rifles share one set.
 *
 * No-op when the rig isn't a Bip001 biped (returns `[]`) — exactly
 * the same contract as {@link synthesizeBipedClips}, so a non-biped
 * import never gets bogus rifle bindings.
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

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let f: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!f && o.name === name) f = o;
  });
  return f;
}

function dq(axis: THREE.Vector3, angle: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(axis, angle);
}

/** Compose multiple axis-angle deltas into a single quaternion in
 *  the listed order (extrinsic local frame). Returns identity for an
 *  empty list — never null, so caller doesn't need a falsy check. */
function compose(...parts: ReadonlyArray<[THREE.Vector3, number]>): THREE.Quaternion {
  const out = new THREE.Quaternion();
  for (const [axis, angle] of parts) {
    out.multiply(dq(axis, angle));
  }
  return out;
}

/** Static "rifle hold" pose deltas — applied to every rifle clip
 *  before any per-clip motion is added. This is the carriage that
 *  makes the character LOOK armed, even at rest. */
function rifleHoldDelta(boneName: string): THREE.Quaternion | null {
  switch (boneName) {
    case "Bip001 R Clavicle":  return dq(Z_AXIS, -0.10);
    case "Bip001 R UpperArm":  return compose([Z_AXIS, -0.55], [Y_AXIS,  0.30]);
    case "Bip001 R Forearm":   return dq(Z_AXIS,  0.95);
    case "Bip001 L Clavicle":  return dq(Z_AXIS,  0.05);
    case "Bip001 L UpperArm":  return compose([Z_AXIS, -0.85], [Y_AXIS, -0.45]);
    case "Bip001 L Forearm":   return dq(Z_AXIS,  0.65);
    case "Bip001 Spine":       return dq(Y_AXIS,  0.20); // slight blade
    case "Bip001 Neck":        return dq(Y_AXIS, -0.05); // counter so head stays toward target
    default:                   return null;
  }
}

/** Locomotion variant — same gait skeleton as the unarmed walker but
 *  arm swing is heavily damped so the rifle reads as held instead of
 *  swinging. Returns the gait delta to compose ON TOP of the static
 *  hold delta. */
function rifleLocoDelta(
  boneName: string,
  t: number,
  ampLeg: number,
  ampArm: number,
  ampKnee: number,
): THREE.Quaternion | null {
  const phaseL = Math.sin(t * Math.PI * 2);
  const phaseR = Math.sin((t + 0.5) * Math.PI * 2);
  const kneeL = Math.max(0, -phaseL);
  const kneeR = Math.max(0, -phaseR);
  // Arm swing scaled to ~25% — a held rifle MUST NOT swing freely.
  const armScale = 0.25;
  switch (boneName) {
    case "Bip001 L Thigh":    return dq(Z_AXIS,  phaseL * ampLeg);
    case "Bip001 R Thigh":    return dq(Z_AXIS,  phaseR * ampLeg);
    case "Bip001 L Calf":     return dq(Z_AXIS,  kneeL * ampKnee);
    case "Bip001 R Calf":     return dq(Z_AXIS,  kneeR * ampKnee);
    case "Bip001 L UpperArm": return dq(Z_AXIS,  phaseR * ampArm * armScale);
    case "Bip001 R UpperArm": return dq(Z_AXIS,  phaseL * ampArm * armScale);
    default:                  return null;
  }
}

function rifleAimDelta(boneName: string, t: number): THREE.Quaternion | null {
  // Subtle breath sway — vertical oscillation of the support arm
  // simulating the natural wobble during a held aim. Only ±0.02 rad.
  const sway = Math.sin(t * Math.PI * 2) * 0.02;
  switch (boneName) {
    case "Bip001 L UpperArm": return dq(X_AXIS, sway);
    case "Bip001 R UpperArm": return dq(X_AXIS, sway * 0.7);
    case "Bip001 Head":       return dq(Y_AXIS, sway * 0.3);
    default:                  return null;
  }
}

function rifleFireDelta(boneName: string, t: number): THREE.Quaternion | null {
  // Sharp recoil at t=0, ease back to rest by t=1. Right shoulder
  // pulses up, spine compresses, head tips back slightly.
  const pulse = Math.max(0, 1 - t * 1.4);
  const ease = pulse * pulse;
  switch (boneName) {
    case "Bip001 R UpperArm": return dq(X_AXIS, -ease * 0.35);
    case "Bip001 R Forearm":  return dq(Z_AXIS, -ease * 0.20);
    case "Bip001 Spine":      return dq(X_AXIS,  ease * 0.10);
    case "Bip001 Head":       return dq(X_AXIS, -ease * 0.08);
    default:                  return null;
  }
}

function rifleReloadDelta(boneName: string, t: number): THREE.Quaternion | null {
  // 1.4s arc: support hand drops to magazine well (t in [0,0.35]),
  // hold (t in [0.35,0.70]), return (t in [0.70,1.0]).
  let phase: number;
  if (t < 0.35) phase = t / 0.35;
  else if (t < 0.7) phase = 1;
  else phase = 1 - (t - 0.7) / 0.3;
  const ease = phase * phase * (3 - 2 * phase);
  switch (boneName) {
    case "Bip001 L UpperArm": return dq(Z_AXIS,  ease * 0.55);  // arm down
    case "Bip001 L Forearm":  return dq(Z_AXIS, -ease * 0.45);  // forearm back up
    case "Bip001 Spine":      return dq(Y_AXIS, -ease * 0.10);
    default:                  return null;
  }
}

/** Build a single rifle clip composing the static hold pose against
 *  a per-frame motion delta. Skips bones that wind up flat across the
 *  whole clip (rest * hold composed with no motion) — saves mixer work
 *  for the locomotion clips that only animate the legs. */
function buildRifleClip(
  name: string,
  duration: number,
  rest: ReadonlyMap<string, BoneRest>,
  motion: (boneName: string, t: number) => THREE.Quaternion | null,
  steps: number,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i++) times[i] = (i / steps) * duration;

  for (const boneName of ANIM_BONES) {
    const restEntry = rest.get(boneName);
    if (!restEntry) continue;
    const hold = rifleHoldDelta(boneName);
    const values = new Float32Array((steps + 1) * 4);
    let varied = false;
    for (let i = 0; i <= steps; i++) {
      const t = times[i] / duration;
      const m = motion(boneName, t);
      // Compose: rest * hold * motion. If neither hold nor motion
      // touch this bone, skip the track entirely.
      let q: THREE.Quaternion;
      if (hold || m) {
        q = restEntry.q.clone();
        if (hold) q.multiply(hold);
        if (m) q.multiply(m);
        varied = true;
      } else {
        q = restEntry.q.clone();
      }
      values[i * 4]     = q.x;
      values[i * 4 + 1] = q.y;
      values[i * 4 + 2] = q.z;
      values[i * 4 + 3] = q.w;
    }
    if (!varied) continue;
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${boneName}.quaternion`,
        Array.from(times),
        Array.from(values),
      ),
    );
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Per-source-scene cache, mirrors `synthesizeBipedClips`. WeakMap
 *  outer so unloaded scenes are GC-eligible; inner Map keyed by
 *  profile id so two races sharing a GLB don't cross-contaminate. */
const RIFLE_CACHE = new WeakMap<THREE.Object3D, Map<string, THREE.AnimationClip[]>>();

/** Canonical rifle clip names emitted by {@link synthesizeRifleClips}.
 *  Mirrored by `WEAPON_CLIP_NAMES.rifle` in `builtinModels.ts`; the
 *  parity test enforces the two stay aligned. */
export const PROCEDURAL_RIFLE_CLIP_NAMES = {
  idle: "rifle_idle",
  walk: "rifle_walk",
  run: "rifle_run",
  aim: "rifle_aim",
  fire: "rifle_fire",
  reload: "rifle_reload",
} as const;

/** Build (and cache) the rifle clip set for a Bip001 rig. Returns an
 *  empty array if the rig isn't a Max biped. */
export function synthesizeRifleClips(
  root: THREE.Object3D,
  profile: BipedAnimProfile = DEFAULT_BIPED_PROFILE,
): THREE.AnimationClip[] {
  let perScene = RIFLE_CACHE.get(root);
  if (!perScene) {
    perScene = new Map();
    RIFLE_CACHE.set(root, perScene);
  }
  const cached = perScene.get(profile.id);
  if (cached) return cached;
  if (!hasBipedSkeleton(root)) {
    perScene.set(profile.id, []);
    return [];
  }
  const rest = new Map<string, BoneRest>();
  for (const name of ANIM_BONES) {
    const bone = findBone(root, name);
    if (!bone) continue;
    rest.set(name, { q: bone.quaternion.clone(), p: bone.position.clone() });
  }

  const w = profile.walk;
  const r = profile.run;
  const clips: THREE.AnimationClip[] = [
    // Idle = pure hold pose (motion = null per bone). 2.4s loop so it
    // breathes in time with the unarmed idle.
    buildRifleClip(PROCEDURAL_RIFLE_CLIP_NAMES.idle, 2.4, rest, () => null, 6),
    buildRifleClip(
      PROCEDURAL_RIFLE_CLIP_NAMES.walk,
      w.dur,
      rest,
      (b, t) => rifleLocoDelta(b, t, w.ampLeg, w.ampArm, w.ampKnee),
      20,
    ),
    buildRifleClip(
      PROCEDURAL_RIFLE_CLIP_NAMES.run,
      r.dur,
      rest,
      (b, t) => rifleLocoDelta(b, t, r.ampLeg, r.ampArm, r.ampKnee),
      20,
    ),
    buildRifleClip(PROCEDURAL_RIFLE_CLIP_NAMES.aim, 1.6, rest, rifleAimDelta, 16),
    buildRifleClip(PROCEDURAL_RIFLE_CLIP_NAMES.fire, 0.32, rest, rifleFireDelta, 12),
    buildRifleClip(PROCEDURAL_RIFLE_CLIP_NAMES.reload, 1.4, rest, rifleReloadDelta, 18),
  ];
  perScene.set(profile.id, clips);
  return clips;
}
