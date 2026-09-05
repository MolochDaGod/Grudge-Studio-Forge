/**
 * World biome kits for Forge agentic creation.
 *
 * Recipes come from Island Terrain World Engine (showcase/island/wild/flat)
 * + Forge WORLD_SECTORS. Do not import WorldTerrain — scatter CDN nature
 * packs, sector assets, and atmosphere. Paint channels = foliage/harvest/rock/structure.
 */

import {
  WORLD_SECTORS,
  BIOME_LABELS,
  getSectorById,
  type ForgeSector,
  type SectorBiome,
} from "@/lib/worldSectors";
import { SECTOR_ASSETS, type BiomeAssets } from "@/lib/sectorAssets";

export const CDN = "https://assets.grudge-studio.com";

export const NATURE_CDN = {
  vegetation: `${CDN}/models/nature/stylized/biome/nature_vegetation.glb`,
  oreNodes: `${CDN}/models/nature/stylized/harvest/ore_nodes.glb`,
  pirateIslands: `${CDN}/models/lobby/pirate-islands/scene.glb`,
} as const;

/** Whole-file packs — spawn once as a MAP/shell, never as one tree/rock instance. */
export const NATURE_PACK_DENY = [
  NATURE_CDN.vegetation,
  NATURE_CDN.pirateIslands,
  "nature-tree-pack",
  "nature-tropical-pack",
  "nature-autumn-trees",
  "builtin:nature-tree-pack",
  "builtin:nature-tropical-pack",
  "builtin:nature-autumn-trees",
  "builtin:map-pirate-islands-scene",
];

/** One mesh per file (Kenney nature on CDN). Scatter these, not packs. */
export const NATURE_SINGLES = {
  trees: [1, 2, 3, 4, 5].map((n) => `${CDN}/models/nature/CommonTree_${n}.glb`),
  pines: [1, 2, 3, 4, 5].map((n) => `${CDN}/models/nature/Pine_${n}.glb`),
  rocks: [1, 2, 3].map((n) => `${CDN}/models/nature/Rock_Medium_${n}.glb`),
  bush: `${CDN}/models/nature/Bush_Common.glb`,
  fern: `${CDN}/models/nature/Fern_1.glb`,
  plant: `${CDN}/models/nature/Plant_1.glb`,
} as const;

export function isNaturePackKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    NATURE_PACK_DENY.some((p) => k === p.toLowerCase() || k.endsWith(p.toLowerCase())) ||
    k.includes("-pack") ||
    k.includes("vegetation.glb") ||
    k.includes("pirate-islands/scene")
  );
}

export function scatterFoliageKeys(): string[] {
  return [...NATURE_SINGLES.trees, ...NATURE_SINGLES.pines, NATURE_SINGLES.bush, NATURE_SINGLES.fern, NATURE_SINGLES.plant];
}

export function scatterRockKeys(): string[] {
  return [...NATURE_SINGLES.rocks];
}

export type WorldRecipeId =
  | "showcase"
  | "island"
  | "wild"
  | "flat"
  | "harbor-atoll"
  | "volcanic-ridge"
  | "frozen-fjord"
  | "alpine-mesh"
  | "granite-csg"
  | "spline-forest"
  | "tunnel-cavern";
export type PaintChannel = "foliage" | "harvest" | "rock" | "structure" | "path";
export const WORLD_LAYERS = [
  "map",
  "terrain",
  "foliage",
  "rock",
  "path",
  "harvest",
  "structure",
] as const;
export type WorldLayer = (typeof WORLD_LAYERS)[number];

export interface WorldRecipeKit {
  id: WorldRecipeId;
  label: string;
  description: string;
  defaultSectorId: string;
  water: boolean;
  rocks: number;
  coral: number;
  outcrops: boolean;
  source: "island-engine" | "super-terrain";
  terrainKind?: string;
}

