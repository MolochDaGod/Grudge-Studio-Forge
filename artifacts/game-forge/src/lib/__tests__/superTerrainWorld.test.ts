import { describe, expect, it } from "vitest";
import {
  generateSuperTerrain,
  sampleHeightfieldY,
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
});
