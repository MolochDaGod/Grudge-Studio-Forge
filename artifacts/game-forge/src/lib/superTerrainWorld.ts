/**
 * Super Terrain → Forge world bake (data + heightfield + kits).
 *
 * Source: GrudgeBlox `shared/maps/generateIsland.ts` +
 * `superTerrainBake.ts` and Super Terrain
 * (https://github.com/vibe-stack/super-terrain) forest presets, foliage
 * species, climate bands, paint channels, procedural surface ids.
 * Do not vendor the WebGPU/Godot editor. Do not import Island Terrain
 * WorldTerrain into Forge. Agentic tools call create_world / paint_world_brush.
 */
import type { HeightfieldComponent } from "@workspace/scene-schema";

export const SUPER_TERRAIN_REPO = "https://github.com/vibe-stack/super-terrain";

/** Live catalog — editors / games / AI should fetch this, not invent paths. */
export const SUPER_TERRAIN_CATALOG_URLS = {
  info: "https://info.grudge-studio.com/api/v1/super-terrain.json",
  objectstore: "https://objectstore.grudge-studio.com/api/v1/super-terrain.json",
  cdn: "https://assets.grudge-studio.com/catalogs/super-terrain.json",
} as const;

export const SUPER_TERRAIN_KINDS = [
  "harbor-atoll",
  "volcanic-ridge",
  "frozen-fjord",
  "alpine-mesh",
  "granite-csg",
  "spline-forest",
  "tunnel-cavern",
] as const;

export type SuperTerrainKind = (typeof SUPER_TERRAIN_KINDS)[number];

export const ISLAND_BIOMES = [
  "ocean",
  "shore",
  "sand",
  "grass",
  "forest",
  "rock",
  "snow",
  "lava",
] as const;

export const BIOME_GROUND: Record<(typeof ISLAND_BIOMES)[number], string> = {
  ocean: "#163a52",
  shore: "#c2a878",
  sand: "#d4c49a",
  grass: "#3d6b2e",
  forest: "#1a3d14",
  rock: "#5a544c",
  snow: "#e8eef4",
  lava: "#6b1c08",
};

const N = "https://assets.grudge-studio.com/models/nature";

/**
 * Super Terrain foliage species → Kenney **single** meshes (not vegetation packs).
 * Indices match ISLAND_BIOMES. Ocean (0) is empty — water column, not trees.
 */
export const BIOME_FOLIAGE: Record<(typeof ISLAND_BIOMES)[number], string[]> = {
  ocean: [],
  shore: [`${N}/Bush_Common.glb`, `${N}/Plant_1.glb`],
  sand: [`${N}/Bush_Common.glb`, `${N}/Plant_1.glb`],
  grass: [
    `${N}/CommonTree_1.glb`,
    `${N}/CommonTree_2.glb`,
    `${N}/Bush_Common.glb`,
    `${N}/Plant_1.glb`,
  ],
  forest: [
    `${N}/Pine_1.glb`,
    `${N}/Pine_2.glb`,
    `${N}/Pine_3.glb`,
    `${N}/Fern_1.glb`,
    `${N}/Bush_Common.glb`,
  ],
  rock: [`${N}/Rock_Medium_1.glb`, `${N}/Rock_Medium_2.glb`, `${N}/Rock_Medium_3.glb`],
  snow: [`${N}/Pine_4.glb`, `${N}/Pine_5.glb`, `${N}/Rock_Medium_1.glb`],
  lava: [`${N}/Rock_Medium_2.glb`, `${N}/Rock_Medium_3.glb`],
};

export function foliageKeysForBiomeIndex(biome: number): string[] {
  const name = ISLAND_BIOMES[biome];
  if (!name) return BIOME_FOLIAGE.grass;
  return BIOME_FOLIAGE[name] ?? [];
}

export function foliageKeysForKind(kind: SuperTerrainKind | string): string[] {
  if (kind === "spline-forest" || kind === "alpine-mesh") return BIOME_FOLIAGE.forest;
  if (kind === "frozen-fjord") return BIOME_FOLIAGE.snow;
  if (kind === "granite-csg" || kind === "tunnel-cavern") return BIOME_FOLIAGE.rock;
  if (kind === "volcanic-ridge") return [...BIOME_FOLIAGE.rock, ...BIOME_FOLIAGE.lava];
  return [...BIOME_FOLIAGE.grass, ...BIOME_FOLIAGE.shore];
}

/**
 * Super Terrain climate bands (`src/terrain/compiler/climate.ts`).
 * Fractions of summit / maxHeight — same order as the editor: montane,
 * treeline, alpine turf, fellfield, snow. Trees refuse above TREE_LINE
 * and on slopes steeper than ~40° (forest field law).
 */
