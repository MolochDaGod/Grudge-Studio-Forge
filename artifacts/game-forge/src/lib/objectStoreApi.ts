import type { RaceId } from "./races";

/**
 * Race character + weapon URLs on the production CDN.
 *
 * Characters: toon-rts single-mesh GLBs (one hero per file — good for templates).
 * Weapons: grudge6 modular library pieces (toon-rts weapons/* currently 404).
 *
 * Never bake absolute CDN URLs into saved scene JSON — use `builtin:race:*`
 * and `builtin:race-weapon:*` keys in BUILTIN_MODELS.
 */

export const RACE_CHARACTER_PACK_BASE =
  "https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/characters";

/** Internal RaceId → toon-rts pack filename (CDN). */
const RACE_TO_PACK_FILENAME: Readonly<Record<RaceId, string>> = {
  warrior: "human",
  dwarf: "dwarf",
  "frost-dwarf": "barbarian",
  elf: "elf",
  orc: "orc",
  skeleton: "undead",
};

export function getRaceCharacterUrl(race: RaceId): string {
  return `${RACE_CHARACTER_PACK_BASE}/${RACE_TO_PACK_FILENAME[race]}.glb`;
}

/**
 * grudge6 mesh library base — production weapons (verified 200 on CDN).
 * Path: models/grudge6/races/library/{raceFolder}/{file}.glb
 */
export const GRUDGE6_LIBRARY_BASE =
  "https://assets.grudge-studio.com/models/grudge6/races/library";

export type RaceWeaponKind =
  | "sword"
  | "bow"
  | "axe"
  | "mace"
  | "club"
  | "staff"
  | "hammer";

/** Fantasy role defaults for templates / AI tools. */
export const RACE_WEAPON: Readonly<Record<RaceId, RaceWeaponKind>> = {
  warrior: "sword",
  elf: "bow",
  dwarf: "axe",
  "frost-dwarf": "hammer",
  orc: "axe",
  skeleton: "sword",
};

/**
 * Per-race library weapon file (exact names on R2 library folders).
 * Verified live 2026-07-11 — do not invent filenames.
 */
const RACE_WEAPON_LIBRARY_FILE: Readonly<Record<RaceId, string>> = {
  warrior: "human/WK_weapon_sword_A.glb",
  elf: "elf/ELF_weapon_bow.glb",
  dwarf: "dwarf/DWF_Weapon_axe_A.glb",
  "frost-dwarf": "barbarian/BRB_weapon_hammer_A.glb",
  orc: "orc/ORC_weapon_Axe_A.glb",
  skeleton: "undead/UD_weapon_Sword_A.glb",
};

/** @deprecated toon-rts weapons pack 404s — kept for docs only. */
export const RACE_WEAPON_PACK_BASE =
  "https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/weapons";

/**
 * Resolve a race to a working CDN weapon GLB (grudge6 library).
 */
export function getRaceWeaponUrl(race: RaceId): string {
  return `${GRUDGE6_LIBRARY_BASE}/${RACE_WEAPON_LIBRARY_FILE[race]}`;
}

/**
 * Full modular race kits (optional — multi-mesh equip). Prefer single-mesh
 * `getRaceCharacterUrl` for simple templates; use kits when equipping mesh_ids.
 */
export const GRUDGE6_RACE_KIT: Readonly<Record<RaceId, string>> = {
  warrior: "https://assets.grudge-studio.com/models/grudge6/races/WK_Characters.glb",
  dwarf: "https://assets.grudge-studio.com/models/grudge6/races/DWF_Characters.glb",
  "frost-dwarf": "https://assets.grudge-studio.com/models/grudge6/races/BRB_Characters.glb",
  elf: "https://assets.grudge-studio.com/models/grudge6/races/ELF_Characters.glb",
  orc: "https://assets.grudge-studio.com/models/grudge6/races/ORC_Characters.glb",
  skeleton: "https://assets.grudge-studio.com/models/grudge6/races/UD_Characters.glb",
};

export function getRaceKitUrl(race: RaceId): string {
  return GRUDGE6_RACE_KIT[race];
}
