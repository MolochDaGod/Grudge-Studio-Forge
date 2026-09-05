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

describe("world biome kits", () => {
  it("does not scatter vegetation or pirate lobby packs as one tree", () => {
    expect(isNaturePackKey(NATURE_CDN.vegetation)).toBe(true);
    expect(isNaturePackKey(NATURE_CDN.pirateIslands)).toBe(true);
    expect(isNaturePackKey("nature-tree-pack")).toBe(true);
    expect(isNaturePackKey(scatterFoliageKeys()[0]!)).toBe(false);
    expect(paintKeys(SECTOR_ASSETS.tropical, "foliage").some(isNaturePackKey)).toBe(false);
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

  it("snapshot lists paint channels", () => {
    const snap = worldBiomeSnapshot();
    expect(snap.paintChannels).toContain("foliage");
    expect(snap.sectors.length).toBe(9);
  });

  it("classifies trees/rocks/paths without tagging the player", () => {
    expect(classifyWorldDressing({ name: "Foliage" })).toBe("foliage");
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
    expect(ents.some((e) => e.name.startsWith("Rock") || e.name.startsWith("Structure"))).toBe(true);
  });
});
