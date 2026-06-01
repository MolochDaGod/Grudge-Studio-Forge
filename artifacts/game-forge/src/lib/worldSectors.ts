/**
 * Grudge World Sectors — 9 macro-regions imported from the Grudge Warlords
 * world map, adapted for use in the Forge editor.
 *
 * Each sector carries:
 *   - Name / biome / description / lore
 *   - Difficulty range, hazards, resources
 *   - A `forgeEnv` mapping that converts the sector's sky/fog/lighting
 *     into a Forge `Environment` partial, so one click applies the look.
 *
 * Layout (3×3):
 *   ┌──────────────┬──────────────┬──────────────┐
 *   │ Ethereal     │ Frostbite    │ Thornwood    │
 *   │ Falls        │ Expanse      │ Wilds        │
 *   ├──────────────┼──────────────┼──────────────┤
 *   │ Stormbreak   │ Convergence  │ Ashen        │
 *   │ Reef         │ Nexus        │ Wastes       │
 *   ├──────────────┼──────────────┼──────────────┤
 *   │ Abyssal      │ Haven        │ Ember        │
 *   │ Trench       │ Shore        │ Depths       │
 *   └──────────────┴──────────────┴──────────────┘
 */

import type { Environment } from "@/scene/types";

export type SectorBiome =
  | "frozen"
  | "storm"
  | "forest"
  | "desert"
  | "ethereal"
  | "volcanic"
  | "abyssal"
  | "nexus"
  | "tropical";

export interface ForgeSector {
  id: string;
  name: string;
  description: string;
  lore: string;
  biome: SectorBiome;
  difficultyMin: number;
  difficultyMax: number;
  /** Grid column 0-2 (left→right) and row 0-2 (top→bottom) */
  col: number;
  row: number;
  /** Primary color palette */
  colors: { deep: string; mid: string; accent: string; glow?: string };
  hazards: string[];
  resources: string[];
  ambientFx: string[];
  isSafeZone?: boolean;
  isContested?: boolean;
  /** Forge Environment partial — apply with setEnvironmentCommand to set sky/fog/lighting */
  forgeEnv: Partial<Environment>;
  /** A seed string derived from the sector id for use with the Map Generator */
  defaultSeed: string;
}

// ── Helper: int colour (0xRRGGBB) → CSS hex string ──────────────────────────
function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

// ── The 9 Sectors ────────────────────────────────────────────────────────────