export const SUPER_CLIMATE = {
  montaneTop: 0.3,
  treeLine: 0.54,
  alpineTurfTop: 0.74,
  fellfieldTop: 0.88,
  snowLine: 0.6,
  treeMaxSlopeDeg: 40,
} as const;

/**
 * Super Terrain paint channels (`materialSettings.ts`) — Grass / Rock / Soil / Snow.
 * Poly Haven 1K slugs are Forge's existing shader presets (not 15–85 MB Ground_N).
 * Ground_N ids stay in the catalog for explicit `set_material_map` — never autoload.
 */
const TEX = "https://assets.grudge-studio.com/textures/super-terrain";

export const SUPER_TERRAIN_CHANNELS = [
  { id: "channel0", name: "Grass", color: "#4f7d32", roughness: 0.94, polyhaven: "dirt", groundN: 2, albedo: `${TEX}/channel-grass.png` },
  { id: "channel1", name: "Rock", color: "#77736c", roughness: 0.82, polyhaven: "rock_wall", groundN: 4, albedo: `${TEX}/channel-rock.png` },
  { id: "channel2", name: "Soil", color: "#604733", roughness: 0.91, polyhaven: "dirt", groundN: 6, albedo: `${TEX}/channel-soil.png` },
  { id: "channel3", name: "Snow", color: "#dce4ee", roughness: 0.68, polyhaven: "rock_wall", groundN: 8, albedo: `${TEX}/channel-snow.png` },
] as const;

export const SUPER_TERRAIN_BAKE_BASE = "https://assets.grudge-studio.com/worlds/super-terrain";

/** Super Terrain procedural surface recipes (`textures/procedural/materials`). */
export const SUPER_PROCEDURAL_SURFACES = [
  "rock-ground",
  "cliff-side",
  "alpine-cliff-rock",
  "ember-fault-rock",
] as const;

export const GROUND_N_BASE = "https://assets.grudge-studio.com/textures/pbr/ground";

export function groundNUrl(id: number, map: "BaseColor" | "Normal" | "Roughness"): string {
  return `${GROUND_N_BASE}/Ground_${id}_${map}.png`;
}

const KIND_SURFACE: Record<
  SuperTerrainKind,
  { polyhaven: string; roughness: number; groundN: number; procedural: (typeof SUPER_PROCEDURAL_SURFACES)[number] }
> = {
  "harbor-atoll": { polyhaven: "sand_01", roughness: 0.94, groundN: 1, procedural: "rock-ground" },
  "volcanic-ridge": { polyhaven: "dirt", roughness: 0.9, groundN: 6, procedural: "ember-fault-rock" },
  "frozen-fjord": { polyhaven: "rock_wall", roughness: 0.78, groundN: 8, procedural: "alpine-cliff-rock" },
  "alpine-mesh": { polyhaven: "rock_wall", roughness: 0.82, groundN: 4, procedural: "alpine-cliff-rock" },
  "granite-csg": { polyhaven: "rock_wall", roughness: 0.84, groundN: 4, procedural: "cliff-side" },
  "spline-forest": { polyhaven: "dirt", roughness: 0.92, groundN: 6, procedural: "rock-ground" },
  "tunnel-cavern": { polyhaven: "rock_wall", roughness: 0.88, groundN: 4, procedural: "cliff-side" },
};

export function terrainMaterialForKind(
  kind: SuperTerrainKind | string,
  color: string,
): {
  color: string;
  metalness: number;
  roughness: number;
  shaderPreset: string;
  mapRepeat: [number, number];
} {
  const k: SuperTerrainKind = isSuperTerrainKind(String(kind))
    ? (kind as SuperTerrainKind)
    : "harbor-atoll";
  const s = KIND_SURFACE[k];
  return {
    color,
    metalness: 0.02,
    roughness: s.roughness,
    shaderPreset: s.polyhaven,
    mapUrl: `https://assets.grudge-studio.com/textures/super-terrain/kind-${k}.png`,
    // Heightfield UVs already tile at 8 m, so texture.repeat stays 1.
    mapRepeat: [1, 1],
  };
}

export function proceduralSurfaceForKind(kind: SuperTerrainKind | string): string {
  if (isSuperTerrainKind(String(kind))) return KIND_SURFACE[kind as SuperTerrainKind].procedural;
  return "rock-ground";
}

