/**
 * Unity-style layers system.
 *
 * A small fixed registry of physical roles + a configurable collision matrix
 * decide which Rapier rigid bodies physically interact. Each layer maps to a
 * single membership bit; Rapier's `collisionGroups` packs a 16-bit
 * membership mask in the high half and a 16-bit filter mask in the low half
 * of one 32-bit integer, so we can comfortably address up to 16 layers.
 */

export const LAYERS = [
  "Default",
  "Terrain",
  "Player",
  "NPC",
  "Item",
  "Projectile",
  "Trigger",
  "Water",
  "IgnoreRaycast",
  "UI3D",
] as const;

export type LayerName = (typeof LAYERS)[number];

/** Layers that spawn as Rapier sensors by default (no contact response, but
 *  intersection events still fire so scripts can react). */
export const DEFAULT_SENSOR_LAYERS: LayerName[] = ["Trigger", "Water"];

/** A canonical pair key, sorted alphabetically so `(A,B)` and `(B,A)`
 *  hash to the same matrix entry. */
export function pairKey(a: LayerName, b: LayerName): `${LayerName}|${LayerName}` {
  return (a <= b ? `${a}|${b}` : `${b}|${a}`) as `${LayerName}|${LayerName}`;
}

/** Default collision matrix. `true` = colliders may contact, `false` =
 *  pairs whose interaction should pass through (no contact + no sensor
 *  events). Pairs not listed default to `true` (everything collides with
 *  everything unless turned off). */
export const DEFAULT_COLLISION_MATRIX: Partial<Record<`${LayerName}|${LayerName}`, boolean>> = (() => {
  const m: Partial<Record<`${LayerName}|${LayerName}`, boolean>> = {};
  // IgnoreRaycast still collides physically with everything but is filtered
  // out of raycasts (handled in PlayRuntime).
  // UI3D is decorative — never collides.
  for (const other of LAYERS) m[pairKey("UI3D", other)] = false;
  // Items only collide with Terrain and Player (so NPCs / projectiles
  // don't pinball off pickups).
  for (const other of LAYERS) {
    if (other === "Terrain" || other === "Player" || other === "Item") continue;
    m[pairKey("Item", other)] = false;
  }
  // Projectiles ignore other projectiles & items.
  m[pairKey("Projectile", "Projectile")] = false;
  m[pairKey("Projectile", "Item")] = false;
  // Trigger / Water are sensors — keep their pair entries `true` so
  // intersection events still fire; the sensor flag suppresses contact.
  return m;
})();

/** Look up whether two layers should physically interact. Treats missing
 *  entries as `true` (collide). */
export function layersCollide(
  matrix: Partial<Record<`${LayerName}|${LayerName}`, boolean>> | undefined,
  a: LayerName,
  b: LayerName,
): boolean {
  const key = pairKey(a, b);
  const entry = matrix?.[key];
  if (entry === undefined) {
    const def = DEFAULT_COLLISION_MATRIX[key];
    return def === undefined ? true : def;
  }
  return entry;
}

/** Membership bit for a single layer (1 << index). */
export function layerBit(layer: LayerName): number {
  const i = LAYERS.indexOf(layer);
  return i < 0 ? 1 : 1 << i;
}

/** Build the 16-bit "filter" mask: bit i is set when `layer` may collide
 *  with `LAYERS[i]` according to `matrix`. */
export function layerFilterMask(
  layer: LayerName,
  matrix: Partial<Record<`${LayerName}|${LayerName}`, boolean>> | undefined,
): number {
  let mask = 0;
  for (let i = 0; i < LAYERS.length; i++) {
    if (layersCollide(matrix, layer, LAYERS[i])) mask |= 1 << i;
  }
  return mask & 0xffff;
}

/** Pack into Rapier's 32-bit `collisionGroups` (membership in high 16,
 *  filter in low 16). */
export function rapierCollisionGroups(
  layer: LayerName,
  matrix: Partial<Record<`${LayerName}|${LayerName}`, boolean>> | undefined,
): number {
  const membership = layerBit(layer) & 0xffff;
  const filter = layerFilterMask(layer, matrix);
  return ((membership << 16) | filter) >>> 0;
}
