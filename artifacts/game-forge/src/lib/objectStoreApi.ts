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

/**
 * Base URL for the matching weapon GLBs that ship in the same
 * toon-rts-characters asset pack. Each weapon is an individual `<weapon>.glb`
 * sized to fit the rigged characters above, so it can be parented under a
 * character entity (same pattern as the bundled rifle in the deathmatch
 * templates) without re-scaling.
 *
 * Example:
 *   `${RACE_WEAPON_PACK_BASE}/sword.glb`
 *   → https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/weapons/sword.glb
 */
export const RACE_WEAPON_PACK_BASE =
  "https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/weapons";

/**
 * The fantasy weapon kinds shipped in the toon-rts-characters asset pack
 * that we wire up to per-race defaults. Constrained as a string-literal
 * union so callers (race→weapon registries, the AI tool catalog, etc.)
 * fail at compile time on a typo rather than 404 at render time.
 */
export type RaceWeaponKind =
  | "sword"
  | "bow"
  | "axe"
  | "mace"
  | "club"
  | "staff";

/**
 * Per-race default weapon, mirroring the fantasy roles in `races.ts`:
 *   warrior     → sword (sword-and-shield infantry)
 *   elf         → bow   (swift archer caste)
 *   dwarf       → axe   (stout mountain folk)
 *   frost-dwarf → mace  (heavy northern raider)
 *   orc         → club  (brutal melee)
 *   skeleton    → sword (undead minion)
 *
 * Used by the rpg-village template to parent the right weapon under each
 * character, and exposed via {@link getRaceWeaponUrl} for any other call
 * site that needs the matching weapon GLB for a given race.
 */
export const RACE_WEAPON: Readonly<Record<RaceId, RaceWeaponKind>> = {
  warrior: "sword",
  elf: "bow",
  dwarf: "axe",
  "frost-dwarf": "mace",
  orc: "club",
  skeleton: "sword",
};

/**
 * Resolve a {@link RaceId} to the public CDN GLB URL of its matching
 * fantasy weapon. Returns an absolute https:// URL — `builtinModels.ensureBaseUrl`
 * leaves it untouched, so it flows through `BUILTIN_MODELS["race-weapon:<id>"]`
 * → `EntityRenderer.resolveModelUrl` cleanly, the same way the per-race
 * character helper does.
 */
export function getRaceWeaponUrl(race: RaceId): string {
  return `${RACE_WEAPON_PACK_BASE}/${RACE_WEAPON[race]}.glb`;
}