/** Super Terrain tree species → Kenney **single** meshes (no palm/baobab GLB on CDN). */
const SPECIES_MESH: Record<string, string[]> = {
  "ancient-oak": [`${N}/CommonTree_1.glb`, `${N}/CommonTree_2.glb`, `${N}/CommonTree_3.glb`],
  "field-oak": [`${N}/CommonTree_1.glb`, `${N}/CommonTree_2.glb`, `${N}/CommonTree_4.glb`],
  "european-beech": [`${N}/CommonTree_2.glb`, `${N}/CommonTree_3.glb`, `${N}/CommonTree_4.glb`],
  "silver-birch": [`${N}/CommonTree_1.glb`, `${N}/CommonTree_5.glb`],
  "windswept-pine": [`${N}/Pine_1.glb`, `${N}/Pine_2.glb`, `${N}/Pine_3.glb`],
  "norway-spruce": [`${N}/Pine_2.glb`, `${N}/Pine_3.glb`, `${N}/Pine_4.glb`],
  "coast-redwood": [`${N}/Pine_4.glb`, `${N}/Pine_5.glb`],
  "giant-sequoia": [`${N}/Pine_5.glb`],
  "tree-fern": [`${N}/Fern_1.glb`],
  "hazel-thicket": [`${N}/Bush_Common.glb`],
  "elder-bush": [`${N}/Bush_Common.glb`],
  "common-juniper": [`${N}/Bush_Common.glb`, `${N}/Pine_1.glb`],
  "kapok-ceiba": [`${N}/CommonTree_3.glb`, `${N}/CommonTree_4.glb`],
  "strangler-fig": [`${N}/CommonTree_2.glb`, `${N}/CommonTree_4.glb`],
  banyan: [`${N}/CommonTree_4.glb`, `${N}/CommonTree_5.glb`],
  "date-palm": [`${N}/Plant_1.glb`, `${N}/CommonTree_1.glb`],
  "coconut-palm": [`${N}/Plant_1.glb`, `${N}/CommonTree_2.glb`],
  "doum-palm": [`${N}/Plant_1.glb`, `${N}/Bush_Common.glb`],
  "umbrella-acacia": [`${N}/CommonTree_1.glb`, `${N}/CommonTree_2.glb`],
  baobab: [`${N}/CommonTree_5.glb`],
  "joshua-tree": [`${N}/CommonTree_1.glb`, `${N}/Bush_Common.glb`],
  "quiver-tree": [`${N}/CommonTree_2.glb`, `${N}/Bush_Common.glb`],
  "dragon-blood": [`${N}/CommonTree_3.glb`, `${N}/Rock_Medium_1.glb`],
};

export const SUPER_FOLIAGE_SPECIES = [
  "meadow-fescue",
  "tussock",
  "dry-steppe",
  "clover-mat",
  "broadleaf-weed",
  "woodland-fern",
  "wildflower",
  "sedge-reed",
  "forest-moss",
  "wood-rush",
  "bramble",
  "bracken",
] as const;

export type SuperFoliageSpeciesId = (typeof SUPER_FOLIAGE_SPECIES)[number];

/** Super Terrain ground-cover species → Kenney singles (not WebGPU blades). */
export const FOLIAGE_COVER_MESH: Record<SuperFoliageSpeciesId, string[]> = {
  "meadow-fescue": [`${N}/Plant_1.glb`],
  tussock: [`${N}/Plant_1.glb`, `${N}/Bush_Common.glb`],
  "dry-steppe": [`${N}/Plant_1.glb`],
  "clover-mat": [`${N}/Bush_Common.glb`],
  "broadleaf-weed": [`${N}/Bush_Common.glb`, `${N}/Plant_1.glb`],
  "woodland-fern": [`${N}/Fern_1.glb`],
  wildflower: [`${N}/Plant_1.glb`],
  "sedge-reed": [`${N}/Plant_1.glb`],
  "forest-moss": [`${N}/Bush_Common.glb`],
  "wood-rush": [`${N}/Plant_1.glb`, `${N}/Fern_1.glb`],
  bramble: [`${N}/Bush_Common.glb`],
  bracken: [`${N}/Fern_1.glb`],
};

export const COVER_FOR_BIOME: Record<(typeof ISLAND_BIOMES)[number], SuperFoliageSpeciesId[]> = {
  ocean: [],
  shore: ["sedge-reed", "wildflower"],
  sand: ["dry-steppe", "sedge-reed"],
  grass: ["meadow-fescue", "tussock", "wildflower", "clover-mat"],
  forest: ["woodland-fern", "forest-moss", "bramble", "bracken", "wood-rush"],
  rock: ["dry-steppe", "wood-rush"],
  snow: [],
  lava: [],
};

export const SUPER_FOREST_PRESETS = [
  "mossy-old-growth",
  "temperate-mixed",
  "ancient-oak-grove",
  "boreal-conifer",
  "primeval-redwood",
  "tropical-wet",
  "palm-oasis",
  "savanna",
  "arid-woodland",
] as const;

