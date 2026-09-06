import { describe, expect, it } from "vitest";
import { isNaturePackKey } from "../worldBiomeKit";
import {
  FOREST_PRESET_KITS,
  SUPER_CLIMATE,
  SUPER_FOLIAGE_SPECIES,
  SUPER_FOREST_PRESETS,
  SUPER_TERRAIN_CATALOG_URLS,
  SUPER_TERRAIN_CHANNELS,
  coverKeysForBiomeIndex,
  foliageKeysForBiomeIndex,
  foliageKeysForKind,
  forestPresetForKind,
  forestStemKeys,
  generateSuperTerrain,
  parseFleetBake,
  pickForestStem,
  sampleHeightfieldY,
  sampleSlopeDeg,
  terrainMaterialForKind,
  toHeightfieldComponent,
} from "../superTerrainWorld";

describe("superTerrainWorld", () => {
  it("bakes alpine-mesh with matching height/biome grids", () => {
    const bake = generateSuperTerrain({ kind: "alpine-mesh", worldMeters: 48, seed: 4000128 });
    expect(bake.engine).toContain("super-terrain");
    expect(bake.heights.length).toBe(bake.cols * bake.rows);
    expect(bake.biomes.length).toBe(bake.heights.length);
    expect(bake.maxHeight).toBeGreaterThan(4);
    const mid = sampleHeightfieldY(bake, 0, 0);
    expect(Number.isFinite(mid)).toBe(true);
    const hf = toHeightfieldComponent(bake);
    expect(hf.heights.length).toBe(hf.cols * hf.rows);
  });

  it("spline-forest is Super Terrain and land is above sea", () => {
    const bake = generateSuperTerrain({ kind: "spline-forest", worldMeters: 40, seed: 22 });
    expect(bake.sectorId).toBe("thornwood_wilds");
    const peak = Math.max(...bake.heights);
    expect(peak).toBeGreaterThan(bake.seaLevel);
  });

  it("maps Super Terrain biomes to single Kenney meshes not packs", () => {
    expect(foliageKeysForBiomeIndex(0)).toEqual([]);
    expect(foliageKeysForBiomeIndex(4).some((k) => k.includes("Pine_"))).toBe(true);
    expect(foliageKeysForKind("granite-csg").every((k) => k.includes("Rock_Medium"))).toBe(true);
    expect(foliageKeysForKind("spline-forest").some((k) => k.includes("Fern_"))).toBe(true);
  });

  it("uses Super Terrain forest presets and foliage species as Kenney singles", () => {
    expect(SUPER_FOREST_PRESETS).toContain("mossy-old-growth");
    expect(forestPresetForKind("spline-forest").id).toBe("mossy-old-growth");
    expect(forestPresetForKind("alpine-mesh").id).toBe("boreal-conifer");
    expect(forestPresetForKind("harbor-atoll").id).toBe("tropical-wet");
    const stems = forestStemKeys(FOREST_PRESET_KITS["boreal-conifer"]);
    expect(stems.some((k) => k.includes("Pine_"))).toBe(true);
    expect(stems.every((k) => !isNaturePackKey(k))).toBe(true);
    expect(SUPER_FOLIAGE_SPECIES).toContain("woodland-fern");
    expect(coverKeysForBiomeIndex(4).some((k) => k.includes("Fern_"))).toBe(true);
    expect(coverKeysForBiomeIndex(0)).toEqual([]);
    const stem = pickForestStem(FOREST_PRESET_KITS["savanna"], () => 0.01);
    expect(stem?.key).toMatch(/CommonTree_|Pine_|Bush_|Plant_|Fern_|Rock_Medium_/);
  });

  it("stamps Poly Haven 1K terrain material, not Ground_N autoload", () => {
    const mat = terrainMaterialForKind("alpine-mesh", "#5a544c");
    expect(mat.shaderPreset).toBe("rock_wall");
    expect(mat.mapUrl).toContain("textures/super-terrain/kind-alpine-mesh.png");
    expect(JSON.stringify(mat)).not.toContain("Ground_");
    const harbor = terrainMaterialForKind("harbor-atoll", "#d4c49a");
    expect(harbor.shaderPreset).toBe("sand_01");
    expect(harbor.mapUrl).toContain("kind-harbor-atoll.png");
  });

  it("samples slope from the same heightfield stems stand on", () => {
    const bake = generateSuperTerrain({ kind: "alpine-mesh", worldMeters: 48, seed: 4000128 });
    const deg = sampleSlopeDeg(bake, 0, 0);
    expect(Number.isFinite(deg)).toBe(true);
    expect(deg).toBeGreaterThanOrEqual(0);
    expect(SUPER_CLIMATE.treeMaxSlopeDeg).toBe(40);
    expect(SUPER_CLIMATE.treeLine).toBeGreaterThan(0.4);
  });

  it("parses fleet CDN island-bake v1 (0–255 heights) onto the same heightfield", () => {
    expect(SUPER_TERRAIN_CATALOG_URLS.info).toContain("info.grudge-studio.com/api/v1/super-terrain.json");
    expect(SUPER_TERRAIN_CHANNELS[0].albedo).toContain("channel-grass.png");
    const n = 4;
    const heights = Array.from({ length: n * n }, (_, i) => (i === 5 ? 147 : 0));
    const bake = parseFleetBake(
      {
        format: "grudge-island-bake/v1",
        engine: "super-terrain (generated bake)",
        title: "Alpine Mesh",
        seed: 4000128,
        size: n,
        cellSize: 1.25,
        seaLevel: 0.12,
        maxHeight: 16,
        heights,
        biomes: Array(n * n).fill(4),
      },
      "alpine-mesh",
      48,
    );
    expect(bake).toBeTruthy();
    expect(bake!.cols).toBe(4);
    expect(bake!.heights[5]).toBeCloseTo(147 / 255, 5);
    expect(bake!.cellSize).toBeCloseTo(48 / 3, 5);
    expect(bake!.engine).toContain("super-terrain");
  });
});
