/**
 * Agentic world creation — biomes, paintbrush scatter, sector look.
 * Extends generate_map / sectorAssets; does not import Island Terrain WorldTerrain.
 */
import { useEditor } from "@/store/editor";
import { addEntitiesCommand, replaceEntitiesCommand, type StoreLike } from "@/lib/commands";
import { generateMap, mulberry32 } from "@/lib/mapGen";
import { SECTOR_ASSETS } from "@/lib/sectorAssets";
import {
  NATURE_CDN,
  collectWorldDressingIds,
  filterGeneratedByLayers,
  getWorldRecipe,
  paintKeys,
  resolveWorldSector,
  worldBiomeSnapshot,
  type PaintChannel,
  type WorldLayer,
} from "@/lib/worldBiomeKit";
import {
  SUPER_TERRAIN_CATALOG_URLS,
  coverKeysForBiomeIndex,
  fetchSuperTerrainBake,
  fetchSuperTerrainCatalog,
  foliageKeysForBiomeIndex,
  isSuperTerrainKind,
  sampleBiomeIndex,
  sampleHeightfieldY,
} from "@/lib/superTerrainWorld";
import type { SceneEntity } from "@/scene/types";
import { nanoid } from "nanoid";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

export function commitGeneratedWorld(
  entities: SceneEntity[],
  label: string,
  opts: { replace?: boolean; layers?: WorldLayer[] },
): { added: number; removed: number } {
  const store = storeLike();
  const add = filterGeneratedByLayers(entities, opts.layers) as SceneEntity[];
  const replace = opts.replace !== false;
  if (replace) {
    const removeIds = collectWorldDressingIds(store.getEntities(), opts.layers);
    useEditor.getState().commandStack.push(
      replaceEntitiesCommand(store, removeIds, add, label, add[0]?.id ?? null),
    );
    return { added: add.length, removed: removeIds.length };
  }
  useEditor.getState().commandStack.push(addEntitiesCommand(store, add, label, add[0]?.id ?? null));
  return { added: add.length, removed: 0 };
}

function storeLike(): StoreLike {
  return {
    getEntities: () => useEditor.getState().sceneData.entities,
    setEntities: (next) => useEditor.getState().setEntities(next),
    selectEntity: (id) => useEditor.getState().selectEntity(id),
  };
}

const LIST: ToolDef = {
  name: "list_world_biomes",
  description:
    "Forge world kits: 9 Warlords sectors, Super Terrain kinds (harbor-atoll, alpine-mesh, granite-csg, spline-forest, tunnel-cavern, volcanic-ridge, frozen-fjord), " +
    "forest presets (mossy-old-growth, boreal-conifer, tropical-wet, …), foliage species, Grass/Rock/Soil/Snow channels, Poly Haven 1K (not 20MB Ground_N). " +
    "Catalog: https://info.grudge-studio.com/api/v1/super-terrain.json (proxy objectstore, CDN catalogs/super-terrain.json). " +
    "Heightfield bake only — not the WebGPU editor. Then generate_map openWorld + paint_world_brush.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const listHandler: ToolHandler = async () => {
  const fleet = await fetchSuperTerrainCatalog();
  return {
    ok: true,
    data: {
      ...worldBiomeSnapshot(),
      fleetCatalog: fleet,
      catalogUrl: SUPER_TERRAIN_CATALOG_URLS.info,
    },
  };
};

const APPLY: ToolDef = {
  name: "apply_biome_look",
  description:
    "Apply a sector/biome sky, fog, sun, ground color to the scene Environment (CommandStack). " +
    "Pass sectorId (haven_shore, thornwood_wilds, …) or biome (tropical|forest|frozen|volcanic|desert|storm|ethereal|abyssal|nexus) or recipe (island|showcase|wild|flat).",
  input_schema: {
    type: "object",
    properties: {
      sectorId: { type: "string" },
      biome: { type: "string" },
      recipe: { type: "string" },
    },
    additionalProperties: false,
  },
};

const applyHandler: ToolHandler = async (input) => {
  const sector = resolveWorldSector({
    sectorId: typeof input.sectorId === "string" ? input.sectorId : undefined,
    biome: typeof input.biome === "string" ? input.biome : undefined,
    recipe: typeof input.recipe === "string" ? input.recipe : undefined,
  });
  if (!sector) return { ok: false, error: "Unknown sector/biome/recipe. Call list_world_biomes." };
  useEditor.getState().cmdSetEnvironment(sector.forgeEnv, `Biome look · ${sector.name}`);
  // ocean already in forgeEnv for coastal sectors
  return {
    ok: true,
    data: { sectorId: sector.id, biome: sector.biome, env: sector.forgeEnv },
  };
};

