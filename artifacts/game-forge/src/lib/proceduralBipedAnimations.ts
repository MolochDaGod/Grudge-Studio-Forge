import * as THREE from "three";
import type { RaceId } from "./races";

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
 * `useAnimations` discovers `idle / walk / run / attack / death` and
 * the 0.2s crossfade in `pickClipName` transitions between them.
 *
 * The synthesizer is a no-op for any rig that doesn't expose the
 * tell-tale Bip001 bone names, so it never fights the bundled
 * `builtin:character` rig (which already faces -Z and may carry its
 * own clips) or any user-imported model.
 *
 * Per-race personality: the synthesizer accepts an optional
 * `BipedAnimProfile` that tunes clip duration, swing amplitude, pelvis
 * bob, and picks one of four attack styles (overhand / cleave / stab /
 * bow). The six toon-rts races each get their own profile in
 * `BIPED_ANIM_PROFILES` — heavy-and-slow for dwarf/orc, light-and-fast
 * with a bow draw for elf, stiff stab for skeleton, balanced overhand
 * for warrior. Without a profile we fall back to `DEFAULT_PROFILE`
 * (the original "warrior-ish" feel) so any non-race biped import still
 * gets motion.
 *
 * Death pose: a one-shot 0.9s clip that collapses spine/legs/head into
 * a forward fetal slump and drops the pelvis. The renderer detects the
 * "death" clip name and switches the AnimationAction to LoopOnce +
 * clampWhenFinished so the body stays in the final pose. Behaviors
 * (e.g. `enemy-rpg`) publish "death" via `__agentClips` once the
 * entity dies; pre-existing writers that didn't carry a death clip
 * continue to work because the publish call early-returns on falsy
 * clip names.
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
 *  Returns null for bones we don't drive (so the track is skipped).
 *
 *  Amplitudes are passed in by the caller so per-race profiles can
 *  vary stride length / arm swing / knee lift independently for walk
 *  vs. run.
 */
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
  // Breathing + head sway + subtle arm sway. The previous values were
  // so small (0.03 rad ≈ 1.7°) the rig looked frozen on screen — feedback
  // from playtest. Bumped to ~5° on spine, with low-frequency arm sway
  // out of phase so the character reads as "alive but standing".
  const breathe = Math.sin(t * Math.PI * 2) * 0.09;       // ~5°
  const headSway = Math.sin(t * Math.PI * 2 + 0.4) * 0.07; // ~4°, slight lag
  // Half-frequency arm sway (one cycle per two breaths) so it doesn't
  // sync with the breathing and read as mechanical. Opposite phase
  // L/R so the body twists subtly side-to-side.
  const armSway = Math.sin(t * Math.PI) * 0.05;            // ~3°
  switch (boneName) {
    case "Bip001 Spine":      return deltaQ(Z_AXIS, breathe);
    case "Bip001 Head":       return deltaQ(Y_AXIS, headSway);
    case "Bip001 L UpperArm": return deltaQ(Z_AXIS,  armSway);
    case "Bip001 R UpperArm": return deltaQ(Z_AXIS, -armSway);
    default:                  return null;
  }
}

/** Catalog of attack styles used by `BipedAnimProfile.attackKind`.
 *  - `overhand`: classic right-arm chop (warrior, default fallback)
 *  - `cleave`:   wide two-handed swing both arms together (orc, dwarf)
 *  - `stab`:     forward thrust with right arm extended (skeleton)
 *  - `bow`:      held draw-and-release with both arms (elf) */
export type AttackKind = "overhand" | "cleave" | "stab" | "bow";

