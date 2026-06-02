/**
 * Procedural map generation. Each generator returns a flat list of
 * `SceneEntity` rows, all parented under a single named root group, so
 * the entire generated chunk is one drag/delete/undo unit.
 *
 * Reproducible output: every generator takes a numeric `seed`. Same seed
 * + same options → identical map.
 *
 * When `sectorId` is provided the generators use the matching biome's
 * asset table (`lib/sectorAssets.ts`) to place real GLB models — trees,
 * structures, harvestables, monsters, and ambient VFX — instead of (or
 * alongside) the fallback primitive geometry.
 */

import { nanoid } from "nanoid";
import type { SceneEntity, Vec3 } from "@/scene/types";
import { DEFAULT_TRANSFORM } from "@/scene/types";
import { getSectorById } from "@/lib/worldSectors";
import { SECTOR_ASSETS, pick } from "@/lib/sectorAssets";
import type { BiomeAssets } from "@/lib/sectorAssets";

export type MapKind = "cityGrid" | "openArena" | "dungeonRooms" | "maze" | "openWorld";

export interface MapGenOptions {
  kind: MapKind;
  /** "Map width" in world units (also map depth — generators are square). */
  size: number;
  /** Density tuning, 0..1. Meaning depends on the generator. */
  density: number;
  seed: number;
  /** Optional Grudge world sector id. When set, generators replace primitive
   *  geometry with biome-appropriate GLB models from sectorAssets. */
  sectorId?: string;
}

/* ---------------- PRNG (mulberry32, deterministic and tiny) ------------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const id = () => nanoid(8);

function entity(
  partial: Partial<SceneEntity> & { name: string; type: SceneEntity["type"] },
): SceneEntity {
  return {
    id: id(),
    transform: DEFAULT_TRANSFORM(),
    ...partial,
  } as SceneEntity;
}

/** Resolve BiomeAssets for an optional sector id. Returns null when none. */
function resolveAssets(sectorId?: string): BiomeAssets | null {
  if (!sectorId) return null;
  const sector = getSectorById(sectorId);
  if (!sector) return null;
  return SECTOR_ASSETS[sector.biome] ?? null;
}

/** Create a static model entity using a builtin GLB key. */
function modelEntity(
  name: string,
  key: string,
  pos: Vec3,
  yaw: number,
  scale: number,
  parentId: string,
  opts?: { behavior?: SceneEntity["behavior"]; layer?: SceneEntity["layer"] },
): SceneEntity {
  return entity({
    name,
    type: "model",
    parentId,
    transform: { position: pos, rotation: [0, yaw, 0], scale: [scale, scale, scale] },
    model: { url: `builtin:${key}` },
    physics: { bodyType: "fixed", colliderType: "cuboid" },
    ...(opts ?? {}),
  });
}

/* ---------------- Generators -------------------------------------------- */

export function generateMap(opts: MapGenOptions): SceneEntity[] {
  switch (opts.kind) {
    case "cityGrid":
      return cityGrid(opts);
    case "openArena":
      return openArena(opts);
    case "dungeonRooms":
      return dungeonRooms(opts);
    case "maze":
      return maze(opts);
    case "openWorld":
      return openWorld(opts);
  }
}

function rootGroup(name: string): SceneEntity {
  return entity({
    name,
    type: "empty",
    parentId: null,
  });
}

/* ---------------- City Grid --------------------------------------------- */
/** Square grid of buildings (boxes) with road gaps; ground plane underneath.
 *  When a sector is set, spawns structure GLB models alongside primitives
 *  and scatters monster entities into the street network. */
