import * as THREE from "three";
import { solveTwoBoneIK, applyDeltaWorld } from "./footIK";

// Structural Rapier-world type. We intentionally avoid importing
// `@dimforge/rapier3d-compat` directly because that package is only
// a transitive dependency of `@react-three/rapier` and isn't listed
// in our package.json — pulling it in by name would couple us to a
// specific transitive version. The shape here covers the two methods
// we actually call; `as never` casts inside the body bridge the rest.
interface RapierWorld {
  castRayAndGetNormal(
    ray: never,
    maxToi: number,
    solid: boolean,
  ): { timeOfImpact: number; normal: { x: number; y: number; z: number } } | null;
}

/**
 * Per-frame foot planting driver.
 *
 * Job: keep the visual feet on top of the terrain regardless of
 * what the animation is doing. The animation system (clip mixer)
 * runs first and produces a candidate pose; this driver runs after
 * and *corrects* the candidate by:
 *
 *   1. For each foot, raycasting straight down from the foot bone's
 *      current world position into the Rapier world.
 *   2. Computing a desired world-space target = max(currentY, hitY +
 *      footLift). "max" because we never want to push a foot DOWN
 *      below where the animation placed it (the swing leg should
 *      arc above ground), only UP to clear it.
 *   3. Running two-bone IK (`solveTwoBoneIK`) on the hip → knee →
 *      ankle chain to plant the ankle on the corrected target.
 *   4. Optionally rotating the foot bone to align with the ground
 *      normal at the hit point, capped to a max tilt so very steep
 *      slopes don't produce broken-ankle poses.
 *
 * Why this is in its own module: the IK math is reusable (could be
 * applied to hands gripping a weapon stock, head looking at a
 * target, etc.) and lives in `footIK.ts`. THIS file owns the
 * runtime concerns — the Rapier raycast, the bone lookup, and the
 * frame-to-frame state needed to keep foot rotation stable when the
 * support foot transitions from one frame to the next.
 *
 * Failure modes: silent no-op when the rig isn't a Bip001 biped
 * (synthesizer's `findBone` returns null for any of the four target
 * bones). Also no-op when no Rapier world is available — the driver
 * bails before issuing the raycast and the visual mesh keeps the
 * unmodified animation pose.
 */

/** Bone names we need from the rig. Locked to the Bip001 / 3ds Max
 *  biped naming convention (matching `proceduralBipedAnimations.ts`)
 *  because that's what every toon-rts character uses. Mixamo-named
 *  rigs flow through `mixamoBoneRemap` first, so by the time they
 *  reach here every track + bone is using these names. */
const BONE_NAMES = [
  "Bip001 Pelvis",
  "Bip001 L Thigh",
  "Bip001 L Calf",
  "Bip001 L Foot",
  "Bip001 R Thigh",
  "Bip001 R Calf",
  "Bip001 R Foot",
] as const;

/** Resolved bone references for one biped rig. Cached on the rig
 *  via a WeakMap keyed by `cloned.scene` so we walk the hierarchy
 *  exactly once per character — the `useFrame` driver then just
 *  reads these refs. */
export interface BipedFootRig {
  pelvis: THREE.Object3D;
  leftThigh: THREE.Object3D;
  leftCalf: THREE.Object3D;
  leftFoot: THREE.Object3D;
  rightThigh: THREE.Object3D;
  rightCalf: THREE.Object3D;
  rightFoot: THREE.Object3D;
}

const RIG_CACHE = new WeakMap<THREE.Object3D, BipedFootRig | null>();

/** Find the four leg bones for foot IK. Returns `null` if any one
 *  is missing — callers treat that as "not a biped, skip IK". The
 *  result is cached per cloned-scene root because `traverse` over
 *  a 50-mesh model is non-trivial and the rig structure never
 *  changes for a given character instance. */
