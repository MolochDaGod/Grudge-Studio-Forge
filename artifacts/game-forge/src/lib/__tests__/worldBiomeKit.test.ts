import { describe, expect, it } from "vitest";
import { generateMap } from "../mapGen";
import {
  WORLD_RECIPES,
  NATURE_CDN,
  isNaturePackKey,
  paintKeys,
  scatterFoliageKeys,
  classifyWorldDressing,
  collectWorldDressingIds,
  resolveWorldSector,
  worldBiomeSnapshot,
} from "../worldBiomeKit";
import { SECTOR_ASSETS } from "../sectorAssets";
import { isRaceKitKey, planCamps } from "../campKit";

describe("world biome kits", () => {
  it("does not scatter vegetation or pirate lobby packs as one tree", () => {
    expect(isNaturePackKey(NATURE_CDN.vegetation)).toBe(true);
    expect(isNaturePackKey(NATURE_CDN.pirateIslands)).toBe(true);
    expect(isNaturePackKey("nature-tree-pack")).toBe(true);
    expect(isNaturePackKey("nature-icicles")).toBe(true);
    expect(isNaturePackKey("prop-medieval")).toBe(true);
    expect(isNaturePackKey("prop-crystal-gems")).toBe(true);
    expect(isNaturePackKey(scatterFoliageKeys()[0]!)).toBe(false);
    expect(paintKeys(SECTOR_ASSETS.tropical, "foliage").some(isNaturePackKey)).toBe(false);
    expect(paintKeys(SECTOR_ASSETS.frozen, "foliage").some(isNaturePackKey)).toBe(false);
    expect(paintKeys(SECTOR_ASSETS.ethereal, "foliage").some(isNaturePackKey)).toBe(false);
    expect(paintKeys(SECTOR_ASSETS.tropical, "path")).toEqual([]);
    expect(Object.values(SECTOR_ASSETS).every((a) => !a.monsters.some(isRaceKitKey))).toBe(true);
    expect(Object.values(SECTOR_ASSETS).every((a) => !a.npcs.some(isRaceKitKey))).toBe(true);
    expect(paintKeys(SECTOR_ASSETS.tropical, "rock").every((k) => k.includes("Rock_Medium"))).toBe(
      true,
    );
  });

  it("exposes Island Terrain + Super Terrain recipes", () => {
    const ids = WORLD_RECIPES.map((r) => r.id);
    expect(ids).toContain("island");
    expect(ids).toContain("alpine-mesh");
    expect(ids).toContain("granite-csg");
    expect(ids).toContain("spline-forest");
    expect(NATURE_CDN.vegetation).toContain("nature_vegetation.glb");
    expect(WORLD_RECIPES.find((r) => r.id === "alpine-mesh")?.source).toBe("super-terrain");
  });

  it("resolves haven_shore tropical", () => {
    const s = resolveWorldSector({ sectorId: "haven_shore" });
    expect(s?.biome).toBe("tropical");
  });

  it("openWorld with sector stamps Terrain/Walk ground", () => {
    const ents = generateMap({
      kind: "openWorld",
      size: 40,
      density: 0.4,
      seed: 7,
      sectorId: "haven_shore",
    });
    const ground = ents.find((e) => e.name === "Terrain");
    expect(ground?.layer).toBe("Terrain");
    expect(ground?.surface).toBe("Walk");
    expect(ents.length).toBeGreaterThan(4);
  });

  it("openWorld Super Terrain kind stamps heightfield, Poly Haven shader, Kenney foliage", () => {
    const ents = generateMap({
      kind: "openWorld",
      size: 48,
      density: 0.55,
      seed: 22,
      sectorId: "thornwood_wilds",
      terrainKind: "spline-forest",
    });
    const ground = ents.find((e) => e.name === "Terrain");
    expect(ground?.heightfield?.heights.length).toBeGreaterThan(8);
    expect(ground?.material?.shaderPreset).toBe("dirt");
    const foliage = ents.filter((e) => e.name.startsWith("Foliage"));
    expect(foliage.length).toBeGreaterThan(4);
    expect(foliage.every((e) => !isNaturePackKey(e.model?.url ?? ""))).toBe(true);
    expect(ents.some((e) => e.name.startsWith("Rock"))).toBe(true);
  });

  it("snapshot lists paint channels", () => {
    const snap = worldBiomeSnapshot();
    expect(snap.paintChannels).toContain("foliage");
    expect(snap.sectors.length).toBe(9);
    expect(snap.superTerrain.catalog).toContain("super-terrain.json");
    expect(snap.superTerrain.forestPresets).toContain("mossy-old-growth");
    expect(snap.superTerrain.foliageSpecies).toContain("bracken");
    expect(snap.superTerrain.materialChannels).toEqual(["Grass", "Rock", "Soil", "Snow"]);
  });

  it("classifies trees/rocks/paths without tagging the player", () => {
    expect(classifyWorldDressing({ name: "Foliage" })).toBe("foliage");
    expect(classifyWorldDressing({ name: "Foliage cover" })).toBe("foliage");
    expect(classifyWorldDressing({ name: "Rock 3" })).toBe("rock");
    expect(classifyWorldDressing({ name: "Path 2", layer: "Terrain" })).toBe("path");
    expect(classifyWorldDressing({ name: "Terrain", heightfield: { cols: 2 } })).toBe("terrain");
    expect(classifyWorldDressing({ name: "Hero", controllerKind: "tps" })).toBeNull();
  });

  it("collectWorldDressingIds skips the player when replacing a map", () => {
    const ids = collectWorldDressingIds(
      [
        { id: "p", name: "Player", controllerKind: "tps" },
        { id: "t", name: "Terrain", layer: "Terrain" },
        { id: "f", name: "Foliage" },
      ],
      ["terrain", "foliage"],
    );
    expect(ids.sort()).toEqual(["f", "t"]);
  });

  it("openWorld alpine-mesh uses a Super Terrain heightfield", () => {
    const ents = generateMap({
      kind: "openWorld",
      size: 48,
      density: 0.35,
      seed: 11,
      sectorId: "frostbite_expanse",
      terrainKind: "alpine-mesh",
    });
    const ground = ents.find((e) => e.name === "Terrain");
    expect(ground?.heightfield?.cols).toBeGreaterThan(8);
    expect(ground?.heightfield?.heights.length).toBe(
      (ground?.heightfield?.cols ?? 0) * (ground?.heightfield?.rows ?? 0),
    );
    expect(ground?.physics?.colliderType).toBe("trimesh");
    const foliage = ents.find((e) => e.name === "Foliage");
    expect(foliage).toBeTruthy();
    expect(foliage!.transform.position[1]).not.toBe(0);
    expect(ents.some((e) => e.name.startsWith("Path"))).toBe(true);
    expect(ents.some((e) => e.name.startsWith("Rock") || e.name.startsWith("Structure") || e.name.startsWith("Camp"))).toBe(true);
    const models = ents.filter((e) => e.type === "model");
    for (const e of models) {
      const url = e.model?.url ?? "";
      expect(isNaturePackKey(url), url).toBe(false);
    }
  });

  it("openWorld frostbite uses Pine singles not 404 icicle pack", () => {
    const ents = generateMap({
      kind: "openWorld",
      size: 40,
      density: 0.4,
      seed: 3,
      sectorId: "frostbite_expanse",
    });
    const foliage = ents.filter((e) => e.name === "Foliage");
    expect(foliage.length).toBeGreaterThan(0);
    expect(foliage.every((e) => (e.model?.url ?? "").includes("Pine_") || (e.model?.url ?? "").includes("Rock_Medium"))).toBe(true);
    expect(ents.some((e) => (e.model?.url ?? "").includes("nature-icicles"))).toBe(false);
    expect(ents.some((e) => (e.model?.url ?? "").includes("prop-crystal-gems"))).toBe(false);
  });

  it("openWorld stamps seeded camps; race kits are occupants not foliage", () => {
    expect(planCamps(80, 0.5, () => 0.2).some((c) => c.side === "ally")).toBe(true);
    expect(classifyWorldDressing({ name: "Camp Enemy Camp Occupant" })).toBe("structure");
    const ents = generateMap({
      kind: "openWorld",
      size: 80,
      density: 0.5,
      seed: 9,
      sectorId: "ember_depths",
      terrainKind: "volcanic-ridge",
    });
    expect(ents.some((e) => e.name.startsWith("Camp"))).toBe(true);
    expect(ents.some((e) => e.name.includes("Tent") || e.name.includes("Tower") || e.name.includes("Hut"))).toBe(true);
    const occupants = ents.filter((e) => e.name.includes("Occupant"));
    expect(occupants.length).toBeGreaterThan(0);
    expect(occupants.every((e) => (e.model?.url ?? "").includes("builtin:race:"))).toBe(true);
    expect(occupants.every((e) => e.layer === "NPC")).toBe(true);
    const foliage = ents.filter((e) => e.name === "Foliage");
    expect(foliage.every((e) => !(e.model?.url ?? "").includes("builtin:race:"))).toBe(true);
  });
});