export const WORLD_SECTORS: ForgeSector[] = [
  // ── Row 0 — Top ───────────────────────────────────────────────────────────
  {
    id: "ethereal_falls",
    name: "Ethereal Falls",
    description: "Impossible beauty and lethal danger — luminescent waterfalls cascade from floating islands.",
    lore: "When the First God wept during the Sundering, their tears became rivers of liquid light that flow upward, defying gravity. The mist below is alive — phantoms of drowned sailors reach up from the luminous depths.",
    biome: "ethereal",
    difficultyMin: 6,
    difficultyMax: 9,
    col: 0,
    row: 0,
    colors: { deep: "#0c0a1a", mid: "#2d1b69", accent: "#00e5ff", glow: "#bf40ff" },
    hazards: ["spectral_mist_drain", "gravity_inversion", "phantom_grasp", "crystal_overload"],
    resources: ["ethereal_crystals", "spectral_essence", "luminous_pearl", "gravity_stone", "tear_of_the_first_god"],
    ambientFx: ["waterfall_glow_purple", "floating_islands", "spectral_mist_rising", "phantom_wisps"],
    forgeEnv: {
      skyColor: hex(0x0c0a1a),
      groundColor: hex(0x2d1b69),
      ambientIntensity: 0.3,
      sunIntensity: 0.5,
      fog: { color: hex(0x1a0e30), near: 100, far: 380 },
    },
    defaultSeed: "ethereal_falls",
  },
  {
    id: "frostbite_expanse",
    name: "Frostbite Expanse",
    description: "A frozen wasteland of endless ice sheets and howling blizzards.",
    lore: "When the Sundering cracked the northern shelf, the sea froze in an instant, trapping ancient ships in eternal ice. Frost spirits patrol the glaciers.",
    biome: "frozen",
    difficultyMin: 4,
    difficultyMax: 7,
    col: 1,
    row: 0,
    colors: { deep: "#0a1628", mid: "#1a3a5c", accent: "#7dd3fc" },
    hazards: ["blizzard_damage", "ice_patches", "frostbite_dot", "avalanche_zones"],
    resources: ["frost_herbs", "ice", "crystals", "whale_bone", "arctic_fish"],
    ambientFx: ["snowfall", "fog_dense", "ice_sparkle"],
    forgeEnv: {
      skyColor: hex(0x8899bb),
      groundColor: hex(0x1a3a5c),
      ambientIntensity: 0.7,
      sunIntensity: 0.8,
      fog: { color: hex(0xb0c4de), near: 60, far: 200 },
    },
    defaultSeed: "frostbite_expanse",
  },
  {
    id: "thornwood_wilds",
    name: "Thornwood Wilds",
    description: "An ancient forest so dense that sunlight never reaches the floor.",
    lore: "The Thornwood predates the factions. Its roots drink from the Worldboard itself. Worge clans claim dominion here, but the forest answers to no one.",
    biome: "forest",
    difficultyMin: 3,
    difficultyMax: 7,
    col: 2,
    row: 0,
    colors: { deep: "#052e16", mid: "#166534", accent: "#4ade80" },
    hazards: ["poison_thorns", "beast_ambush", "quicksand", "living_vines"],
    resources: ["hardwood", "herbs", "berries", "rare_mushrooms", "beast_hides"],
    ambientFx: ["fireflies", "leaf_fall", "fog_light", "pollen_drift"],
    forgeEnv: {
      skyColor: hex(0x4a6741),
      groundColor: hex(0x166534),
      ambientIntensity: 0.35,
      sunIntensity: 0.7,
      fog: { color: hex(0x2d4a22), near: 80, far: 280 },
    },
    defaultSeed: "thornwood_wilds",
  },

  // ── Row 1 — Middle ────────────────────────────────────────────────────────
  {
    id: "stormbreak_reef",
    name: "Stormbreak Reef",
    description: "Perpetual thunderstorms rage above a maze of razor-sharp coral reefs.",
    lore: "The gods clashed above these waters during the First Grudge, and the storm never stopped. Ships that wander in are torn apart by lightning-charged waves.",
    biome: "storm",
    difficultyMin: 3,
    difficultyMax: 6,
    col: 0,
    row: 1,
    colors: { deep: "#0f172a", mid: "#334155", accent: "#fbbf24" },
    hazards: ["lightning_strikes", "whirlpools", "reef_damage", "rogue_waves"],
    resources: ["shells", "coral", "rare_ore", "storm_crystals"],
    ambientFx: ["rain_heavy", "lightning_flashes", "wave_spray"],
    forgeEnv: {
      skyColor: hex(0x2c3e50),
      groundColor: hex(0x0f172a),
      ambientIntensity: 0.4,
      sunIntensity: 0.6,
      fog: { color: hex(0x34495e), near: 40, far: 150 },
    },
    defaultSeed: "stormbreak_reef",
  },
  {
    id: "convergence_nexus",
    name: "Convergence Nexus",
    description: "The exact center of the world — where all factions converge.",
    lore: "Every ley line, every current, every wind pattern spirals toward this point. The Gould Flame itself pulses beneath these waters. Control the Nexus, and you control the world.",
    biome: "nexus",
    difficultyMin: 7,
    difficultyMax: 10,
    col: 1,
    row: 1,
    colors: { deep: "#1e1b4b", mid: "#4338ca", accent: "#fbbf24", glow: "#c084fc" },
    hazards: ["faction_pvp", "ley_line_surges", "reality_tears", "boss_spawns"],
    resources: ["rare_ore", "fire_crystals", "void_essence", "gould_shards"],
    ambientFx: ["energy_vortex", "aurora", "floating_debris", "ley_line_glow"],
    isContested: true,
    forgeEnv: {
      skyColor: hex(0x1a0a30),
      groundColor: hex(0x1e1b4b),
      ambientIntensity: 0.5,
      sunIntensity: 0.9,
      fog: { color: hex(0x1e1b4b), near: 80, far: 300 },
    },
    defaultSeed: "convergence_nexus",
  },
  {
    id: "ashen_wastes",
    name: "Ashen Wastes",
    description: "A scorched desert of glass and bone, ruled by ancient ruins.",
    lore: "Before the Sundering, this was the seat of a great civilization. Now their towers rise from dunes of ash like broken teeth. Sandworms patrol the wastes.",
    biome: "desert",
    difficultyMin: 5,
    difficultyMax: 8,
    col: 2,
    row: 1,
    colors: { deep: "#451a03", mid: "#92400e", accent: "#fbbf24" },
    hazards: ["heat_exhaustion", "sandstorm", "glass_shard_terrain", "cursed_relics"],
    resources: ["gold_ore", "ancient_relics", "scorpion_venom", "glass_shards", "cactus"],
    ambientFx: ["dust_swirl", "heat_shimmer", "sand_particles"],
    forgeEnv: {
      skyColor: hex(0xd4a574),
      groundColor: hex(0x92400e),
      ambientIntensity: 0.8,
      sunIntensity: 1.6,
      fog: { color: hex(0xc4956a), near: 120, far: 400 },
    },
    defaultSeed: "ashen_wastes",
  },

  // ── Row 2 — Bottom ────────────────────────────────────────────────────────
  {
    id: "abyssal_trench",
    name: "Abyssal Trench",
    description: "The deepest waters in the world — home to leviathans and sunken empires.",
    lore: "The trench plunges so deep that light becomes a memory. Bioluminescent horrors patrol its depths, and the pressure alone can crush a hull.",
    biome: "abyssal",
    difficultyMin: 7,
    difficultyMax: 10,
    col: 0,
    row: 2,
    colors: { deep: "#020617", mid: "#0f172a", accent: "#06b6d4", glow: "#22d3ee" },
    hazards: ["crushing_pressure", "leviathan_attacks", "darkness_debuff", "siren_lure"],
    resources: ["abyssal_ore", "leviathan_scale", "deep_coral", "void_fish", "ocean_heart"],
    ambientFx: ["bioluminescence", "bubble_columns", "deep_fog", "creature_shadows"],
    forgeEnv: {
      skyColor: hex(0x020617),
      groundColor: hex(0x0f172a),
      ambientIntensity: 0.15,
      sunIntensity: 0.3,
      fog: { color: hex(0x040810), near: 25, far: 100 },
    },
    defaultSeed: "abyssal_trench",
  },
  {
    id: "haven_shore",
    name: "Haven Shore",
    description: "Calm tropical waters and gentle islands — the safest region in the world.",
    lore: "Haven Shore is where every pirate begins their journey. Protected by the Grudge Pact, violence is forbidden in these waters. Palm-fringed islands offer shelter and the first taste of adventure.",
    biome: "tropical",
    difficultyMin: 1,
    difficultyMax: 3,
    col: 1,
    row: 2,
    colors: { deep: "#164e63", mid: "#0891b2", accent: "#fbbf24" },
    hazards: [],
    resources: ["coconut", "palm_frond", "fish", "shells", "hardwood", "herbs"],
    ambientFx: ["gentle_waves", "seagulls", "palm_sway", "sunset_glow"],
    isSafeZone: true,
    forgeEnv: {
      skyColor: hex(0x87ceeb),
      groundColor: hex(0x0891b2),
      ambientIntensity: 0.7,
      sunIntensity: 1.4,
      fog: { color: hex(0x87ceeb), near: 200, far: 600 },
    },
    defaultSeed: "haven_shore",
  },
  {
    id: "ember_depths",
    name: "Ember Depths",
    description: "Volcanic islands erupting with molten fury and Gould Flame energy.",
    lore: "The Sundering ripped open the seabed here, exposing rivers of magma that flow into the ocean. The resulting islands are young, brutal, and rich with Gould Flame shards. The Legion was born in places like this.",
    biome: "volcanic",
    difficultyMin: 5,
    difficultyMax: 9,
    col: 2,
    row: 2,
    colors: { deep: "#1c0a00", mid: "#7c2d12", accent: "#f97316", glow: "#ef4444" },
    hazards: ["lava_flows", "eruption_events", "toxic_gas", "fire_elementals"],
    resources: ["obsidian", "sulfur", "fire_crystals", "rare_ore", "gems"],
    ambientFx: ["ember_rain", "lava_glow", "smoke_plumes", "heat_distortion"],
    forgeEnv: {
      skyColor: hex(0x1a0500),
      groundColor: hex(0x7c2d12),
      ambientIntensity: 0.4,
      sunIntensity: 1.0,
      fog: { color: hex(0x2a0a00), near: 50, far: 180 },
    },
    defaultSeed: "ember_depths",
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getSectorById(id: string): ForgeSector | undefined {
  return WORLD_SECTORS.find((s) => s.id === id);
}

/** Sorted layout order: row 0 top → row 2 bottom, left → right within each row */
export const SECTOR_GRID: ForgeSector[][] = [
  [WORLD_SECTORS[0], WORLD_SECTORS[1], WORLD_SECTORS[2]], // Ethereal, Frostbite, Thornwood
  [WORLD_SECTORS[3], WORLD_SECTORS[4], WORLD_SECTORS[5]], // Stormbreak, Nexus, Ashen
  [WORLD_SECTORS[6], WORLD_SECTORS[7], WORLD_SECTORS[8]], // Abyssal, Haven, Ember
];

/** Biome → human-readable label */
export const BIOME_LABELS: Record<SectorBiome, string> = {
  frozen: "Frozen",
  storm: "Storm",
  forest: "Ancient Forest",
  desert: "Desert",
  ethereal: "Ethereal Magic",
  volcanic: "Volcanic",
  abyssal: "Deep Abyss",
  nexus: "Contested Nexus",
  tropical: "Tropical",
};