/** Island Terrain World Engine recipes — values only, not the compiler. */
export const WORLD_RECIPES: WorldRecipeKit[] = [
  {
    id: "showcase",
    label: "Ashfall Atoll",
    description: "Volcanic spine, reef shelf, flooded low ground (authored study).",
    defaultSectorId: "ember_depths",
    water: true,
    rocks: 8,
    coral: 0.4,
    outcrops: true,
    source: "island-engine",
    terrainKind: "volcanic-ridge",
  },
  {
    id: "island",
    label: "Volcanic island",
    description: "Seeded island + reef shelf + harvest nodes.",
    defaultSectorId: "haven_shore",
    water: true,
    rocks: 14,
    coral: 0.82,
    outcrops: false,
    source: "island-engine",
    terrainKind: "harbor-atoll",
  },
  {
    id: "wild",
    label: "Uncharted island",
    description: "Same generators, new seed — ridges and scatter shift.",
    defaultSectorId: "thornwood_wilds",
    water: true,
    rocks: 10,
    coral: 0,
    outcrops: true,
    source: "super-terrain",
    terrainKind: "spline-forest",
  },
  {
    id: "flat",
    label: "Clean shelf",
    description: "Near-level ground for paintbrush scatter.",
    defaultSectorId: "haven_shore",
    water: false,
    rocks: 6,
    coral: 0,
    outcrops: false,
    source: "island-engine",
  },
  {
    id: "harbor-atoll",
    label: "Harbor Atoll",
    description: "Tropical lagoon, beaches, low green ridge (Island Terrain bake).",
    defaultSectorId: "haven_shore",
    water: true,
    rocks: 8,
    coral: 0.5,
    outcrops: false,
    source: "island-engine",
    terrainKind: "harbor-atoll",
  },
  {
    id: "alpine-mesh",
    label: "Alpine Mesh",
    description: "Super Terrain alpine: high relief, valley floor, snow terraces.",
    defaultSectorId: "frostbite_expanse",
    water: true,
    rocks: 10,
    coral: 0,
    outcrops: true,
    source: "super-terrain",
    terrainKind: "alpine-mesh",
  },
  {
    id: "granite-csg",
    label: "Granite CSG",
    description: "Super Terrain granite lab — steep CSG outcrops.",
    defaultSectorId: "ashen_wastes",
    water: false,
    rocks: 16,
    coral: 0,
    outcrops: true,
    source: "super-terrain",
    terrainKind: "granite-csg",
  },
  {
    id: "spline-forest",
    label: "Spline Forest",
    description: "Super Terrain forest splines, needle duff into hillside.",
    defaultSectorId: "thornwood_wilds",
    water: true,
    rocks: 8,
    coral: 0,
    outcrops: false,
    source: "super-terrain",
    terrainKind: "spline-forest",
  },
  {
    id: "volcanic-ridge",
    label: "Volcanic Ridge",
    description: "Steep basalt spine and lava rock lookout.",
    defaultSectorId: "ember_depths",
    water: true,
    rocks: 12,
    coral: 0,
    outcrops: true,
    source: "island-engine",
    terrainKind: "volcanic-ridge",
  },
  {
    id: "frozen-fjord",
    label: "Frozen Fjord",
    description: "Deep inlet, snow terraces, ice-cut landing.",
    defaultSectorId: "frostbite_expanse",
    water: true,
    rocks: 9,
    coral: 0,
    outcrops: true,
    source: "island-engine",
    terrainKind: "frozen-fjord",
  },
  {
    id: "tunnel-cavern",
    label: "Tunnel Cavern",
    description: "Super Terrain cave mouth flattened to a playable heightfield.",
    defaultSectorId: "abyssal_trench",
    water: false,
    rocks: 14,
    coral: 0,
    outcrops: true,
    source: "super-terrain",
    terrainKind: "tunnel-cavern",
  },
];

export function getWorldRecipe(id?: string): WorldRecipeKit | undefined {
  if (!id) return undefined;
  return WORLD_RECIPES.find((r) => r.id === id);
}

export function getSectorForBiome(biome: SectorBiome): ForgeSector | undefined {
  return WORLD_SECTORS.find((s) => s.biome === biome);
}

export function resolveWorldSector(opts: {
  sectorId?: string;
  biome?: string;
  recipe?: string;
}): ForgeSector | undefined {
  if (opts.sectorId) return getSectorById(opts.sectorId);
  if (opts.biome) {
    const b = opts.biome as SectorBiome;
    return getSectorForBiome(b);
  }
  if (opts.recipe) {
    const rec = WORLD_RECIPES.find((r) => r.id === opts.recipe);
    if (rec) return getSectorById(rec.defaultSectorId);
  }
  return undefined;
}

export function paintKeys(assets: BiomeAssets, channel: PaintChannel): string[] {
  switch (channel) {
    case "foliage":
      return scatterFoliageKeys().filter((k) => !isNaturePackKey(k));
    case "harvest":
      return [...assets.harvestables.filter((k) => !isNaturePackKey(k))];
    case "rock":
      return scatterRockKeys();
    case "structure":
      return assets.structures;
    case "path":
      return assets.props.length ? assets.props : [];
    default:
      return [];
  }
}

function keepPlayer(e: { controllerKind?: string | null; behavior?: string; type?: string }): boolean {
  if (e.controllerKind && e.controllerKind !== "none") return true;
  if (typeof e.behavior === "string" && e.behavior.startsWith("player-")) return true;
  if (e.type === "camera") return true;
  return false;
}

