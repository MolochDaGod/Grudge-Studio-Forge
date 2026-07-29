/**
 * Pure framing math for the editor's "F — Focus camera on selection" hotkey.
 *
 * Given an entity's world-space axis-aligned bounding box (AABB) and the
 * editor camera's current pose, compute a new orbit target + camera position
 * that frames the entity tightly while preserving the existing view
 * direction (so orbit angle isn't surprisingly reset by repeated F presses).
 *
 * Pulled out of the React `<FocusCameraController>` so it can be unit-tested
 * without booting the WebGL viewport — see `__tests__/framing.test.ts`.
 */

export interface FramingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ComputeFramingPoseOptions {
  /** World-space AABB of the entity to frame (`THREE.Box3().setFromObject(...)`). */
  bbox: FramingBox;
  /** Editor camera's CURRENT world position. */
  cameraPosition: [number, number, number];
  /** OrbitControls' CURRENT target (the point the camera is looking at). */
  currentTarget: [number, number, number];
  /** Camera vertical FOV in DEGREES (`PerspectiveCamera.fov`). */
  fovDegrees: number;
  /** Viewport aspect (width / height). Defaults to 1 when unknown. */
  aspect?: number;
  /** Multiplier applied to the fitting distance — leaves room around the
   *  entity instead of cropping its silhouette. Default 1.55 ≈ hierarchy
   *  padding (characters + children). */
  margin?: number;
  /** Floor on the bounding-sphere radius so a zero-extent / single-point
   *  entity (e.g. an empty marker) still produces a usable framing distance
   *  rather than collapsing the camera into the target. */
  minRadius?: number;
  /** Clamp max framing distance (world units). Large islands otherwise
   *  fling the camera to space. Default 2_500. */
  maxDistance?: number;
  /** Minimum camera distance from target. Default 1.2. */
  minDistance?: number;
}

export interface FramingPose {
  /** New OrbitControls target — the centroid of the AABB. */
  target: [number, number, number];
  /** New camera world position, sized so the AABB fits the FOV. */
  position: [number, number, number];
  /** Distance between `position` and `target` (debug / inspection). */
  distance: number;
}

/**
 * Compute a target+position pose that frames the given AABB.
 *
 * - Target = AABB centroid.
 * - Distance = bounding-sphere-radius / sin(fov/2), accounting for aspect
 *   so a tall-but-narrow viewport still fits the full silhouette.
 * - Direction = (cameraPosition - currentTarget), normalized — preserves
 *   the existing orbit angle so repeated F presses are idempotent
 *   (calling computeFramingPose twice in a row yields the same result
 *   to within float precision).
 */
export function computeFramingPose(opts: ComputeFramingPoseOptions): FramingPose {
  const { min, max } = opts.bbox;
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;

  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const minRadius = opts.minRadius ?? 0.5;
  const radius = Math.max(minRadius, 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz));

  const margin = opts.margin ?? 1.55;
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
  const fovRad = (opts.fovDegrees * Math.PI) / 180;
  // Vertical fit
  const distV = radius / Math.sin(fovRad / 2);
  // Horizontal fit (when aspect < 1 the horizontal FOV is the binding one)
  const fovH = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
  const distH = radius / Math.sin(fovH / 2);
  const maxDistance = opts.maxDistance ?? 2_500;
  const minDistance = opts.minDistance ?? 1.2;
  const distance = Math.min(
    maxDistance,
    Math.max(minDistance, Math.max(distV, distH) * margin),
  );

  // Preserve the current view direction. Fall back to a 1,1,1 isometric-ish
  // direction if the camera is sitting on the orbit target (degenerate).
  let dx = opts.cameraPosition[0] - opts.currentTarget[0];
  let dy = opts.cameraPosition[1] - opts.currentTarget[1];
  let dz = opts.cameraPosition[2] - opts.currentTarget[2];
  let len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) {
    dx = 1;
    dy = 1;
    dz = 1;
    len = Math.sqrt(3);
  }
  dx /= len;
  dy /= len;
  dz /= len;

  return {
    target: [cx, cy, cz],
    position: [cx + dx * distance, cy + dy * distance, cz + dz * distance],
    distance,
  };
}