function attackDelta(
  kind: AttackKind,
  boneName: string,
  t: number,
  amp: number,
): THREE.Quaternion | null {
  // Asymmetric ease: fast wind-up over [0, 0.35], snappy strike at
  // 0.35, hold-then-release over [0.35, 1]. Replaces the symmetric
  // triangle wave which felt mechanical (linear up, linear down). The
  // smoothstep on each half hides the kink at the apex so the strike
  // reads as a coiled punch, not a metronome. Still returns to 0 by
  // t=1 so crossfade back to idle/walk is clean.
  const APEX = 0.35;
  let u: number;
  if (t < APEX) {
    const x = t / APEX;
    u = x * x * (3 - 2 * x); // smoothstep wind-up
  } else {
    const x = (t - APEX) / (1 - APEX);
    const eased = x * x * (3 - 2 * x);
    u = 1 - eased; // smoothstep release
  }
  switch (kind) {
    case "overhand":
      switch (boneName) {
        case "Bip001 R UpperArm": return deltaQ(Z_AXIS, -u * 1.6 * amp);
        case "Bip001 R Forearm":  return deltaQ(Z_AXIS,  u * 0.8 * amp);
        case "Bip001 Spine":      return deltaQ(Y_AXIS,  u * 0.20);
        default:                  return null;
      }
    case "cleave":
      // Both arms swing together — meatier, slower-feeling chop. The
      // spine rotates further so it reads as a whole-body commit.
      switch (boneName) {
        case "Bip001 R UpperArm": return deltaQ(Z_AXIS, -u * 1.4 * amp);
        case "Bip001 L UpperArm": return deltaQ(Z_AXIS, -u * 1.2 * amp);
        case "Bip001 R Forearm":  return deltaQ(Z_AXIS,  u * 0.6 * amp);
        case "Bip001 L Forearm":  return deltaQ(Z_AXIS,  u * 0.5 * amp);
        case "Bip001 Spine":      return deltaQ(Y_AXIS,  u * 0.30);
        default:                  return null;
      }
    case "stab":
      // Right arm punches forward to roughly horizontal, forearm
      // straightens. Faster recovery — the triangle wave is the same
      // duration but the smaller arc reads as a snap.
      switch (boneName) {
        case "Bip001 R UpperArm": return deltaQ(Z_AXIS, -u * 1.3 * amp);
        case "Bip001 R Forearm":  return deltaQ(Z_AXIS, -u * 0.3 * amp);
        case "Bip001 Spine":      return deltaQ(Y_AXIS,  u * 0.12);
        default:                  return null;
      }
    case "bow":
      // Held draw: L arm sustains forward (constant offset), R arm
      // pulls back over the first half of the clip then releases. The
      // sustained left-arm offset uses `0.5 + u*0.5` so it ramps up at
      // the start and stays near max for the rest of the cycle (we'd
      // see a pop otherwise — the rest pose has both arms at side).
      switch (boneName) {
        case "Bip001 L UpperArm": return deltaQ(Z_AXIS, -(0.6 + u * 0.7) * amp);
        case "Bip001 L Forearm":  return deltaQ(Z_AXIS,  0.20 * amp);
        case "Bip001 R UpperArm": return deltaQ(Z_AXIS, -(0.4 + u * 0.5) * amp);
        case "Bip001 R Forearm":  return deltaQ(Z_AXIS,  (0.3 + u * 0.9) * amp);
        case "Bip001 Spine":      return deltaQ(Y_AXIS, -u * 0.15);
        default:                  return null;
      }
  }
}

/** Death pose: collapse forward into a fetal slump over ~0.6 of the
 *  clip, then hold. The renderer plays this with LoopOnce + clamp so
 *  the final pose persists. Pelvis Y also drops via `deathPelvisOffset`. */
function deathDelta(boneName: string, t: number): THREE.Quaternion | null {
  const u = Math.min(1, t * 1.6);
  const ease = u * u * (3 - 2 * u); // smoothstep
  switch (boneName) {
    case "Bip001 Spine":      return deltaQ(Z_AXIS, -ease * 1.20);
    case "Bip001 Head":       return deltaQ(Z_AXIS, -ease * 0.50);
    case "Bip001 L Thigh":    return deltaQ(Z_AXIS, -ease * 0.95);
    case "Bip001 R Thigh":    return deltaQ(Z_AXIS, -ease * 0.95);
    case "Bip001 L Calf":     return deltaQ(Z_AXIS,  ease * 1.40);
    case "Bip001 R Calf":     return deltaQ(Z_AXIS,  ease * 1.40);
    case "Bip001 L UpperArm": return deltaQ(Z_AXIS,  ease * 0.55);
    case "Bip001 R UpperArm": return deltaQ(Z_AXIS, -ease * 0.55);
    default:                  return null;
  }
}

