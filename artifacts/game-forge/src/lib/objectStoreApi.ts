import type { RaceId } from "./races";

/**
 * Base URL for the toon-rts-characters asset pack hosted on the public
 * Grudge Studio CDN. The pack publishes six character GLBs under faction
 * names (`human`, `barbarian`, `elf`, `dwarf`, `orc`, `undead`) — three of
 * those don't match our internal {@link RaceId} ids, so callers must go
 * through {@link getRaceCharacterUrl} rather than concatenating manually.
 *
 * Files range ~870 KB (human) – ~1.1 MB (elf) with textures baked in, so
 * they render correctly without any sibling texture downloads.
 */
export const RACE_CHARACTER_PACK_BASE =
  "https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/characters";

/**
 * Map our internal {@link RaceId} → the actual filename on the CDN. The
 * pack uses the source faction names from the original Toon_RTS Unity
 * asset; we expose flavored display ids in `lib/races.ts` instead.
 *
 *   warrior     → human       (Western Kingdoms human soldier)
 *   dwarf       → dwarf
 *   frost-dwarf → barbarian   (northern raider — closest cold-themed model)
 *   elf         → elf
 *   orc         → orc
 *   skeleton    → undead
 */
const RACE_TO_PACK_FILENAME: Readonly<Record<RaceId, string>> = {
  warrior: "human",
  dwarf: "dwarf",
  "frost-dwarf": "barbarian",
  elf: "elf",
  orc: "orc",
  skeleton: "undead",
};

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
  return `${RACE_CHARACTER_PACK_BASE}/${RACE_TO_PACK_FILENAME[race]}.glb`;
}