const PAINT: ToolDef = {
  name: "paint_world_brush",
  description:
    "Paintbrush scatter in a radius: foliage, harvest, rock, structure, or path from the biome kit + CDN nature packs. " +
    "Snaps to Super Terrain heightfield. replace=true restamps that channel in the radius. Pair with create_world.",
  input_schema: {
    type: "object",
    properties: {
      channel: { type: "string", enum: ["foliage", "harvest", "rock", "structure", "path"] },
      replace: { type: "boolean", description: "If true, restamp this channel in the radius (default false)." },
      center: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      radius: { type: "number" },
      density: { type: "number" },
      seed: { type: "number" },
      sectorId: { type: "string" },
      biome: { type: "string" },
    },
    required: ["channel", "center"],
    additionalProperties: false,
  },
};

const paintHandler: ToolHandler = async (input) => {
  const channel = String(input.channel || "foliage") as PaintChannel;
  const center = input.center as number[];
  const radius = typeof input.radius === "number" ? Math.max(2, input.radius) : 12;
  const density = typeof input.density === "number" ? Math.min(1, Math.max(0.05, input.density)) : 0.45;
  const seed = typeof input.seed === "number" ? input.seed : Date.now() & 0xffff;
  const sector = resolveWorldSector({
    sectorId: typeof input.sectorId === "string" ? input.sectorId : undefined,
    biome: typeof input.biome === "string" ? input.biome : undefined,
  });
  const biome = sector?.biome ?? "tropical";
  const assets = SECTOR_ASSETS[biome];
  const keys = paintKeys(assets, channel).filter(Boolean);
  if (!keys.length && channel !== "path" && channel !== "rock") {
    return { ok: false, error: `No ${channel} keys for biome ${biome}.` };
  }

  const replace = input.replace !== false && input.replace === true;
  const rng = mulberry32(seed);
  const count = Math.max(1, Math.round((radius * radius * density) / 8));
  const sceneEnts = useEditor.getState().sceneData.entities;
  const ground = sceneEnts.find((e) => e.heightfield);
  const r2 = radius * radius;
  const removeIds = replace
    ? sceneEnts
        .filter((e) => {
          const n = (e.name || "").toLowerCase();
          const hit =
            channel === "path"
              ? n.startsWith("path") || n.startsWith("paint path")
              : n.startsWith(channel) || n.startsWith(`paint ${channel}`) || (channel === "foliage" && n.includes("tree")) || (channel === "rock" && n.startsWith("rock"));
          if (!hit) return false;
          const dx = (e.transform.position[0] ?? 0) - (center[0] ?? 0);
          const dz = (e.transform.position[2] ?? 0) - (center[2] ?? 0);
          return dx * dx + dz * dz <= r2;
        })
        .map((e) => e.id)
    : [];
  const ents: SceneEntity[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = (center[0] ?? 0) + Math.cos(a) * r;
    const z = (center[2] ?? 0) + Math.sin(a) * r;
    const y = ground?.heightfield
      ? sampleHeightfieldY(ground.heightfield, x, z)
      : (center[1] ?? 0);
    if (channel === "path" || (channel === "rock" && keys.length === 0)) {
      ents.push({
        id: nanoid(8),
        name: channel === "path" ? `Path ${i + 1}` : `Rock ${i + 1}`,
        type: "box",
        parentId: null,
        transform: {
          position: [x, y + (channel === "path" ? 0.04 : 0.4), z],
          rotation: [0, rng() * Math.PI * 2, 0],
          scale: channel === "path" ? [1.8, 0.08, 2.4] : [1.2 + rng(), 0.7, 1.2 + rng()],
        },
        material: { color: channel === "path" ? "#6b5344" : "#5a544c", metalness: 0, roughness: 1 },
        physics: { bodyType: "fixed", colliderType: "cuboid" },
        layer: channel === "path" ? "Terrain" : "Default",
        surface: channel === "path" ? "Walk" : undefined,
      });
      continue;
    }
    let pool = keys;
    if (ground?.heightfield && (channel === "foliage" || channel === "rock")) {
      const bi = sampleBiomeIndex(ground.heightfield, x, z);
      if (channel === "foliage") {
        const biomeKeys = [...foliageKeysForBiomeIndex(bi), ...coverKeysForBiomeIndex(bi)];
        if (biomeKeys.length) pool = biomeKeys;
        if (!biomeKeys.length) continue;
      }
    }
    const key = pool[Math.floor(rng() * pool.length)]!;
    const url =
      key.startsWith("http") || key.startsWith("builtin:") ? key : `builtin:${key}`;
    ents.push({
      id: nanoid(8),
      name: `Paint ${channel} ${i + 1}`,
      type: "model",
      parentId: null,
      transform: {
        position: [x, y, z],
        rotation: [0, rng() * Math.PI * 2, 0],
        scale: [0.8 + rng() * 0.5, 0.8 + rng() * 0.5, 0.8 + rng() * 0.5],
      },
      model: { url },
      physics: { bodyType: "fixed", colliderType: "cuboid" },
      layer: channel === "harvest" ? "Item" : "Default",
    });
  }
  const label = `${replace ? "Replace" : "Paint"} ${channel} ×${ents.length}`;
  useEditor.getState().commandStack.push(
    replace
      ? replaceEntitiesCommand(storeLike(), removeIds, ents, label, ents[0]?.id ?? null)
      : addEntitiesCommand(storeLike(), ents, label, ents[0]?.id ?? null),
  );
  return {
    ok: true,
    data: { added: ents.length, removed: removeIds.length, channel, biome, radius, cdn: NATURE_CDN, replace },
  };
};