/** Vertical pelvis bob — twice per gait cycle (one per foot strike).
 *  Centered around 0 so the entity transform stays on the navmesh. */
function locoPelvisOffset(t: number, bobAmp: number): number {
  return Math.abs(Math.sin(t * Math.PI * 2)) * bobAmp - bobAmp * 0.5;
}

function deathPelvisOffset(t: number): number {
  const u = Math.min(1, t * 1.6);
  const ease = u * u * (3 - 2 * u);
  return -ease * 0.45;
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

/** Per-race tuning for `synthesizeBipedClips`. All durations are seconds;
 *  smaller = faster cycle. Amplitudes are radians for limb-swing peaks. */
export interface BipedAnimProfile {
  /** Stable id used as the cache key alongside the source scene, so two
   *  entities of different races can share the same GLB without
   *  cross-contaminating each other's procedural clips. */
  id: string;
  idleDur: number;
  walk: { dur: number; ampLeg: number; ampArm: number; ampKnee: number; bob: number };
  run:  { dur: number; ampLeg: number; ampArm: number; ampKnee: number; bob: number };
  attack: { kind: AttackKind; amp: number; dur: number };
}

/** Default "warrior-ish" profile used for any biped that isn't a known
 *  race (user-imported toon-rts model, etc.). Amplitudes bumped from
 *  the original ~0.45 rad walk leg / 0.70 rad run leg after playtest
 *  feedback that motion looked stiff — the new values (~30° walk leg,
 *  ~46° run leg) match real-life human gait amplitudes more closely
 *  and read as actual locomotion at any camera distance. */
export const DEFAULT_BIPED_PROFILE: BipedAnimProfile = {
  id: "default",
  idleDur: 2.4,
  walk:   { dur: 1.0,  ampLeg: 0.55, ampArm: 0.50, ampKnee: 0.80, bob: 0.06 },
  run:    { dur: 0.55, ampLeg: 0.85, ampArm: 0.75, ampKnee: 1.15, bob: 0.12 },
  attack: { kind: "overhand", amp: 1.0, dur: 0.5 },
};

/** Per-race personality table. Tuned by feel:
 *  - warrior:  balanced overhand swing (matches default)
 *  - dwarf:    slow heavy stride, two-handed cleave
 *  - frost-dwarf: marginally heavier than dwarf
 *  - elf:      light & fast, bow-draw attack
 *  - orc:      brute swagger, big cleave
 *  - skeleton: stiffer stride, fast snappy stab
 */
export const BIPED_ANIM_PROFILES: Record<RaceId, BipedAnimProfile> = {
  // Per-race amplitudes bumped roughly +20-25% across the board after
  // playtest feedback that motion looked stiff. Targets ~30-50° leg
  // swing for walk, ~50-65° for run — close to real human gait. Pelvis
  // bob also bumped so the silhouette reads as "weight transferring"
  // instead of "feet pumping under a static body".
  warrior: {
    id: "warrior",
    idleDur: 2.4,
    walk:   { dur: 1.00, ampLeg: 0.55, ampArm: 0.50, ampKnee: 0.80, bob: 0.06 },
    run:    { dur: 0.55, ampLeg: 0.85, ampArm: 0.75, ampKnee: 1.15, bob: 0.12 },
    attack: { kind: "overhand", amp: 1.00, dur: 0.50 },
  },
  dwarf: {
    id: "dwarf",
    idleDur: 2.6,
    walk:   { dur: 1.15, ampLeg: 0.46, ampArm: 0.42, ampKnee: 0.70, bob: 0.07 },
    run:    { dur: 0.65, ampLeg: 0.72, ampArm: 0.62, ampKnee: 1.00, bob: 0.13 },
    attack: { kind: "cleave", amp: 1.10, dur: 0.62 },
  },
  "frost-dwarf": {
    id: "frost-dwarf",
    idleDur: 2.8,
    walk:   { dur: 1.20, ampLeg: 0.44, ampArm: 0.40, ampKnee: 0.68, bob: 0.07 },
    run:    { dur: 0.70, ampLeg: 0.70, ampArm: 0.60, ampKnee: 0.98, bob: 0.13 },
    attack: { kind: "cleave", amp: 1.20, dur: 0.68 },
  },
  elf: {
    id: "elf",
    idleDur: 2.2,
    walk:   { dur: 0.90, ampLeg: 0.62, ampArm: 0.55, ampKnee: 0.75, bob: 0.05 },
    run:    { dur: 0.48, ampLeg: 0.92, ampArm: 0.80, ampKnee: 1.15, bob: 0.10 },
    attack: { kind: "bow", amp: 1.00, dur: 0.85 },
  },
  orc: {
    id: "orc",
    idleDur: 2.5,
    walk:   { dur: 1.10, ampLeg: 0.62, ampArm: 0.58, ampKnee: 0.90, bob: 0.08 },
    run:    { dur: 0.60, ampLeg: 0.95, ampArm: 0.82, ampKnee: 1.20, bob: 0.14 },
    attack: { kind: "cleave", amp: 1.25, dur: 0.55 },
  },
  skeleton: {
    id: "skeleton",
    idleDur: 1.8,
    walk:   { dur: 0.95, ampLeg: 0.52, ampArm: 0.58, ampKnee: 0.58, bob: 0.04 },
    run:    { dur: 0.52, ampLeg: 0.80, ampArm: 0.80, ampKnee: 0.90, bob: 0.08 },
    attack: { kind: "stab", amp: 0.95, dur: 0.42 },
  },
};

/** Look up a profile by race id; returns the default profile if none
 *  matches (so user-imported bipeds and the legacy `builtin:character`
 *  rig still get reasonable motion). */
export function getBipedProfile(raceId: string | null | undefined): BipedAnimProfile {
  if (!raceId) return DEFAULT_BIPED_PROFILE;
  const key = raceId as RaceId;
  return BIPED_ANIM_PROFILES[key] ?? DEFAULT_BIPED_PROFILE;
}

/** Per-source-scene cache so we only walk the bone tree once per GLB,
 *  even when many entities share the same race model. Nested by
 *  profile id because two entities sharing the same GLB but different
 *  profiles need their own clip arrays. WeakMap so unloaded scenes
 *  can be GC'd. */
const CLIP_CACHE = new WeakMap<THREE.Object3D, Map<string, THREE.AnimationClip[]>>();

/** Build (and cache) idle / walk / run / attack / death clips for a
 *  Bip001 rig. Returns an empty array if the rig doesn't look like a
 *  Max biped. */
export function synthesizeBipedClips(
  root: THREE.Object3D,
  profile: BipedAnimProfile = DEFAULT_BIPED_PROFILE,
): THREE.AnimationClip[] {
  let perScene = CLIP_CACHE.get(root);
  if (!perScene) {
    perScene = new Map();
    CLIP_CACHE.set(root, perScene);
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
  const a = profile.attack;
  const clips: THREE.AnimationClip[] = [
    buildClip("idle",   profile.idleDur, rest, idleDelta,                                  null,                                       24),
    buildClip("walk",   w.dur,           rest, (b, t) => locoDelta(b, t, w.ampLeg, w.ampArm, w.ampKnee), (t) => locoPelvisOffset(t, w.bob), 20),
    buildClip("run",    r.dur,           rest, (b, t) => locoDelta(b, t, r.ampLeg, r.ampArm, r.ampKnee), (t) => locoPelvisOffset(t, r.bob), 20),
    buildClip("attack", a.dur,           rest, (b, t) => attackDelta(a.kind, b, t, a.amp),  null,                                       16),
    // Death is intentionally a one-shot — the renderer plays it with
    // LoopOnce + clampWhenFinished so the body stays in the final
    // collapsed pose. Duration is a touch longer than attack so the
    // ease has room to breathe.
    buildClip("death",  0.9,             rest, deathDelta,                                  deathPelvisOffset,                          18),
  ];
  perScene.set(profile.id, clips);
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
  death: "death",
} as const;
