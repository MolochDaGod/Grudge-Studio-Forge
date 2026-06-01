/**
 * Sector Asset Tables — maps each SectorBiome to the best available
 * builtin GLB model keys for procedural map generation.
 *
 * All keys reference entries in `BUILTIN_MODELS` (lib/builtinModels.ts)
 * using the stable `builtin:<key>` URL convention via their raw key.
 *
 * Generators in mapGen.ts pick from these lists to scatter:
 *   - foliage   : Trees, plants, icicles, rocks
 *   - structures: Buildings, large props
 *   - props     : Small interactive objects, cover, ambient dressing
 *   - harvestables: Resource pickup nodes (glowing crystal pickups)
 *   - monsters  : Enemy model entities (combat-ready NPCs + creatures)
 *   - npcs      : Friendly/neutral character models
 *   - vfx       : Ambient VFX models (fire, freeze, leaves...)
 *
 * Light config is also biome-driven to match the sector's forgeEnv palette.
 */

import type { SectorBiome } from "@/lib/worldSectors";

export interface BiomeAssets {
  /** Ground plane material color (hex) */
  groundColor: string;
  /** Foliage / tree models (builtin keys, no "builtin:" prefix) */
  foliage: string[];
  /** Large structural models */
  structures: string[];
  /** Small prop models for scatter / cover */
  props: string[];
  /** Harvestable resource nodes */
  harvestables: string[];
  /** Enemy / monster models */
  monsters: string[];
  /** Neutral NPC models */
  npcs: string[];
  /** Ambient VFX model emitters */
  vfx: string[];
  /** Ambient point-light color for this biome */
  lightColor: string;
  /** Ambient point-light intensity */
  lightIntensity: number;
  /** Density multiplier for foliage scatter (1 = default) */
  foliageDensity: number;
}

export const SECTOR_ASSETS: Record<SectorBiome, BiomeAssets> = {

  /* ─── Tropical (Haven Shore) — lush, safe starter zone ─────────────── */
  tropical: {
    groundColor: "#1a4a1a",
    foliage: ["nature-tropical-pack", "nature-tree"],
    structures: ["bldg-woodcutter-hut", "bldg-tavern"],
    props: ["prop-survival-items", "prop-survivors-tent"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-shark", "char-crow"],
    npcs: ["char-survivor-male", "char-ncr-ranger"],
    vfx: ["vfx-leaves"],
    lightColor: "#ffe0a0",
    lightIntensity: 4,
    foliageDensity: 1.4,
  },

  /* ─── Forest (Thornwood Wilds) — dense, hostile ancient forest ──────── */
  forest: {
    groundColor: "#1a3010",
    foliage: ["nature-tree-pack", "nature-autumn-trees", "nature-tree"],
    structures: ["bldg-woodcutter-hut"],
    props: ["prop-medieval", "prop-crystal-gems"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-wolf", "char-skeleton-sword", "char-skeleton-axe"],
    npcs: ["char-survivor-male"],
    vfx: ["vfx-leaves"],
    lightColor: "#80ff60",
    lightIntensity: 3,
    foliageDensity: 1.6,
  },

  /* ─── Frozen (Frostbite Expanse) — icy wasteland, blizzards ────────── */
  frozen: {
    groundColor: "#aac8e0",
    foliage: ["nature-icicles"],
    structures: ["prop-survival-items"],
    props: ["prop-medieval"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-wolf", "race:frost-dwarf", "char-skeleton-sword"],
    npcs: ["race:dwarf"],
    vfx: ["vfx-freeze"],
    lightColor: "#a0d0ff",
    lightIntensity: 2,
    foliageDensity: 0.8,
  },

  /* ─── Volcanic (Ember Depths) — lava-floored caldera ───────────────── */
  volcanic: {
    groundColor: "#2a1005",
    foliage: [],
    structures: ["prop-medieval"],
    props: ["prop-toon-weapons"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-lava-sancho", "char-boss-orc", "race:orc"],
    npcs: ["char-lava-sancho"],
    vfx: ["vfx-stylized-fire", "vfx-fire-anim", "vfx-stylized-fire-tornado"],
    lightColor: "#ff4400",
    lightIntensity: 7,
    foliageDensity: 0.2,
  },

  /* ─── Desert (Ashen Wastes) — scorched ruins, bandits ──────────────── */
  desert: {
    groundColor: "#9a6a30",
    foliage: [],
    structures: ["prop-medieval", "bldg-tavern"],
    props: ["prop-medieval", "prop-survival-items"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-bandit", "char-crow", "char-ncr-ranger"],
    npcs: ["char-ncr-ranger"],
    vfx: [],
    lightColor: "#ffaa40",
    lightIntensity: 5,
    foliageDensity: 0.15,
  },

  /* ─── Storm (Stormbreak Reef) — reef, shipwrecks, lightning ────────── */
  storm: {
    groundColor: "#1a2035",
    foliage: [],
    structures: ["prop-survivors-tent"],
    props: ["prop-survival-items", "prop-toon-weapons"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-shark", "char-crow", "char-bandit"],
    npcs: ["char-survivor-male"],
    vfx: [],
    lightColor: "#60a0ff",
    lightIntensity: 3,
    foliageDensity: 0.1,
  },

  /* ─── Ethereal (Ethereal Falls) — floating islands, spectral mist ─── */
  ethereal: {
    groundColor: "#180828",
    foliage: ["nature-tree"],
    structures: ["prop-crystal-gems"],
    props: ["prop-crystal-gems", "prop-toon-weapons"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-distortus-rex", "char-crow", "char-skeleton-sword"],
    npcs: [],
    vfx: ["vfx-stylized-fire-tornado", "vfx-fire-hurricane"],
    lightColor: "#bf40ff",
    lightIntensity: 4,
    foliageDensity: 0.6,
  },

  /* ─── Abyssal (Abyssal Trench) — crushing deep, undead leviathans ─── */
  abyssal: {
    groundColor: "#020510",
    foliage: [],
    structures: [],
    props: ["prop-medieval"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-skeleton-axe", "char-skeleton-sword", "char-distortus-rex"],
    npcs: [],
    vfx: [],
    lightColor: "#0080ff",
    lightIntensity: 2,
    foliageDensity: 0.0,
  },

  /* ─── Nexus (Convergence Nexus) — contested PvP heart of the world ── */
  nexus: {
    groundColor: "#1a1040",
    foliage: [],
    structures: ["bldg-tavern", "prop-medieval"],
    props: ["prop-crystal-gems", "prop-toon-weapons"],
    harvestables: ["prop-crystal-gems"],
    monsters: ["char-boss-orc", "race:warrior", "race:orc", "race:skeleton"],
    npcs: ["race:warrior", "race:elf"],
    vfx: ["vfx-stylized-fire-tornado"],
    lightColor: "#c084fc",
    lightIntensity: 6,
    foliageDensity: 0.3,
  },
};

/** Pick a random element from an array using a seeded rng. Returns undefined if empty. */
export function pick<T>(arr: readonly T[], rng: () => number): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}
