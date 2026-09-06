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

const CDN = "https://assets.grudge-studio.com/models/nature";
const tree = (n: number) => `${CDN}/CommonTree_${n}.glb`;
const pine = (n: number) => `${CDN}/Pine_${n}.glb`;
const rock = (n: number) => `${CDN}/Rock_Medium_${n}.glb`;
const BUSH = `${CDN}/Bush_Common.glb`;
const PLANT = `${CDN}/Plant_1.glb`;
const FERN = `${CDN}/Fern_1.glb`;

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
    foliage: [tree(1), tree(2), BUSH, PLANT],
    structures: [],
    props: [rock(1), rock(2)],
    harvestables: [],
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
    foliage: [tree(3), pine(1), pine(2), BUSH],
    structures: [],
    props: [rock(1), rock(2), rock(3)],
    harvestables: [],
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
    foliage: [pine(3), pine(4), pine(5), rock(1)],
    structures: [],
    props: [rock(2), rock(3)],
    harvestables: [],
    monsters: ["char-wolf", "char-skeleton-sword"],
    npcs: ["char-survivor-male"],
    vfx: ["vfx-freeze"],
    lightColor: "#a0d0ff",
    lightIntensity: 2,
    foliageDensity: 0.8,
  },

  /* ─── Volcanic (Ember Depths) — lava-floored caldera ───────────────── */
  volcanic: {
    groundColor: "#2a1005",
    foliage: [rock(1), rock(2), rock(3)],
    structures: [],
    props: [rock(1)],
    harvestables: [],
    monsters: ["char-lava-sancho", "char-boss-orc"],
    npcs: ["char-lava-sancho"],
    vfx: ["vfx-stylized-fire", "vfx-fire-anim", "vfx-stylized-fire-tornado"],
    lightColor: "#ff4400",
    lightIntensity: 7,
    foliageDensity: 0.2,
  },

  /* ─── Desert (Ashen Wastes) — scorched ruins, bandits ──────────────── */
  desert: {
    groundColor: "#9a6a30",
    foliage: [PLANT, BUSH, rock(1)],
    structures: [],
    props: [rock(2), rock(3)],
    harvestables: [],
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
    foliage: [rock(2), rock(3), BUSH],
    structures: [],
    props: [rock(1)],
    harvestables: [],
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
    foliage: [tree(4), tree(5), FERN],
    structures: [],
    props: [rock(1), FERN],
    harvestables: [],
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
    foliage: [rock(1)],
    structures: [],
    props: [rock(2)],
    harvestables: [],
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
    foliage: [tree(1), BUSH, rock(1)],
    structures: [],
    props: [rock(2), rock(3)],
    harvestables: [],
    monsters: ["char-boss-orc"],
    npcs: ["char-survivor-male"],
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
