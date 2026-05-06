/**
 * Pure camera-framing math for `frame_camera`. Given a list of point
 * positions (the entities being framed) and a shot kind, returns a
 * camera position + look-at target that frames those points with some
 * headroom.
 */

export type ShotKind = "hero" | "wide" | "over-shoulder" | "top-down" | "establishing";

export interface FrameInput {
  /** World-space points to frame. Must contain at least one entry. */
  points: readonly [number, number, number][];
  shot?: ShotKind;
  /** Vertical FOV in degrees. Default 50 (matches editor default). */
  fovDeg?: number;
  /** Horizontal yaw offset in radians (rotates the camera around the target). */
  yaw?: number;
  /** Padding multiplier on the framing distance (>1 backs off further). */
  padding?: number;
  /** For 'over-shoulder': position from which the shoulder belongs to.
   *  When set, the camera sits slightly behind/above this point and frames
   *  the centroid of `points`. Defaults to a back-side offset of the
   *  bounding sphere when omitted. */
  fromPoint?: readonly [number, number, number];
}

export interface FrameResult {
  position: [number, number, number];
  target: [number, number, number];
  /** Approximate radius (XZ) of the framed bounding sphere. */
  radius: number;
}

export function frameCamera(input: FrameInput): FrameResult {
  if (input.points.length === 0) {
    return { position: [10, 8, 10], target: [0, 0, 0], radius: 1 };
  }
  // Centroid + radius (sphere bound).
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of input.points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const n = input.points.length;
  cx /= n;
  cy /= n;
  cz /= n;
  let maxR = 0;
  for (const p of input.points) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > maxR) maxR = r;
  }
  const radius = Math.max(1, maxR);
  const fov = ((input.fovDeg ?? 50) * Math.PI) / 180;
  const padding = input.padding ?? 1.4;
  const baseDist = (radius / Math.tan(fov / 2)) * padding;

  const shot: ShotKind = input.shot ?? "hero";

  // 'over-shoulder' is a special case — derives camera placement from the
  // shoulder point rather than yaw/pitch around the centroid.
  if (shot === "over-shoulder") {
    const from = input.fromPoint ?? [cx - radius * 1.5, cy + radius * 0.6, cz - radius * 1.5];
    // Sit slightly behind the shoulder and above it.
    const dx = cx - from[0];
    const dz = cz - from[2];
    const len = Math.hypot(dx, dz) || 1;
    const back = Math.max(1, radius * 0.8);
    const px = from[0] - (dx / len) * back;
    const pz = from[2] - (dz / len) * back;
    const py = from[1] + Math.max(0.5, radius * 0.4);
    return {
      position: [round(px), round(py), round(pz)],
      target: [round(cx), round(cy), round(cz)],
      radius: round(radius),
    };
  }

  let pitch = 0.4;
  let distMul = 1;
  let yawDefault = Math.PI / 5;
  switch (shot) {
    case "hero":
      pitch = 0.35;
      distMul = 1.0;
      break;
    case "wide":
      pitch = 0.55;
      distMul = 1.8;
      break;
    case "top-down":
      pitch = Math.PI / 2 - 0.05;
      distMul = 1.2;
      yawDefault = 0;
      break;
    case "establishing":
      pitch = 0.65;
      distMul = 2.4;
      break;
  }
  const yaw = input.yaw ?? yawDefault;
  const dist = baseDist * distMul;
  const horiz = Math.cos(pitch) * dist;
  const vert = Math.sin(pitch) * dist;
  const px = cx + Math.sin(yaw) * horiz;
  const pz = cz + Math.cos(yaw) * horiz;
  const py = cy + vert;
  return {
    position: [round(px), round(py), round(pz)],
    target: [round(cx), round(cy), round(cz)],
    radius: round(radius),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
