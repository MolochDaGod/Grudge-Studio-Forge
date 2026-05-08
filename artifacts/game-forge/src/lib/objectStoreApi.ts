import type { RaceId } from "./races";

/**
 * Base URL for the toon-rts-characters asset pack hosted on the public
 * Grudge Studio CDN. Each race in {@link RaceId} maps 1:1 to a `<race>.glb`
 * file under this folder. Files are ~955 KB each with textures baked in,
 * so they render correctly without any sibling texture downloads.
 *
 * Example:
 *   `${RACE_CHARACTER_PACK_BASE}/orc.glb`
 *   → https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/characters/orc.glb
 */
export const RACE_CHARACTER_PACK_BASE =
  "https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/characters";

/**
 * Resolve a {@link RaceId} to its public CDN GLB URL.
 *
 * Type-safe over the canonical race ids from `lib/races.ts` so a typo
 * fails at compile time rather than producing a 404 at render time.
 *
 * The returned URL is an absolute https:// URL — `builtinModels.ensureBaseUrl`
 * leaves it untouched, so it flows through `BUILTIN_MODELS["race:<id>"]`
 * → `EntityRenderer.resolveModelUrl` cleanly.
 */
export function getRaceCharacterUrl(race: RaceId): string {
  return `${RACE_CHARACTER_PACK_BASE}/${race}.glb`;
}