export type SuperForestPresetId = (typeof SUPER_FOREST_PRESETS)[number];

type ForestMixRow = { species: string; weight: number; scale: [number, number]; cover?: boolean };

export type SuperForestPreset = {
  id: SuperForestPresetId;
  label: string;
  treesPerHectare: number;
  gapRate: number;
  mix: readonly ForestMixRow[];
};

/** Super Terrain `FOREST_PRESETS` — Kenney stems, same mixes / densities. */
export const FOREST_PRESET_KITS: Record<SuperForestPresetId, SuperForestPreset> = {
  "mossy-old-growth": {
    id: "mossy-old-growth",
    label: "Mossy old-growth beech",
    treesPerHectare: 380,
    gapRate: 0.14,
    mix: [
      { species: "european-beech", weight: 64, scale: [0.7, 1.25] },
      { species: "field-oak", weight: 8, scale: [1.0, 1.3] },
      { species: "hazel-thicket", weight: 10, scale: [0.7, 1.05], cover: true },
      { species: "elder-bush", weight: 4, scale: [0.7, 1.0], cover: true },
      { species: "tree-fern", weight: 8, scale: [0.28, 0.5], cover: true },
    ],
  },
  "temperate-mixed": {
    id: "temperate-mixed",
    label: "Temperate mixed woodland",
    treesPerHectare: 125,
    gapRate: 0.12,
    mix: [
      { species: "field-oak", weight: 34, scale: [0.78, 1.16] },
      { species: "european-beech", weight: 28, scale: [0.78, 1.12] },
      { species: "silver-birch", weight: 24, scale: [0.72, 1.08] },
      { species: "norway-spruce", weight: 14, scale: [0.8, 1.1] },
      { species: "hazel-thicket", weight: 18, scale: [0.72, 1.12], cover: true },
    ],
  },
  "ancient-oak-grove": {
    id: "ancient-oak-grove",
    label: "Ancient oak grove",
    treesPerHectare: 52,
    gapRate: 0.28,
    mix: [
      { species: "ancient-oak", weight: 72, scale: [0.86, 1.18] },
      { species: "field-oak", weight: 28, scale: [0.68, 0.98] },
      { species: "hazel-thicket", weight: 22, scale: [0.78, 1.2], cover: true },
      { species: "common-juniper", weight: 14, scale: [0.8, 1.35], cover: true },
    ],
  },
  "boreal-conifer": {
    id: "boreal-conifer",
    label: "Boreal conifer forest",
    treesPerHectare: 178,
    gapRate: 0.08,
    mix: [
      { species: "norway-spruce", weight: 58, scale: [0.7, 1.14] },
      { species: "windswept-pine", weight: 28, scale: [0.76, 1.12] },
      { species: "silver-birch", weight: 14, scale: [0.68, 0.96] },
      { species: "common-juniper", weight: 20, scale: [0.75, 1.3], cover: true },
    ],
  },
  "primeval-redwood": {
    id: "primeval-redwood",
    label: "Primeval redwood forest",
    treesPerHectare: 72,
    gapRate: 0.16,
    mix: [
      { species: "coast-redwood", weight: 52, scale: [0.9, 1.35] },
      { species: "giant-sequoia", weight: 24, scale: [1.0, 1.45] },
      { species: "tree-fern", weight: 24, scale: [0.7, 1.18], cover: true },
    ],
  },
  "tropical-wet": {
    id: "tropical-wet",
    label: "Tropical wet forest",
    treesPerHectare: 112,
    gapRate: 0.1,
    mix: [
      { species: "kapok-ceiba", weight: 20, scale: [0.72, 1.1] },
      { species: "strangler-fig", weight: 26, scale: [0.72, 1.12] },
      { species: "banyan", weight: 24, scale: [0.72, 1.08] },
      { species: "tree-fern", weight: 30, scale: [0.68, 1.2], cover: true },
    ],
  },
  "palm-oasis": {
    id: "palm-oasis",
    label: "Palm oasis",
    treesPerHectare: 62,
    gapRate: 0.22,
    mix: [
      { species: "date-palm", weight: 54, scale: [0.76, 1.12] },
      { species: "coconut-palm", weight: 28, scale: [0.78, 1.14] },
      { species: "doum-palm", weight: 18, scale: [0.78, 1.08], cover: true },
    ],
  },
  savanna: {
    id: "savanna",
    label: "Open savanna",
    treesPerHectare: 26,
    gapRate: 0.36,
    mix: [
      { species: "umbrella-acacia", weight: 82, scale: [0.74, 1.16] },
      { species: "baobab", weight: 18, scale: [0.9, 1.3] },
    ],
  },
  "arid-woodland": {
    id: "arid-woodland",
    label: "Arid sculptural woodland",
    treesPerHectare: 44,
    gapRate: 0.3,
    mix: [
      { species: "joshua-tree", weight: 42, scale: [0.7, 1.16] },
      { species: "quiver-tree", weight: 34, scale: [0.72, 1.14] },
      { species: "dragon-blood", weight: 24, scale: [0.78, 1.08] },
    ],
  },
};