const CREATE: ToolDef = {
  name: "create_world",
  description:
    "Create or REPLACE the outdoor map: Super Terrain heightfield + trees, rocks, paths, harvest, structures. " +
    "replace=true (default) removes previous generated terrain/foliage/rocks/paths (never the player). " +
    "layers=['terrain','foliage','rock','path'] to restamp only those. Recipes: alpine-mesh|granite-csg|spline-forest|tunnel-cavern|harbor-atoll|volcanic-ridge|frozen-fjord|island|…",
  input_schema: {
    type: "object",
    properties: {
      recipe: { type: "string" },
      sectorId: { type: "string" },
      biome: { type: "string" },
      size: { type: "number" },
      density: { type: "number" },
      seed: { type: "number" },
      replace: { type: "boolean", description: "Default true — replace existing map dressing instead of stacking." },
      layers: {
        type: "array",
        items: { type: "string", enum: ["map", "terrain", "foliage", "rock", "path", "harvest", "structure"] },
        description: "If set, only replace/add these layers.",
      },
    },
    additionalProperties: false,
  },
};

const createHandler: ToolHandler = async (input) => {
  const recipeId = typeof input.recipe === "string" ? input.recipe : "island";
  const rec = getWorldRecipe(recipeId);
  const sector = resolveWorldSector({
    sectorId: typeof input.sectorId === "string" ? input.sectorId : undefined,
    biome: typeof input.biome === "string" ? input.biome : undefined,
    recipe: recipeId,
  });
  if (!sector) return { ok: false, error: "Could not resolve sector. list_world_biomes." };
  useEditor.getState().cmdSetEnvironment(sector.forgeEnv, `World · ${sector.name}`);
  const size = typeof input.size === "number" ? input.size : 80;
  const density = typeof input.density === "number" ? input.density : 0.55;
  const seed = typeof input.seed === "number" ? input.seed : Date.now() & 0xffff;
  const kind = rec?.terrainKind;
  const fleetBake =
    kind && isSuperTerrainKind(String(kind)) ? await fetchSuperTerrainBake(kind, size) : null;
  const entities = generateMap({
    kind: "openWorld",
    size,
    density,
    seed,
    sectorId: sector.id,
    terrainKind: kind,
    fleetBake: fleetBake ?? undefined,
  });
  const layers = Array.isArray(input.layers) ? (input.layers as WorldLayer[]) : undefined;
  const stats = commitGeneratedWorld(entities, `World · ${sector.name}`, {
    replace: input.replace !== false,
    layers,
  });
  return {
    ok: true,
    data: {
      sectorId: sector.id,
      biome: sector.biome,
      ...stats,
      terrainKind: rec?.terrainKind ?? null,
      engine: fleetBake?.engine ?? rec?.source ?? "island-engine",
      catalog: SUPER_TERRAIN_CATALOG_URLS.info,
      replaced: input.replace !== false,
      layers: layers ?? ["map"],
      next: ["paint_world_brush", "spawn_toon_race", "create_script_from_template wasd-character-controller", "verify_scene_full"],
    },
  };
};

export const defs: ToolDef[] = [LIST, APPLY, PAINT, CREATE];
export const handlers: Record<string, ToolHandler> = {
  list_world_biomes: listHandler,
  apply_biome_look: applyHandler,
  paint_world_brush: paintHandler,
  create_world: createHandler,
};
export const destructiveToolNames: string[] = ["create_world", "paint_world_brush"];