function cityGrid(opts: MapGenOptions): SceneEntity[] {
  const rng = mulberry32(opts.seed);
  const assets = resolveAssets(opts.sectorId);
  const root = rootGroup("Generated · City Grid");
  const out: SceneEntity[] = [root];

  const size = Math.max(20, opts.size);
  const cell = 6;
  const block = 4; // building footprint
  const halfSize = size / 2;
  const buildChance = 0.35 + opts.density * 0.55; // 0.35..0.9

  // Ground plane
  out.push(
    entity({
      name: "Street",
      type: "plane",
      parentId: root.id,
      transform: { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [size, size, 1] },
      material: { color: assets?.groundColor ?? "#1a1a25", metalness: 0, roughness: 1 },
      physics: { bodyType: "fixed", colliderType: "cuboid" },
    }),
  );

  for (let x = -halfSize + cell / 2; x < halfSize; x += cell) {
    for (let z = -halfSize + cell / 2; z < halfSize; z += cell) {
      if (rng() > buildChance) continue;

      // Try to place a GLB structure model when assets are available
      if (assets && assets.structures.length > 0 && rng() < 0.45) {
        const key = pick(assets.structures, rng)!;
        out.push(modelEntity(
          `Structure (${x.toFixed(0)}, ${z.toFixed(0)})`,
          key,
          [x, 0, z],
          rng() * Math.PI * 2,
          1 + rng() * 0.4,
          root.id,
        ));
      } else {
        const h = 2 + Math.floor(rng() * 6) * 1.5;
        const tint = 0x20 + Math.floor(rng() * 0x40);
        const color = `#${tint.toString(16).padStart(2, "0").repeat(3)}`;
        out.push(
          entity({
            name: `Building (${x.toFixed(0)}, ${z.toFixed(0)})`,
            type: "box",
            parentId: root.id,
            transform: {
              position: [x, h / 2, z],
              rotation: [0, 0, 0],
              scale: [block, h, block],
            },
            material: { color, metalness: 0.05, roughness: 0.9 },
            physics: { bodyType: "fixed", colliderType: "cuboid" },
          }),
        );
      }
    }
  }

  // Street lights / ambient lights
  const lightColor = assets?.lightColor ?? "#ffd28a";
  const lightIntensity = assets?.lightIntensity ?? 6;
  const lightStep = cell * 3;
  for (let x = -halfSize + lightStep / 2; x < halfSize; x += lightStep) {
    for (let z = -halfSize + lightStep / 2; z < halfSize; z += lightStep) {
      if (rng() < 0.7) continue;
      out.push(
        entity({
          name: "Street Light",
          type: "light",
          parentId: root.id,
          transform: { position: [x, 6, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
          light: { kind: "point", color: lightColor, intensity: lightIntensity, distance: 15 },
        }),
      );
    }
  }

  // Sector monsters in the streets
  if (assets && assets.monsters.length > 0) {
    const monsterCount = Math.round(2 + opts.density * 4);
    for (let i = 0; i < monsterCount; i++) {
      const mx = (rng() - 0.5) * (size - 4);
      const mz = (rng() - 0.5) * (size - 4);
      const key = pick(assets.monsters, rng)!;
      out.push(modelEntity(
        `Enemy ${i + 1}`,
        key,
        [mx, 0, mz],
        rng() * Math.PI * 2,
        1,
        root.id,
        { behavior: "enemy-deathmatch", layer: "NPC" },
      ));
    }
  }

  // VFX emitters from sector
  if (assets && assets.vfx.length > 0 && rng() < 0.5) {
    const key = pick(assets.vfx, rng)!;
    out.push(modelEntity("Ambient VFX", key, [0, 0.5, 0], 0, 1, root.id));
  }

  return out;
}

/* ---------------- Open Arena -------------------------------------------- */
/** Bordered arena + scattered cover. When a sector is set, cover uses real
 *  GLB prop models and monsters spawn around the arena perimeter. */
function openArena(opts: MapGenOptions): SceneEntity[] {
  const rng = mulberry32(opts.seed);
  const assets = resolveAssets(opts.sectorId);
  const root = rootGroup("Generated · Open Arena");
  const out: SceneEntity[] = [root];
  const size = Math.max(12, opts.size);
  const half = size / 2;
  const wallH = 3;
  const wallT = 0.6;

  // Floor
  out.push(
    entity({
      name: "Arena Floor",
      type: "plane",
      parentId: root.id,
      transform: { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [size, size, 1] },
      material: { color: assets?.groundColor ?? "#2a2a3a", metalness: 0, roughness: 1 },
      physics: { bodyType: "fixed", colliderType: "cuboid" },
    }),
  );

  // Four perimeter walls
  const wallMat = { color: "#5b4a2a", metalness: 0.05, roughness: 0.9 };
  const walls: [Vec3, Vec3][] = [
    [[0, wallH / 2, -half], [size, wallH, wallT]], // north
    [[0, wallH / 2, half], [size, wallH, wallT]],  // south
    [[-half, wallH / 2, 0], [wallT, wallH, size]], // west
    [[half, wallH / 2, 0], [wallT, wallH, size]],  // east
  ];
  for (const [pos, scale] of walls) {
    out.push(
      entity({
        name: "Arena Wall",
        type: "box",
        parentId: root.id,
        transform: { position: pos, rotation: [0, 0, 0], scale },
        material: wallMat,
        physics: { bodyType: "fixed", colliderType: "cuboid" },
      }),
    );
  }

  // Cover objects — prefer GLB props when assets available
  const step = 3;
  const jitter = step * 0.45;
  const coverChance = 0.2 + opts.density * 0.55;
  for (let x = -half + step; x < half - step; x += step) {
    for (let z = -half + step; z < half - step; z += step) {
      if (rng() > coverChance) continue;
      const px = x + (rng() - 0.5) * jitter;
      const pz = z + (rng() - 0.5) * jitter;

      if (assets && assets.props.length > 0 && rng() < 0.6) {
        const key = pick(assets.props, rng)!;
        out.push(modelEntity(
          "Cover Prop",
          key,
          [px, 0, pz],
          rng() * Math.PI * 2,
          0.8 + rng() * 0.4,
          root.id,
        ));
      } else {
        const w = 1 + rng() * 1.5;
        const h = 1 + rng() * 1.2;
        const d = 1 + rng() * 1.5;
        out.push(
          entity({
            name: "Cover Crate",
            type: "box",
            parentId: root.id,
            transform: { position: [px, h / 2, pz], rotation: [0, rng() * Math.PI, 0], scale: [w, h, d] },
            material: { color: "#6b5a2a", metalness: 0.1, roughness: 0.7 },
            physics: { bodyType: "fixed", colliderType: "cuboid" },
          }),
        );
      }
    }
  }

  // Harvestable pickups in arena corners
  if (assets && assets.harvestables.length > 0) {
    const corners: Vec3[] = [
      [-half * 0.6, 0, -half * 0.6],
      [half * 0.6, 0, -half * 0.6],
      [-half * 0.6, 0, half * 0.6],
      [half * 0.6, 0, half * 0.6],
    ];
    for (const pos of corners) {
      if (rng() < 0.4) continue;
      const key = pick(assets.harvestables, rng)!;
      const e = modelEntity("Harvestable", key, pos, rng() * Math.PI * 2, 0.8, root.id);
      out.push(e);
    }
  }

  // Monsters near arena center
  if (assets && assets.monsters.length > 0) {
    const count = Math.round(1 + opts.density * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = half * 0.4;
      const mx = Math.cos(angle) * radius;
      const mz = Math.sin(angle) * radius;
      const key = pick(assets.monsters, rng)!;
      out.push(modelEntity(
        `Arena Enemy ${i + 1}`,
        key,
        [mx, 0, mz],
        rng() * Math.PI * 2,
        1,
        root.id,
        { behavior: "enemy-deathmatch", layer: "NPC" },
      ));
    }
  }

  // Ambient light
  if (assets) {
    out.push(entity({
      name: "Arena Light",
      type: "light",
      parentId: root.id,
      transform: { position: [0, half * 0.8, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      light: { kind: "point", color: assets.lightColor, intensity: assets.lightIntensity, distance: size },
    }));
  }

  return out;
}

/* ---------------- Dungeon Rooms (BSP) ----------------------------------- */
interface BspRect {
  x: number;
  z: number;
  w: number;
  d: number;
}
function dungeonRooms(opts: MapGenOptions): SceneEntity[] {
  const rng = mulberry32(opts.seed);
  const assets = resolveAssets(opts.sectorId);
  const root = rootGroup("Generated · Dungeon");
  const out: SceneEntity[] = [root];
  const size = Math.max(20, opts.size);

  // BSP split until rooms small enough
  const minRoom = Math.max(6, size * 0.12);
  const splits: BspRect[] = [{ x: -size / 2, z: -size / 2, w: size, d: size }];
  for (let pass = 0; pass < 6; pass++) {
    const next: BspRect[] = [];
    for (const r of splits) {
      if (r.w < minRoom * 2 && r.d < minRoom * 2) {
        next.push(r);
        continue;
      }
      const splitH = r.w > r.d ? false : true;
      if (splitH) {
        const t = r.d * (0.35 + rng() * 0.3);
        next.push({ x: r.x, z: r.z, w: r.w, d: t });
        next.push({ x: r.x, z: r.z + t, w: r.w, d: r.d - t });
      } else {
        const t = r.w * (0.35 + rng() * 0.3);
        next.push({ x: r.x, z: r.z, w: t, d: r.d });
        next.push({ x: r.x + t, z: r.z, w: r.w - t, d: r.d });
      }
    }
    splits.length = 0;
    splits.push(...next);
  }

  // Floor for each leaf
  for (const r of splits) {
    out.push(
      entity({
        name: "Room Floor",
        type: "plane",
        parentId: root.id,
        transform: {
          position: [r.x + r.w / 2, 0, r.z + r.d / 2],
          rotation: [-Math.PI / 2, 0, 0],
          scale: [r.w * 0.95, r.d * 0.95, 1],
        },
        material: { color: "#26242a", metalness: 0, roughness: 1 },
        physics: { bodyType: "fixed", colliderType: "cuboid" },
      }),
    );
  }

  // Walls between leaves: place wall rectangles at the 4 borders, leave a doorway gap.
  const wallH = 3;
  const wallT = 0.5;
  for (const r of splits) {
    const wallMat = { color: "#3a2a1a", metalness: 0.05, roughness: 0.95 };
    const segs: { pos: Vec3; scale: Vec3 }[] = [
      { pos: [r.x + r.w / 2, wallH / 2, r.z], scale: [r.w, wallH, wallT] },
      { pos: [r.x + r.w / 2, wallH / 2, r.z + r.d], scale: [r.w, wallH, wallT] },
      { pos: [r.x, wallH / 2, r.z + r.d / 2], scale: [wallT, wallH, r.d] },
      { pos: [r.x + r.w, wallH / 2, r.z + r.d / 2], scale: [wallT, wallH, r.d] },
    ];
    // Doorway: cut a gap by splitting one wall in two (random side)
    const cutSide = Math.floor(rng() * 4);
    segs.forEach((seg, i) => {
      if (i === cutSide) {
        // Shorten by 40% in the long axis: produce two half-walls with a gap.
        const isXLong = seg.scale[0] > seg.scale[2];
        if (isXLong) {
          const halfLen = (seg.scale[0] - 2.5) / 2;
          if (halfLen <= 0) {
            out.push(buildWall(seg.pos, seg.scale, wallMat, root.id));
            return;
          }
          out.push(
            buildWall(
              [seg.pos[0] - (halfLen + 1.25), seg.pos[1], seg.pos[2]],
              [halfLen, seg.scale[1], seg.scale[2]],
              wallMat,
              root.id,
            ),
          );
          out.push(
            buildWall(
              [seg.pos[0] + (halfLen + 1.25), seg.pos[1], seg.pos[2]],
              [halfLen, seg.scale[1], seg.scale[2]],
              wallMat,
              root.id,
            ),
          );
        } else {
          const halfLen = (seg.scale[2] - 2.5) / 2;
          if (halfLen <= 0) {
            out.push(buildWall(seg.pos, seg.scale, wallMat, root.id));
            return;
          }
          out.push(
            buildWall(
              [seg.pos[0], seg.pos[1], seg.pos[2] - (halfLen + 1.25)],
              [seg.scale[0], seg.scale[1], halfLen],
              wallMat,
              root.id,
            ),
          );
          out.push(
            buildWall(
              [seg.pos[0], seg.pos[1], seg.pos[2] + (halfLen + 1.25)],
              [seg.scale[0], seg.scale[1], halfLen],
              wallMat,
              root.id,
            ),
          );
        }
      } else {
        out.push(buildWall(seg.pos, seg.scale, wallMat, root.id));
      }
    });
  }

  // A torch (point light) per room + sector-aware monster/prop placement
  const torchColor = assets?.lightColor ?? "#ff9d3a";
  const torchIntensity = assets?.lightIntensity ?? 5;
  for (const r of splits) {
    if (rng() < 1 - opts.density) continue;
    out.push(
      entity({
        name: "Torch",
        type: "light",
        parentId: root.id,
        transform: { position: [r.x + r.w / 2, 2.4, r.z + r.d / 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        light: { kind: "point", color: torchColor, intensity: torchIntensity, distance: 12 },
      }),
    );

    // VFX fire emitter alongside some torches
    if (assets && assets.vfx.length > 0 && rng() < 0.35) {
      const vfxKey = pick(assets.vfx, rng)!;
      out.push(modelEntity("Room VFX", vfxKey, [r.x + r.w / 2, 0, r.z + r.d / 2 + 1], 0, 0.6, root.id));
    }

    // Monster per room (density-gated)
    if (assets && assets.monsters.length > 0 && rng() < 0.4 + opts.density * 0.5) {
      const key = pick(assets.monsters, rng)!;
      const jx = r.x + r.w * (0.25 + rng() * 0.5);
      const jz = r.z + r.d * (0.25 + rng() * 0.5);
      out.push(modelEntity(
        "Dungeon Enemy",
        key,
        [jx, 0, jz],
        rng() * Math.PI * 2,
        1,
        root.id,
        { behavior: "enemy-deathmatch", layer: "NPC" },
      ));
    }

    // Harvestable node in some rooms
    if (assets && assets.harvestables.length > 0 && rng() < 0.25) {
      const key = pick(assets.harvestables, rng)!;
      out.push(modelEntity(
        "Harvestable",
        key,
        [r.x + r.w * 0.75, 0, r.z + r.d * 0.75],
        rng() * Math.PI * 2,
        0.7,
        root.id,
      ));
    }

    // Floor prop
    if (assets && assets.props.length > 0 && rng() < 0.3) {
      const key = pick(assets.props, rng)!;
      const px = r.x + r.w * (0.15 + rng() * 0.7);
      const pz = r.z + r.d * (0.15 + rng() * 0.7);
      out.push(modelEntity("Room Prop", key, [px, 0, pz], rng() * Math.PI * 2, 0.8 + rng() * 0.4, root.id));
    }
  }

  return out;
}

function buildWall(
  pos: Vec3,
  scale: Vec3,
  material: { color: string; metalness: number; roughness: number },
  parentId: string,
): SceneEntity {
  return entity({
    name: "Dungeon Wall",
    type: "box",
    parentId,
    transform: { position: pos, rotation: [0, 0, 0], scale },
    material,
    physics: { bodyType: "fixed", colliderType: "cuboid" },
  });
}

/* ---------------- Maze (recursive backtracker) -------------------------- */
function maze(opts: MapGenOptions): SceneEntity[] {
  const rng = mulberry32(opts.seed);
  const assets = resolveAssets(opts.sectorId);
  const root = rootGroup("Generated · Maze");
  const out: SceneEntity[] = [root];

  // Cell grid: choose count by size; cell side = 3 units
  const cellSize = 3;
  const count = Math.max(6, Math.floor(opts.size / cellSize));
  const half = (count * cellSize) / 2;

  // Floor
  out.push(
    entity({
      name: "Maze Floor",
      type: "plane",
      parentId: root.id,
      transform: { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [count * cellSize, count * cellSize, 1] },
      material: { color: assets?.groundColor ?? "#1a1f1a", metalness: 0, roughness: 1 },
      physics: { bodyType: "fixed", colliderType: "cuboid" },
    }),
  );

  // walls[x][y] = { N, S, E, W }
  const walls: { N: boolean; S: boolean; E: boolean; W: boolean }[][] = [];
  for (let x = 0; x < count; x++) {
    walls.push([]);
    for (let y = 0; y < count; y++) {
      walls[x].push({ N: true, S: true, E: true, W: true });
    }
  }
  const visited: boolean[][] = walls.map((col) => col.map(() => false));

  function neighbors(x: number, y: number): [number, number, "N" | "S" | "E" | "W"][] {
    const n: [number, number, "N" | "S" | "E" | "W"][] = [];
    if (y > 0 && !visited[x][y - 1]) n.push([x, y - 1, "N"]);
    if (y < count - 1 && !visited[x][y + 1]) n.push([x, y + 1, "S"]);
    if (x < count - 1 && !visited[x + 1][y]) n.push([x + 1, y, "E"]);
    if (x > 0 && !visited[x - 1][y]) n.push([x - 1, y, "W"]);
    return n;
  }

  const stack: [number, number][] = [[0, 0]];
  visited[0][0] = true;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const ns = neighbors(x, y);
    if (ns.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny, dir] = ns[Math.floor(rng() * ns.length)];
    walls[x][y][dir] = false;
    const opp = dir === "N" ? "S" : dir === "S" ? "N" : dir === "E" ? "W" : "E";
    walls[nx][ny][opp] = false;
    visited[nx][ny] = true;
    stack.push([nx, ny]);
  }

  // Materialize remaining walls. We only emit the N and W walls per cell to
  // avoid duplication, plus the outermost S/E walls at the boundary.
  const wallMat = { color: "#0a0f08", metalness: 0.1, roughness: 0.95 };
  const wallH = 2.5;
  const wallT = 0.4;
  for (let x = 0; x < count; x++) {
    for (let y = 0; y < count; y++) {
      const cx = -half + x * cellSize + cellSize / 2;
      const cz = -half + y * cellSize + cellSize / 2;
      if (walls[x][y].N) {
        out.push(
          buildWall(
            [cx, wallH / 2, cz - cellSize / 2],
            [cellSize, wallH, wallT],
            wallMat,
            root.id,
          ),
        );
      }
      if (walls[x][y].W) {
        out.push(
          buildWall(
            [cx - cellSize / 2, wallH / 2, cz],
            [wallT, wallH, cellSize],
            wallMat,
            root.id,
          ),
        );
      }
      if (y === count - 1 && walls[x][y].S) {
        out.push(
          buildWall(
            [cx, wallH / 2, cz + cellSize / 2],
            [cellSize, wallH, wallT],
            wallMat,
            root.id,
          ),
        );
      }
      if (x === count - 1 && walls[x][y].E) {
        out.push(
          buildWall(
            [cx + cellSize / 2, wallH / 2, cz],
            [wallT, wallH, cellSize],
            wallMat,
            root.id,
          ),
        );
      }

      // Dead end cells get a VFX or monster placed at their center
      const wallCount = (walls[x][y].N ? 1 : 0) + (walls[x][y].S ? 1 : 0)
        + (walls[x][y].E ? 1 : 0) + (walls[x][y].W ? 1 : 0);
      if (wallCount >= 3 && rng() < 0.5) {
        if (assets && assets.vfx.length > 0 && rng() < 0.45) {
          const key = pick(assets.vfx, rng)!;
          out.push(modelEntity("Dead End VFX", key, [cx, 0, cz], rng() * Math.PI * 2, 0.6, root.id));
        } else if (assets && assets.monsters.length > 0) {
          const key = pick(assets.monsters, rng)!;
          out.push(modelEntity(
            "Maze Enemy",
            key,
            [cx, 0, cz],
            rng() * Math.PI * 2,
            1,
            root.id,
            { behavior: "enemy-deathmatch", layer: "NPC" },
          ));
        }
      }
    }
  }

  // Ambient sector lights scattered through the maze
  if (assets) {
    const lightStep = cellSize * 3;
    for (let lx = -half + lightStep; lx < half; lx += lightStep) {
      for (let lz = -half + lightStep; lz < half; lz += lightStep) {
        if (rng() < 0.6) continue;
        out.push(entity({
          name: "Maze Light",
          type: "light",
          parentId: root.id,
          transform: { position: [lx, wallH + 1, lz], rotation: [0, 0, 0], scale: [1, 1, 1] },
          light: { kind: "point", color: assets.lightColor, intensity: assets.lightIntensity * 0.7, distance: cellSize * 4 },
        }));
      }
    }
  }

  return out;
}

/* ---------------- Open World (biome terrain) ---------------------------- */
/** Outdoor generator: large ground plane + dense foliage + scattered
 *  structures + monsters + harvestable resource nodes + NPC friendly units
 *  + VFX emitters. Designed for the "Open World" map kind when a world
 *  sector is selected. Falls back to flat ground + scattered crates when
 *  no sector assets are available. */
function openWorld(opts: MapGenOptions): SceneEntity[] {
  const rng = mulberry32(opts.seed);
  const assets = resolveAssets(opts.sectorId);
  const root = rootGroup("Generated · Open World");
  const out: SceneEntity[] = [root];
  const size = Math.max(40, opts.size);
  const half = size / 2;

  // Ground
  out.push(
    entity({
      name: "Terrain",
      type: "plane",
      parentId: root.id,
      transform: { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [size, size, 1] },
      material: { color: assets?.groundColor ?? "#2a3a1a", metalness: 0, roughness: 1 },
      physics: { bodyType: "fixed", colliderType: "cuboid" },
    }),
  );

  // Foliage (trees / plants) — dense scatter
  if (assets && assets.foliage.length > 0) {
    const foliageDensity = (assets.foliageDensity ?? 0.5) * opts.density;
    const foliageStep = 4;
    const jitter = foliageStep * 0.8;
    for (let x = -half + foliageStep; x < half - foliageStep; x += foliageStep) {
      for (let z = -half + foliageStep; z < half - foliageStep; z += foliageStep) {
        if (rng() > foliageDensity) continue;
        const key = pick(assets.foliage, rng)!;
        const px = x + (rng() - 0.5) * jitter;
        const pz = z + (rng() - 0.5) * jitter;
        out.push(modelEntity(
          "Foliage",
          key,
          [px, 0, pz],
          rng() * Math.PI * 2,
          0.7 + rng() * 0.8,
          root.id,
        ));
      }
    }
  }

  // Structures — sparsely scattered
  if (assets && assets.structures.length > 0) {
    const structureCount = Math.round(2 + opts.density * 4);
    for (let i = 0; i < structureCount; i++) {
      const key = pick(assets.structures, rng)!;
      const sx = (rng() - 0.5) * (size - 10);
      const sz = (rng() - 0.5) * (size - 10);
      out.push(modelEntity(
        `Structure ${i + 1}`,
        key,
        [sx, 0, sz],
        rng() * Math.PI * 2,
        1 + rng() * 0.3,
        root.id,
      ));

      // Place a friendly NPC near each structure
      if (assets.npcs.length > 0 && rng() < 0.6) {
        const npcKey = pick(assets.npcs, rng)!;
        out.push(modelEntity(
          "NPC",
          npcKey,
          [sx + (rng() - 0.5) * 4, 0, sz + (rng() - 0.5) * 4],
          rng() * Math.PI * 2,
          1,
          root.id,
          { behavior: "npc-dialog", layer: "NPC" },
        ));
      }
    }
  }

  // Fallback boxes when no structures defined
  if (!assets || assets.structures.length === 0) {
    for (let i = 0; i < 6; i++) {
      const sx = (rng() - 0.5) * (size - 10);
      const sz = (rng() - 0.5) * (size - 10);
      const s = 2 + rng() * 3;
      out.push(entity({
        name: `Rock ${i + 1}`,
        type: "box",
        parentId: root.id,
        transform: { position: [sx, s / 2, sz], rotation: [0, rng() * Math.PI, 0], scale: [s, s * 0.6, s] },
        material: { color: "#5a5048", metalness: 0, roughness: 1 },
        physics: { bodyType: "fixed", colliderType: "cuboid" },
      }));
    }
  }

  // Monsters — scattered throughout
  if (assets && assets.monsters.length > 0) {
    const monsterCount = Math.round(3 + opts.density * 8);
    for (let i = 0; i < monsterCount; i++) {
      const key = pick(assets.monsters, rng)!;
      const mx = (rng() - 0.5) * (size - 8);
      const mz = (rng() - 0.5) * (size - 8);
      out.push(modelEntity(
        `Enemy ${i + 1}`,
        key,
        [mx, 0, mz],
        rng() * Math.PI * 2,
        1,
        root.id,
        { behavior: "enemy-rpg", layer: "NPC" },
      ));
    }
  }

  // Harvestable resource nodes
  const harvestCount = Math.round(4 + opts.density * 8);
  for (let i = 0; i < harvestCount; i++) {
    const key = assets && assets.harvestables.length > 0
      ? pick(assets.harvestables, rng)!
      : "prop-crystal-gems";
    const hx = (rng() - 0.5) * (size - 6);
    const hz = (rng() - 0.5) * (size - 6);
    out.push(modelEntity(
      `Resource Node ${i + 1}`,
      key,
      [hx, 0.5, hz],
      rng() * Math.PI * 2,
      0.6 + rng() * 0.4,
      root.id,
    ));
  }

  // VFX emitters near interesting spots
  if (assets && assets.vfx.length > 0) {
    const vfxCount = Math.round(1 + opts.density * 3);
    for (let i = 0; i < vfxCount; i++) {
      const key = pick(assets.vfx, rng)!;
      const vx = (rng() - 0.5) * (size - 12);
      const vz = (rng() - 0.5) * (size - 12);
      out.push(modelEntity("Ambient VFX", key, [vx, 0, vz], 0, 1, root.id));
    }
  }

  // Ambient lights (warm / cool depending on biome)
  const lightColor = assets?.lightColor ?? "#ffe4a0";
  const lightIntensity = assets?.lightIntensity ?? 5;
  const lightCount = Math.round(3 + opts.density * 3);
  for (let i = 0; i < lightCount; i++) {
    const lx = (rng() - 0.5) * size;
    const lz = (rng() - 0.5) * size;
    out.push(entity({
      name: `Ambient Light ${i + 1}`,
      type: "light",
      parentId: root.id,
      transform: { position: [lx, 8, lz], rotation: [0, 0, 0], scale: [1, 1, 1] },
      light: { kind: "point", color: lightColor, intensity: lightIntensity, distance: size * 0.4 },
    }));
  }

  return out;
}