export const FOREST_PRESET_FOR_KIND: Record<SuperTerrainKind, SuperForestPresetId> = {
  "harbor-atoll": "tropical-wet",
  "volcanic-ridge": "arid-woodland",
  "frozen-fjord": "boreal-conifer",
  "alpine-mesh": "boreal-conifer",
  "granite-csg": "arid-woodland",
  "spline-forest": "mossy-old-growth",
  "tunnel-cavern": "arid-woodland",
};

export function forestPresetForKind(kind: SuperTerrainKind | string): SuperForestPreset {
  const id = isSuperTerrainKind(String(kind))
    ? FOREST_PRESET_FOR_KIND[kind as SuperTerrainKind]
    : "temperate-mixed";
  return FOREST_PRESET_KITS[id];
}

export function coverKeysForBiomeIndex(biome: number): string[] {
  const name = ISLAND_BIOMES[biome];
  if (!name) return COVER_FOR_BIOME.grass.flatMap((s) => FOLIAGE_COVER_MESH[s]);
  return (COVER_FOR_BIOME[name] ?? []).flatMap((s) => FOLIAGE_COVER_MESH[s]);
}

export function pickWeighted<T extends { weight: number }>(items: readonly T[], rng: () => number): T | undefined {
  if (!items.length) return undefined;
  const sum = items.reduce((s, i) => s + i.weight, 0);
  if (sum <= 0) return items[0];
  let t = rng() * sum;
  for (const i of items) {
    t -= i.weight;
    if (t <= 0) return i;
  }
  return items[items.length - 1];
}

export function pickForestStem(
  preset: SuperForestPreset,
  rng: () => number,
): { key: string; scale: number; cover: boolean } | null {
  const row = pickWeighted(preset.mix, rng);
  if (!row) return null;
  const keys = SPECIES_MESH[row.species];
  if (!keys?.length) return null;
  const key = keys[Math.floor(rng() * keys.length)]!;
  const scale = row.scale[0] + rng() * (row.scale[1] - row.scale[0]);
  return { key, scale, cover: !!row.cover };
}

export function forestStemKeys(preset: SuperForestPreset): string[] {
  const keys = new Set<string>();
  for (const row of preset.mix) {
    for (const k of SPECIES_MESH[row.species] ?? []) keys.add(k);
  }
  return [...keys];
}

export function sampleBiomeIndex(
  hf: Pick<HeightfieldComponent, "cols" | "rows" | "cellSize"> & { biomes?: number[] },
  x: number,
  z: number,
): number {
  if (!hf.biomes?.length) return 3;
  const extentX = Math.max(1, hf.cols - 1) * hf.cellSize;
  const extentZ = Math.max(1, hf.rows - 1) * hf.cellSize;
  const u = clamp01(x / extentX + 0.5);
  const v = clamp01(z / extentZ + 0.5);
  const ix = Math.min(hf.cols - 1, Math.max(0, Math.round(u * (hf.cols - 1))));
  const iz = Math.min(hf.rows - 1, Math.max(0, Math.round(v * (hf.rows - 1))));
  return hf.biomes[iz * hf.cols + ix] ?? 3;
}

type KindProfile = {
  title: string;
  seaLevel: number;
  maxHeight: number;
  ridge: number;
  lagoon: number;
  snowStart: number;
  warp: number;
  sectorId: string;
};

