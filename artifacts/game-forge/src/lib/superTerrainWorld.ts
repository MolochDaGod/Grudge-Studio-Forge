/**
 * Super Terrain → Forge world bake (data + heightfield only).
 *
 * Source: GrudgeBlox `shared/maps/generateIsland.ts` +
 * `superTerrainBake.ts` (https://github.com/vibe-stack/super-terrain).
 * Do not vendor the WebGPU/Godot editor. Do not import Island Terrain
 * WorldTerrain into Forge. Agentic tools call create_world / paint_world_brush.
 */
import type { HeightfieldComponent } from "@workspace/scene-schema";

export const SUPER_TERRAIN_REPO = "https://github.com/vibe-stack/super-terrain";

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