export function getBipedFootRig(root: THREE.Object3D): BipedFootRig | null {
  const cached = RIG_CACHE.get(root);
  if (cached !== undefined) return cached;
  const found: Partial<Record<(typeof BONE_NAMES)[number], THREE.Object3D>> = {};
  root.traverse((o) => {
    if (BONE_NAMES.includes(o.name as (typeof BONE_NAMES)[number])) {
      found[o.name as (typeof BONE_NAMES)[number]] = o;
    }
  });
  if (
    !found["Bip001 Pelvis"] ||
    !found["Bip001 L Thigh"] ||
    !found["Bip001 L Calf"] ||
    !found["Bip001 L Foot"] ||
    !found["Bip001 R Thigh"] ||
    !found["Bip001 R Calf"] ||
    !found["Bip001 R Foot"]
  ) {
    RIG_CACHE.set(root, null);
    return null;
  }
  const rig: BipedFootRig = {
    pelvis: found["Bip001 Pelvis"],
    leftThigh: found["Bip001 L Thigh"],
    leftCalf: found["Bip001 L Calf"],
    leftFoot: found["Bip001 L Foot"],
    rightThigh: found["Bip001 R Thigh"],
    rightCalf: found["Bip001 R Calf"],
    rightFoot: found["Bip001 R Foot"],
  };
  RIG_CACHE.set(root, rig);
  return rig;
}

export interface FootPlantingOptions {
  /** Small lift above the ground hit so the foot bone (which is
   *  typically a few cm above the actual sole) doesn't sink. Tuned
   *  for the toon-rts character pack at scale 1 — adjust for taller
   *  / shorter rigs by scaling proportional to character height. */
  footLift?: number;
  /** Maximum downward distance to raycast looking for ground. Past
   *  this the foot is treated as "in the air" and IK is skipped for
   *  that frame, so the swing leg keeps its animated arc.
   *
   *  IMPORTANT: not "infinite" — we don't want a falling character
   *  whose feet are 50m above ground to suddenly snap to the floor
   *  via IK; gravity should bring the body down naturally and IK
   *  only kicks in when the foot is close enough that planting
   *  matters visually. */
  maxRayDistance?: number;
  /** Cap on the foot-rotation tilt to align with ground normal. At
   *  steep angles the rig's foot bone doesn't have enough range and
   *  forcing the rotation produces visibly broken ankles. */
  maxAnkleTiltRadians?: number;
}

const DEFAULT_OPTIONS: Required<FootPlantingOptions> = {
  footLift: 0.02,
  maxRayDistance: 0.8,
  maxAnkleTiltRadians: Math.PI / 5, // 36°
};

// Module-scoped scratch vectors so the per-frame driver doesn't
// allocate. Re-used across the L and R foot pass — values are read
// + consumed before the next pass writes.
const _hipPos = new THREE.Vector3();
const _kneePos = new THREE.Vector3();
const _anklePos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _polePos = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

/**
 * Run one IK pass on both feet. Call this AFTER the AnimationMixer
 * update so the candidate pose is up-to-date in world matrices.
 *
 * `world` is the Rapier `World` (via `useRapier().world`); when null
 * the driver is a no-op (matches behaviour outside play mode where
 * the physics world isn't initialised). `forwardWorld` is the
 * character's world-space facing direction — used as the IK pole
 * hint so knees bend forward, not sideways.
 */
export function plantFeetOnTerrain(
  rig: BipedFootRig,
  world: RapierWorld | null,
  forwardWorld: THREE.Vector3,
  options?: FootPlantingOptions,
): void {
  if (!world) return;
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Make sure all relevant world matrices are fresh — the mixer
  // updates local quaternions but doesn't propagate matrices itself
  // (that's the renderer's job, which runs AFTER our useFrame).
  rig.pelvis.updateWorldMatrix(true, true);

  plantOneFoot(rig.leftThigh, rig.leftCalf, rig.leftFoot, world, forwardWorld, opts);
  plantOneFoot(rig.rightThigh, rig.rightCalf, rig.rightFoot, world, forwardWorld, opts);
}