const PROFILES: Record<SuperTerrainKind, KindProfile> = {
  "harbor-atoll": {
    title: "Harbor Atoll",
    seaLevel: 0.2,
    maxHeight: 11,
    ridge: 0.35,
    lagoon: 0.55,
    snowStart: 1.2,
    warp: 0.35,
    sectorId: "haven_shore",
  },
  "volcanic-ridge": {
    title: "Volcanic Ridge",
    seaLevel: 0.16,
    maxHeight: 16,
    ridge: 0.85,
    lagoon: 0.12,
    snowStart: 0.78,
    warp: 0.55,
    sectorId: "ember_depths",
  },
  "frozen-fjord": {
    title: "Frozen Fjord",
    seaLevel: 0.18,
    maxHeight: 14,
    ridge: 0.62,
    lagoon: 0.2,
    snowStart: 0.58,
    warp: 0.42,
    sectorId: "frostbite_expanse",
  },
  "alpine-mesh": {
    title: "Alpine Mesh",
    seaLevel: 0.12,
    maxHeight: 16,
    ridge: 0.92,
    lagoon: 0.08,
    snowStart: 0.52,
    warp: 0.48,
    sectorId: "frostbite_expanse",
  },
  "granite-csg": {
    title: "Granite CSG",
    seaLevel: 0.1,
    maxHeight: 15,
    ridge: 0.78,
    lagoon: 0.05,
    snowStart: 0.94,
    warp: 0.62,
    sectorId: "ashen_wastes",
  },
  "spline-forest": {
    title: "Spline Forest",
    seaLevel: 0.14,
    maxHeight: 12,
    ridge: 0.28,
    lagoon: 0.18,
    snowStart: 1.1,
    warp: 0.4,
    sectorId: "thornwood_wilds",
  },
  "tunnel-cavern": {
    title: "Tunnel Cavern",
    seaLevel: 0.08,
    maxHeight: 14,
    ridge: 0.7,
    lagoon: 0,
    snowStart: 0.9,
    warp: 0.3,
    sectorId: "abyssal_trench",
  },
};

function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 19.19) * 43758.5453123;
  return n - Math.floor(n);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

function fbm(x: number, z: number, seed: number, octaves = 5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / (norm || 1);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function isSuperTerrainKind(id: string): id is SuperTerrainKind {
  return (SUPER_TERRAIN_KINDS as readonly string[]).includes(id);
}

export function profileForKind(kind: string): KindProfile {
  if (isSuperTerrainKind(kind)) return PROFILES[kind];
  return PROFILES["harbor-atoll"];
}

export type SuperTerrainBake = {
  kind: SuperTerrainKind;
  title: string;
  seed: number;
  sectorId: string;
  cols: number;
  rows: number;
  cellSize: number;
  maxHeight: number;
  seaLevel: number;
  heights: number[];
  biomes: number[];
  engine: string;
};

type FleetCatalog = {
  format?: string;
  hosts?: Record<string, string>;
  scatter?: { trees?: string[]; pines?: string[]; rocks?: string[]; deny?: string[] };
  kinds?: Array<{ id: string; bake?: string; albedo?: string; title?: string }>;
  climate?: Record<string, number>;
  channels?: Array<{ albedo?: string }>;
};

let catalogCache: FleetCatalog | null = null;
let catalogPromise: Promise<FleetCatalog | null> | null = null;

export async function fetchSuperTerrainCatalog(): Promise<FleetCatalog | null> {
  if (catalogCache) return catalogCache;
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    for (const url of [
      SUPER_TERRAIN_CATALOG_URLS.info,
      SUPER_TERRAIN_CATALOG_URLS.objectstore,
      SUPER_TERRAIN_CATALOG_URLS.cdn,
    ]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = (await res.json()) as FleetCatalog;
        if (json && (json.format?.includes("super-terrain") || json.kinds?.length)) {
          catalogCache = json;
          return json;
        }
      } catch {
        /* try next host */
      }
    }
    return null;
  })();
  const got = await catalogPromise;
  catalogPromise = null;
  return got;
}

/** Parse `grudge-island-bake/v1` from assets…/worlds/super-terrain/{kind}.json */
export function parseFleetBake(
  raw: Record<string, unknown>,
  kind: SuperTerrainKind,
  worldMeters?: number,
): SuperTerrainBake | null {
  const heights = Array.isArray(raw.heights) ? (raw.heights as number[]) : [];
  if (heights.length < 16) return null;
  const grid = Math.round(Math.sqrt(heights.length));
  if (grid * grid !== heights.length) return null;
  const maxRaw = heights.reduce((m, h) => (h > m ? h : m), 0);
  const norm = maxRaw > 1.5 ? 255 : 1;
  const profile = PROFILES[kind];
  const bakedMeters = typeof raw.size === "number" ? Number(raw.cellSize) * (grid - 1) : 0;
  const want = Math.max(24, worldMeters ?? bakedMeters ?? 80);
  const cellSize =
    typeof raw.cellSize === "number" && bakedMeters > 0
      ? want / (grid - 1)
      : want / (grid - 1);
  const biomes = Array.isArray(raw.biomes)
    ? (raw.biomes as number[]).map((b) => Math.max(0, Math.min(7, Math.round(Number(b) || 0))))
    : heights.map(() => 3);
  return {
    kind,
    title: typeof raw.title === "string" ? raw.title : profile.title,
    seed: typeof raw.seed === "number" ? raw.seed : 0,
    sectorId: profile.sectorId,
    cols: grid,
    rows: grid,
    cellSize,
    maxHeight: typeof raw.maxHeight === "number" ? Number(raw.maxHeight) : profile.maxHeight,
    seaLevel: typeof raw.seaLevel === "number" ? Number(raw.seaLevel) : profile.seaLevel,
    heights: heights.map((h) => Math.max(0, Math.min(1, Number(h) / norm))),
    biomes: biomes.length === heights.length ? biomes : heights.map(() => 3),
    engine: typeof raw.engine === "string" ? String(raw.engine) : "super-terrain (fleet CDN bake)",
  };
}

