import * as THREE from "three";
import { bipedBoneFor, isMixamoSkeleton, stripMixamoPrefix } from "./mixamoBoneRemap";

/**
 * Runtime retargeter — replays a Mixamo `AnimationClip` against a
 * Bip001 (3ds-Max biped) skeleton.
 *
 * Three things have to happen track-by-track for a Mixamo clip to look
 * right on a toon-rts character:
 *
 *  1. **Rename the target bone.** Every Mixamo track's `name` looks
 *     like `mixamorig:LeftUpLeg.quaternion`. We split on `.`, look up
 *     the bone via {@link bipedBoneFor}, and re-emit the track with
 *     `Bip001 L Thigh.quaternion`. Tracks whose source bone has no
 *     biped equivalent (fingers, toes) are DROPPED, not silenced —
 *     leaving them in produces per-frame mixer warnings.
 *
 *  2. **Rescale the Hips position track.** Mixamo authors animations
 *     on a ~180cm Y Bot rig, with the Hips root parked at ~100cm.
 *     Our toon-rts characters vary from ~140cm (skeleton) up to
 *     ~210cm (orc). If we apply the source positions verbatim, a
 *     dwarf rig levitates and an orc rig sinks into the floor. So
 *     we measure each rest-pose pelvis Y at retarget time and scale
 *     every position keyframe by `targetPelvisY / sourcePelvisY`.
 *     This is a uniform 3-axis scale — it's tempting to scale only Y
 *     but Mixamo also uses centimeter units in some clips and meters
 *     in others, and uniform scaling absorbs both.
 *
 *  3. **Strip XZ root motion** (when `inPlace !== false`, the default).
 *     Most Mixamo locomotion clips have baked horizontal root motion —
 *     the character physically translates forward over time. In our
 *     engine, locomotion is driven by the camera controller / nav
 *     agent FSM writing into the physics body; the AnimationClip is
 *     pure local pose. If we leave root motion in, the visual model
 *     drifts away from the physics body until the next loop. We zero
 *     X and Z components of the Hips position track and keep Y (so
 *     pelvis bob from a jump or crouch survives).
 *
 * The result is cached in a WeakMap keyed by the source clip — same
 * Mixamo file dropped on five different races still only retargets
 * five times (once per target skeleton), and same race + same clip is
 * O(1) on subsequent lookups.
 *
 * Pure with respect to its inputs: never mutates `clip` or either
 * scene; every returned clip is a fresh `AnimationClip` with fresh
 * track instances safe to feed to `AnimationMixer`.
 */

export interface RetargetOptions {
  /** When true (default) the X and Z components of the Hips position
   *  track are zeroed so the character animates in place. Set false to
   *  preserve baked root motion for cinematic / one-shot clips that
   *  intentionally translate (e.g. a vault). */
  inPlace?: boolean;
  /** Override the auto-measured uniform scale. Use ONLY when the
   *  caller has out-of-band knowledge (e.g. a known asset that ships
   *  in centimeters). Leave undefined to let the retargeter compute
   *  it from rest pelvis Y. */
  scaleOverride?: number;
}

interface CacheKey {
  /** WeakMap by clip → inner Map by target-scene-uuid → retargeted clip.
   *  Two-level so the outer WeakMap can let GO of the source clip when
   *  it's unloaded without us having to track lifecycle. */
  inner: Map<string, THREE.AnimationClip>;
}

const CACHE = new WeakMap<THREE.AnimationClip, CacheKey>();

/** Find a bone by exact name. Cheap traversal — used twice per
 *  retarget call (source pelvis + target pelvis) so a faster index
 *  isn't worth the bookkeeping. Returns null when missing rather than
 *  throwing because callers may reasonably feed a non-Mixamo source
 *  scene; the outer guard handles that case explicitly. */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/** Pelvis Y in REST pose (i.e. the value sitting in `bone.position.y`
 *  before any animation runs). For Mixamo this is typically ~1.0
 *  (meters) or ~100 (centimeters); for our toon-rts rigs it's the
 *  value baked into the GLB at export time. */
function pelvisRestY(scene: THREE.Object3D, candidates: readonly string[]): number | null {
  for (const name of candidates) {
    const bone = findBone(scene, name);
    if (bone) return bone.position.y;
  }
  return null;
}

const SOURCE_PELVIS_NAMES = ["mixamorig:Hips", "Hips"] as const;
const TARGET_PELVIS_NAMES = ["Bip001 Pelvis"] as const;

