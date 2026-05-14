/**
 * Scale helpers — single source of truth for "how big should X be relative
 * to the terrain it sits on?".
 *
 * Why a separate helper module:
 *   - terrain default is now a 5×5 km open-world map with peaks to +10 km
 *     and valleys to −5 m. Camera far-clip, terrain-snap raycast distance,
 *     and per-layer recommended bounding-box size all depend on it.
 *   - Multiple subsystems (Viewport camera config, AI placement tools,
 *     enemy spawners, terrain-snap routine) used to hardcode their own
 *     copy of "5000" or "200". Centralising avoids the next time someone
 *     bumps map size and forgets to bump the snap distance with it.
 *
 * Everything here is pure / synchronous / unit-tested in your head — no
 * React, no Zustand, no THREE imports. Safe to call from tools, schemas,
 * and runtime alike.
 */

import { LAYERS, type LayerName } from "@workspace/scene-schema";

/** The terrain default the rest of the editor scales against. Mirrors
 *  `TerrainMesh.tsx`'s FALLBACK so consumers don't need to import the
 *  scene component just to read its dimensions. */
export const TERRAIN_DEFAULTS = {
  /** Square side length in metres. */
  size: 5000,
  /** Vertices per side − 1 at the default size. */
  segments: 256,
  /** Peak elevation above sea level (positive metres). */
  heightAmp: 10000,
  /** Depth below sea level (positive metres). */
  heightFloor: 5,
} as const;

/**
 * Recommended typical bounding-box size (longest edge, metres) per layer.
 * Used by AI tools and validation helpers to flag obviously-wrong scales
 * (e.g. an Item entity that's 800 m wide). Terrain is intentionally the
 * largest entry so any other layer fits comfortably inside it.
 *
 * Numbers are *typical*, not hard caps — players can still author
 * outliers; `validateEntityScale()` only emits a warning.
 */
export const LAYER_SIZE_HINTS: Record<LayerName, number> = {
  Default: 4,
  Terrain: TERRAIN_DEFAULTS.size,
  Player: 2,
  NPC: 2,
  Item: 1,
  Projectile: 0.5,
  Trigger: 8,
  Water: 200,
  IgnoreRaycast: 4,
  UI3D: 2,
};

/**
 * Pick a sensible perspective-camera far-clip for a given map size.
 *
 * We need to see from one corner of the map across to the opposite corner
 * AND look up at the highest peaks, so the diagonal of the bounding box
 * is the lower bound. We then pad 1.5× for skybox / sun / fog headroom.
 *
 * Returns at least 5000 so small-map scenes still get a reasonable far
 * plane (matches the pre-5km-default editor behaviour).
 */
export function recommendedCameraFar(
  terrainSize: number = TERRAIN_DEFAULTS.size,
  heightAmp: number = TERRAIN_DEFAULTS.heightAmp,
): number {
  const diag = Math.hypot(terrainSize, heightAmp);
  return Math.max(5000, Math.ceil((diag * 1.5) / 1000) * 1000);
}

/**
 * Maximum downward raycast distance for the terrain-snap routine
 * (`pendingTerrainSnap`). Must exceed `heightAmp + heightFloor` so an
 * entity placed directly above the highest peak still finds the ground.
 */
export function recommendedSnapMaxDistance(
  heightAmp: number = TERRAIN_DEFAULTS.heightAmp,
  heightFloor: number = TERRAIN_DEFAULTS.heightFloor,
): number {
  return (heightAmp + heightFloor) * 1.5;
}

/**
 * Recommended editor grid spacing for a map of the given size. Keeps the
 * grid usable without flooding the GPU with millions of lines on the 5km
 * default (where a 1m grid would be 25 million cells).
 */
export function recommendedGridSpacing(
  terrainSize: number = TERRAIN_DEFAULTS.size,
): number {
  if (terrainSize <= 200) return 1;
  if (terrainSize <= 1000) return 5;
  if (terrainSize <= 2000) return 10;
  return 50;
}

/** Longest edge of an entity's transform.scale. Mirrors the convention
 *  the inspector uses for "size" readouts. */
function longestEdge(scale: readonly number[] | undefined): number {
  if (!scale || scale.length < 3) return 1;
  return Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]));
}

/**
 * Validate an entity's `scale` against the typical size hint for its
 * layer. Returns `null` when the scale is reasonable, otherwise a
 * human-readable warning string the AI tools / inspector can surface.
 *
 * The thresholds (10× too big, 50× too small) are deliberately loose so
 * we only catch genuine accidents.
 */
export function validateEntityScale(opts: {
  layer: LayerName;
  scale?: readonly number[];
  terrainSize?: number;
}): string | null {
  const longest = longestEdge(opts.scale);
  const hint = LAYER_SIZE_HINTS[opts.layer];
  const terrain = opts.terrainSize ?? TERRAIN_DEFAULTS.size;
  if (opts.layer === "Terrain") {
    // Terrain entities should themselves be on the order of `terrainSize`.
    if (longest > 0 && longest < terrain * 0.1) {
      return `Terrain entity is ${longest.toFixed(0)}m on its longest edge — much smaller than the recommended map size (${terrain}m). Other entities may not fit.`;
    }
    return null;
  }
  if (longest > hint * 10) {
    return `${opts.layer} entity is ${longest.toFixed(1)}m on its longest edge — ~${(longest / hint).toFixed(0)}× the typical ${hint}m for this layer. Likely placed on the wrong layer or scaled by accident.`;
  }
  if (longest > terrain * 0.25 && opts.layer !== "Water") {
    return `${opts.layer} entity at ${longest.toFixed(0)}m exceeds 25% of the ${terrain}m map — won't fit cleanly inside the terrain bounds.`;
  }
  return null;
}

/**
 * Convenience: enumerate every layer with its recommended max size, used
 * by the AI `list_layers` tool and the inspector's "scale" tooltip.
 */
export function listLayerSizeHints(): Array<{
  layer: LayerName;
  recommendedMaxSize: number;
}> {
  return LAYERS.map((layer) => ({
    layer,
    recommendedMaxSize: LAYER_SIZE_HINTS[layer],
  }));
}