export async function fetchSuperTerrainBake(
  kind: SuperTerrainKind | string,
  worldMeters: number,
): Promise<SuperTerrainBake | null> {
  const k: SuperTerrainKind = isSuperTerrainKind(String(kind)) ? (kind as SuperTerrainKind) : "harbor-atoll";
  const cat = await fetchSuperTerrainCatalog();
  const listed = cat?.kinds?.find((x) => x.id === k)?.bake;
  const url = listed || `${SUPER_TERRAIN_BAKE_BASE}/${k}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    return parseFleetBake(json, k, worldMeters);
  } catch {
    return null;
  }
}

export function generateSuperTerrain(opts: {
  kind: SuperTerrainKind | string;
  worldMeters: number;
  seed: number;
  grid?: number;
}): SuperTerrainBake {
  const kind: SuperTerrainKind = isSuperTerrainKind(String(opts.kind))
    ? (opts.kind as SuperTerrainKind)
    : "harbor-atoll";
  const profile = PROFILES[kind];
  const worldMeters = Math.max(24, opts.worldMeters);
  const grid = Math.max(24, Math.min(64, opts.grid ?? Math.round(worldMeters / 2) + 1));
  const cellSize = worldMeters / Math.max(1, grid - 1);
  const seed = opts.seed;
  const heights: number[] = [];
  const biomes: number[] = [];

  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const nx = ix / Math.max(1, grid - 1);
      const nz = iz / Math.max(1, grid - 1);
      const cx = nx * 2 - 1;
      const cz = nz * 2 - 1;
      const warpX = fbm(nx * 3, nz * 3, seed + 3, 3) * profile.warp;
      const warpZ = fbm(nx * 3 + 8, nz * 3, seed + 9, 3) * profile.warp;
      const px = cx + (warpX - 0.5 * profile.warp);
      const pz = cz + (warpZ - 0.5 * profile.warp);
      const r = Math.sqrt(px * px + pz * pz);
      const radial = clamp01(1 - Math.pow(Math.min(1.15, r) / 0.92, 2.15));
      const n = fbm(nx * 4.2, nz * 4.2, seed, 5);
      const ridgeNoise = Math.abs(fbm(nx * 2.4, nz * 2.4, seed + 21, 4) * 2 - 1);
      const ridge =
        Math.pow(1 - Math.min(1, Math.abs(px * 0.35 + pz)), 2) * profile.ridge * ridgeNoise;
      let lagoon = 0;
      if (profile.lagoon > 0) {
        const ring = 1 - Math.abs(r - 0.38) * 3.4;
        lagoon = clamp01(ring) * profile.lagoon * (1 - n * 0.35);
      }
      let h = radial * (0.28 + n * 0.72) + ridge * 0.55 - lagoon * 0.28;
      if (kind === "frozen-fjord") {
        const inlet = clamp01(1 - Math.abs(px) * 2.8) * clamp01(pz + 0.15);
        h -= inlet * 0.42;
      }
      if (kind === "alpine-mesh") {
        const valley = clamp01(1 - Math.abs(px) * 2.2) * clamp01(pz + 0.35);
        h = h * 0.7 + ridgeNoise * 0.45 - valley * 0.38;
      }
      if (kind === "granite-csg") {
        const blocks = Math.abs(fbm(nx * 8, nz * 8, seed + 41, 2) * 2 - 1);
        h = clamp01(h * 0.55 + ridge * 0.5 + blocks * 0.35);
      }
      if (kind === "spline-forest") {
        const stands = fbm(nx * 5.5, nz * 5.5, seed + 13, 4);
        h = radial * (0.34 + stands * 0.5) + ridge * 0.18;
      }
      if (kind === "tunnel-cavern") {
        const mouth = clamp01(1 - r / 0.28);
        const rim = clamp01(1 - Math.abs(r - 0.38) * 4);
        h = rim * 0.72 + ridge * 0.25 + n * 0.12 - mouth * 0.55;
      }
      h = clamp01(h * (kind === "tunnel-cavern" ? 1 : radial));
      heights.push(h);
      const t = h;
      let biome = 3;
      if (t < profile.seaLevel) biome = 0;
      else if (t < profile.seaLevel + 0.035) biome = 1;
      else if (t < profile.seaLevel + 0.09) biome = 2;
      else if (t < 0.42) biome = 3;
      else if (t < 0.68) biome = 4;
      else if (t < profile.snowStart) biome = 5;
      else biome = 6;
      if (kind === "volcanic-ridge" && t > 0.72 && ridgeNoise > 0.55) biome = 7;
      if (kind === "granite-csg") {
        if (t < profile.seaLevel) biome = 0;
        else if (t < 0.22) biome = 2;
        else biome = t > 0.84 ? 6 : 5;
      }
      if (kind === "spline-forest" && t >= profile.seaLevel + 0.09 && t < 0.78) biome = 4;
      if (kind === "tunnel-cavern" && r < 0.32) biome = 5;
      if (kind === "alpine-mesh" && t > profile.snowStart) biome = 6;
      biomes.push(biome);
    }
  }

  return {
    kind,
    title: profile.title,
    seed,
    sectorId: profile.sectorId,
    cols: grid,
    rows: grid,
    cellSize,
    maxHeight: profile.maxHeight,
    seaLevel: profile.seaLevel,
    heights,
    biomes,
    engine:
      kind === "alpine-mesh" ||
      kind === "granite-csg" ||
      kind === "spline-forest" ||
      kind === "tunnel-cavern"
        ? "super-terrain (generated bake)"
        : "Island-Terrain-World-Engine (generated)",
  };
}

export function toHeightfieldComponent(bake: SuperTerrainBake): HeightfieldComponent {
  return {
    cols: bake.cols,
    rows: bake.rows,
    heights: bake.heights,
    cellSize: bake.cellSize,
    maxHeight: bake.maxHeight,
    seaLevel: bake.seaLevel,
    biomes: bake.biomes,
  };
}

export function sampleHeightfieldY(
  hf: Pick<HeightfieldComponent, "cols" | "rows" | "heights" | "cellSize" | "maxHeight">,
  x: number,
  z: number,
): number {
  const extentX = Math.max(1, hf.cols - 1) * hf.cellSize;
  const extentZ = Math.max(1, hf.rows - 1) * hf.cellSize;
  const u = clamp01(x / extentX + 0.5);
  const v = clamp01(z / extentZ + 0.5);
  const fx = u * (hf.cols - 1);
  const fz = v * (hf.rows - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(hf.cols - 1, x0 + 1);
  const z1 = Math.min(hf.rows - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const h00 = hf.heights[z0 * hf.cols + x0] ?? 0;
  const h10 = hf.heights[z0 * hf.cols + x1] ?? 0;
  const h01 = hf.heights[z1 * hf.cols + x0] ?? 0;
  const h11 = hf.heights[z1 * hf.cols + x1] ?? 0;
  const h = lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  return h * hf.maxHeight;
}

/** Slope in degrees from the same heightfield the stems stand on. Super Terrain refuses trees above ~40°. */
export function sampleSlopeDeg(
  hf: Pick<HeightfieldComponent, "cols" | "rows" | "heights" | "cellSize" | "maxHeight">,
  x: number,
  z: number,
): number {
  const d = Math.max(0.5, hf.cellSize);
  const yL = sampleHeightfieldY(hf, x - d, z);
  const yR = sampleHeightfieldY(hf, x + d, z);
  const yD = sampleHeightfieldY(hf, x, z - d);
  const yU = sampleHeightfieldY(hf, x, z + d);
  const gx = (yR - yL) / (2 * d);
  const gz = (yU - yD) / (2 * d);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}

export function rockBudgetForKind(kind: SuperTerrainKind | string, density: number): number {
  if (kind === "granite-csg" || kind === "tunnel-cavern") return Math.round(12 + density * 10);
  if (kind === "volcanic-ridge" || kind === "alpine-mesh") return Math.round(8 + density * 8);
  if (kind === "spline-forest") return Math.round(5 + density * 5);
  return Math.round(4 + density * 6);
}

export function isLandBiome(biome: number, seaLevel: number, height01: number): boolean {
  if (height01 < seaLevel + 0.04) return false;
  return biome !== 0 && biome !== 7;
}

export function dominantGroundColor(bake: SuperTerrainBake): string {
  const counts = new Array(ISLAND_BIOMES.length).fill(0);
  for (const b of bake.biomes) counts[b] = (counts[b] ?? 0) + 1;
  let best = 3;
  let n = 0;
  counts.forEach((c, i) => {
    if (c > n && i !== 0) {
      n = c;
      best = i;
    }
  });
  return BIOME_GROUND[ISLAND_BIOMES[best] ?? "grass"] ?? "#3d6b2e";
}