/** Classify generated / painted world dressing. Never tags the player. */
export function classifyWorldDressing(e: {
  name?: string;
  layer?: string | null;
  heightfield?: unknown;
  controllerKind?: string | null;
  behavior?: string;
  type?: string;
}): WorldLayer | null {
  if (keepPlayer(e)) return null;
  const n = (e.name || "").toLowerCase();
  if (n.startsWith("generated")) return "map";
  if (n.startsWith("path") || n.startsWith("paint path") || n.includes("trail") || n.includes("road")) return "path";
  if (e.heightfield || n === "terrain" || n.includes("landscape") || n === "ground") return "terrain";
  if (e.layer === "Terrain" && !n.startsWith("path")) return "terrain";
  if (n.startsWith("foliage") || n.includes("tree") || n.startsWith("paint foliage")) return "foliage";
  if (n.startsWith("rock") || n.startsWith("paint rock")) return "rock";
  if (n.startsWith("resource") || n.startsWith("paint harvest") || n.includes("harvest")) return "harvest";
  if (n.startsWith("structure") || n.startsWith("paint structure")) return "structure";
  return null;
}

export function collectWorldDressingIds(
  entities: Array<{
    id: string;
    name?: string;
    parentId?: string | null;
    layer?: string | null;
    heightfield?: unknown;
    controllerKind?: string | null;
    behavior?: string;
    type?: string;
  }>,
  layers?: WorldLayer[],
): string[] {
  const want = new Set(layers && layers.length ? layers : (["map", ...WORLD_LAYERS] as WorldLayer[]));
  const ids = new Set<string>();
  const addTree = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const e of entities) if (e.parentId === id) addTree(e.id);
  };
  for (const e of entities) {
    if (keepPlayer(e)) continue;
    const layer = classifyWorldDressing(e);
    if (!layer) continue;
    if (want.has("map") && (layer === "map" || (e.name || "").startsWith("Generated"))) {
      addTree(e.id);
      continue;
    }
    if (want.has(layer)) ids.add(e.id);
  }
  return [...ids];
}

export function filterGeneratedByLayers(
  entities: Array<{ id: string; name?: string; parentId?: string | null; heightfield?: unknown; layer?: string | null; type?: string }>,
  layers?: WorldLayer[],
): typeof entities {
  if (!layers?.length || layers.includes("map")) return entities;
  const root = entities[0];
  if (!root) return entities;
  const keep = [root];
  for (const e of entities.slice(1)) {
    const c = classifyWorldDressing(e);
    if (c && layers.includes(c)) keep.push(e);
  }
  return keep;
}

export function worldBiomeSnapshot() {
  return {
    schemaVersion: 1,
    source: "Forge WORLD_SECTORS + Super Terrain / Island Terrain bakes (no WorldTerrain compiler)",
    recipes: WORLD_RECIPES,
    biomes: Object.entries(BIOME_LABELS).map(([id, label]) => ({
      id,
      label,
      sector: WORLD_SECTORS.find((s) => s.biome === id)?.id,
      assets: SECTOR_ASSETS[id as SectorBiome]
        ? {
            foliage: SECTOR_ASSETS[id as SectorBiome].foliage,
            harvest: SECTOR_ASSETS[id as SectorBiome].harvestables,
            light: SECTOR_ASSETS[id as SectorBiome].lightColor,
          }
        : null,
    })),
    sectors: WORLD_SECTORS.map((s) => ({
      id: s.id,
      name: s.name,
      biome: s.biome,
      difficulty: [s.difficultyMin, s.difficultyMax],
    })),
    cdn: NATURE_CDN,
    paintChannels: ["foliage", "harvest", "rock", "structure", "path"],
    replaceLayers: WORLD_LAYERS,
    tools: [
      "list_world_biomes",
      "create_world({ recipe:'alpine-mesh'|island|… })",
      "generate_map({ kind:'openWorld', sectorId, terrainKind, size, density })",
      "apply_biome_look({ sectorId })",
      "paint_world_brush({ channel, center, radius, density })",
    ],
    law: [
      "Do not import Island Terrain WorldTerrain into Forge.",
      "Do not vendor the Super Terrain WebGPU editor — heightfield bake only.",
      "Ground = Terrain layer + Walk surface (heightfield when recipe.terrainKind). Same height for feet.",
      "Foliage/rocks = one Kenney mesh per instance (CommonTree_N, Pine_N, Rock_Medium_N). Never scatter nature_vegetation.glb or *-pack as one tree.",
      "pirate-islands/scene.glb = lobby MAP shell only — terrain/shovel/harvest upgrade that mesh, do not instance it as a rock.",
      "Chicken Gun maps (mistytown, …) = map plates. Physics = Rapier Terrain/Walk + Water/Swim.",
      "This repo is Forge editor (forge.grudge-studio.com). Warlords play is GrudgeBuilder / grudgewarlords.com.",
      "Ocean is Environment.ocean caribbean Gerstner — not a cyan clay plane.",
      "Torches: warm point lights decay 2, intensity ≤ 2.2 — not white bloom.",
      "Complete world = look + heightfield + Gerstner ocean + foliage + harvest + spawn + verify_scene_full.",
    ],
  };
}