/**
 * Retarget a Mixamo clip onto a Bip001 skeleton.
 *
 * @param args.clip Source AnimationClip from a Mixamo GLB.
 * @param args.sourceScene The `gltf.scene` the source clip was authored
 *   against. Used to measure source pelvis height.
 * @param args.targetScene The `gltf.scene` of the target rig (one of
 *   the toon-rts race GLBs). Used to measure target pelvis height and
 *   as the cache discriminator so the same source clip retargets to
 *   different races independently.
 * @returns A fresh AnimationClip safe to feed to AnimationMixer, or
 *   `null` when the source isn't a Mixamo skeleton (caller should pass
 *   the original clip through unchanged in that case).
 */
export function retargetMixamoClip(args: {
  clip: THREE.AnimationClip;
  sourceScene: THREE.Object3D;
  targetScene: THREE.Object3D;
  opts?: RetargetOptions;
}): THREE.AnimationClip | null {
  const { clip, sourceScene, targetScene, opts } = args;

  // Defense in depth: don't retarget anything that doesn't look like
  // a Mixamo source. The asset-browser drop zone will already have
  // gated on this, but the function is exported and any future caller
  // could mis-route (e.g. our own GLBs through the retargeter).
  if (!isMixamoSkeleton(sourceScene)) return null;

  const targetUuid = targetScene.uuid;
  let entry = CACHE.get(clip);
  if (!entry) {
    entry = { inner: new Map() };
    CACHE.set(clip, entry);
  }
  const cached = entry.inner.get(targetUuid);
  if (cached) return cached;

  const sourceY = pelvisRestY(sourceScene, SOURCE_PELVIS_NAMES);
  const targetY = pelvisRestY(targetScene, TARGET_PELVIS_NAMES);
  // Scale defaults to 1 if either pelvis is missing or zero — better
  // to play the clip at native scale (visibly wrong by a constant
  // factor) than to NaN every keyframe and produce no motion at all.
  const scale =
    opts?.scaleOverride ??
    (sourceY && targetY && sourceY !== 0 ? targetY / sourceY : 1);
  const inPlace = opts?.inPlace !== false;

  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    // `nodeName.property[.subProperty]` — split on the FIRST dot so
    // bone names containing dots (rare but legal in glTF) survive.
    const dot = t.name.indexOf(".");
    if (dot < 0) continue; // Malformed track name — skip silently.
    const sourceName = t.name.slice(0, dot);
    const tail = t.name.slice(dot); // includes the leading dot
    // Try the prefixed name first, then the bare-stripped variant
    // for Blender-processed files.
    const targetName =
      bipedBoneFor(sourceName) ??
      bipedBoneFor(`mixamorig:${stripMixamoPrefix(sourceName)}`);
    if (!targetName) continue; // No equivalent bone (finger / toe) — drop.

    // Decide whether this is a Hips position track that needs the
    // scale + in-place treatment. Quaternion / scale tracks pass
    // through with just the rename.
    const isHipsPosition =
      tail === ".position" &&
      (sourceName === "mixamorig:Hips" || sourceName === "Hips");

    if (isHipsPosition && t instanceof THREE.VectorKeyframeTrack) {
      const src = t.values;
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        // X and Z: zero on inPlace, otherwise scale.
        dst[i] = inPlace ? 0 : src[i] * scale;
        dst[i + 1] = src[i + 1] * scale;
        dst[i + 2] = inPlace ? 0 : src[i + 2] * scale;
      }
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${targetName}${tail}`,
          Array.from(t.times),
          Array.from(dst),
        ),
      );
      continue;
    }

    // Generic rename — clone the track via its constructor so we
    // never mutate shared input arrays. THREE's KeyframeTrack
    // constructors are uniform on (name, times, values).
    const Ctor = (t as unknown as { constructor: new (n: string, t: ArrayLike<number>, v: ArrayLike<number>) => THREE.KeyframeTrack }).constructor;
    tracks.push(new Ctor(`${targetName}${tail}`, Array.from(t.times), Array.from(t.values)));
  }

  // Preserve duration explicitly — `AnimationClip` will recompute
  // from tracks when given -1, which can shorten loop length if all
  // tracks were dropped (e.g. a finger-only clip). Use the source
  // duration so loop timing stays predictable.
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  entry.inner.set(targetUuid, out);
  return out;
}

/** Convenience wrapper: retarget every clip on a Mixamo `gltf` and
 *  return the array. Tracks the source-clip identity so calling this
 *  twice on the same `(sourceGltf, targetScene)` pair is free. */
export function retargetMixamoGltf(args: {
  sourceClips: readonly THREE.AnimationClip[];
  sourceScene: THREE.Object3D;
  targetScene: THREE.Object3D;
  opts?: RetargetOptions;
}): THREE.AnimationClip[] {
  const out: THREE.AnimationClip[] = [];
  for (const c of args.sourceClips) {
    const r = retargetMixamoClip({
      clip: c,
      sourceScene: args.sourceScene,
      targetScene: args.targetScene,
      opts: args.opts,
    });
    if (r) out.push(r);
  }
  return out;
}