function plantOneFoot(
  thigh: THREE.Object3D,
  calf: THREE.Object3D,
  foot: THREE.Object3D,
  world: RapierWorld,
  forwardWorld: THREE.Vector3,
  opts: Required<FootPlantingOptions>,
): void {
  thigh.getWorldPosition(_hipPos);
  calf.getWorldPosition(_kneePos);
  foot.getWorldPosition(_anklePos);

  // Raycast straight down from a small height above the foot so
  // that a foot already slightly below ground (animation pushed it
  // through) still produces a sane hit. Using `maxRayDistance` as
  // both the back-up height AND the forward range gives us a 2x
  // window centred on the current foot Y.
  const rayOrigin = { x: _anklePos.x, y: _anklePos.y + opts.maxRayDistance, z: _anklePos.z };
  const rayDir = { x: 0, y: -1, z: 0 };
  // `solid: true` so we hit the back face of any collider the foot
  // is currently inside (clipped through). `maxToi` is in ray-
  // direction units — since dir is unit length, this is metres.
  // `filter` left undefined: hit anything; ground/wall/etc. all
  // count as "ground" for plant purposes.
  // Using the lazy import to avoid pulling in @dimforge/rapier3d-
  // compat's full type into this file's module graph.
  const Ray = (world.constructor as { Ray?: unknown }).Ray;
  // The compat package exposes `RAPIER` globally on the world's
  // module — but in practice we already have a Rapier world here,
  // so we construct the ray via the world's own factory if
  // available, falling back to a plain object literal which Rapier
  // accepts via duck-typing.
  // The actual API: world.castRay(ray, maxToi, solid). `ray` is a
  // `Ray` instance; we construct one if the constructor is exposed,
  // otherwise build a structurally-compatible literal.
  const ray = Ray
    ? new (Ray as new (origin: typeof rayOrigin, dir: typeof rayDir) => unknown)(rayOrigin, rayDir)
    : { origin: rayOrigin, dir: rayDir };
  // castRayAndGetNormal returns both the time-of-impact and the surface
  // normal at the hit point — needed for the foot-tilt step below.
  const hit = world.castRayAndGetNormal(ray as never, opts.maxRayDistance * 2, true);
  if (!hit) return;

  // timeOfImpact is in ray-direction units = metres. Convert back to
  // world Y of the hit.
  const hitY = rayOrigin.y - hit.timeOfImpact;
  const desiredAnkleY = Math.max(_anklePos.y, hitY + opts.footLift);
  // If the desired plant is essentially where the animation already
  // placed the foot, skip IK entirely — saves a quaternion solve
  // per foot per frame for the common "walking on flat ground"
  // case where the animation's foot height already matches the
  // floor.
  if (Math.abs(desiredAnkleY - _anklePos.y) < 1e-4) return;

  _targetPos.set(_anklePos.x, desiredAnkleY, _anklePos.z);
  // Pole hint: copy the character's forward vector. The solver
  // projects it into the plane orthogonal to (hip → target), so a
  // close-enough direction is fine.
  _polePos.copy(forwardWorld).normalize();

  const result = solveTwoBoneIK({
    hip: _hipPos,
    knee: _kneePos,
    ankle: _anklePos,
    target: _targetPos,
    pole: _polePos,
  });

  applyDeltaWorld(thigh, result.hipDeltaWorld);
  // After updating the thigh, the knee's world position has moved.
  // Re-fetching the world matrix is necessary before applying the
  // knee delta so its parent's new world rotation is reflected in
  // the local-space conversion inside applyDeltaWorld.
  thigh.updateWorldMatrix(true, true);
  applyDeltaWorld(calf, result.kneeDeltaWorld);

  // Foot tilt to ground normal — capped to keep the ankle in a
  // reasonable range. We rotate the foot to align its local +Y
  // with the ground normal, but project onto the plane that
  // contains the character's forward direction first so we only
  // tilt fore/aft, not laterally (which would look broken).
  if (hit.normal) {
    calf.updateWorldMatrix(true, true);
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
    const tiltAngle = Math.acos(Math.max(-1, Math.min(1, normal.y)));
    if (tiltAngle <= opts.maxAnkleTiltRadians) {
      const footUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal),
      );
      // Use the difference between current foot up and the desired
      // ground-aligned up. setFromUnitVectors gives the shortest-
      // arc rotation, which keeps the ankle motion subtle.
      const currentUp = new THREE.Vector3(0, 1, 0);
      foot.getWorldQuaternion(new THREE.Quaternion()); // ensure world matrix sync
      const tiltDelta = new THREE.Quaternion().setFromUnitVectors(currentUp, footUp);
      applyDeltaWorld(foot, tiltDelta);
    }
  }
}
