/**
 * Seeded enemy / ally camps for Forge openWorld.
 *
 * Buildings = RTS settlement + battle towers (CDN HEAD 200).
 * Occupants = Toon race kits (`builtin:race:*`) as NPC/enemy — never foliage.
 * Kenney Retro Medieval Kit (Documents/kenney_retro-fantasy-kit) is the
 * modular wall/fence/tower catalog to upload under
 * models/kenney/retro-fantasy/{piece}.glb — used when HEAD 200, else palisade boxes.
 */
export type CampSize = "outpost" | "camp" | "fort";
export type CampSide = "enemy" | "ally";

export const CAMP_RTS = {
  tent: "rts-bldg-tent",
  hut: "rts-bldg-farm",
  hall: "rts-bldg-townhall",
  barracks: "rts-bldg-barracks",
  tower: "rts-tower-archer",
  fireTower: "rts-tower-fire",
} as const;

/** Local Kenney Retro Medieval Kit → intended CDN singles (one mesh per file). */
export const KENNEY_RETRO_CDN = "https://assets.grudge-studio.com/models/kenney/retro-fantasy";
export const KENNEY_RETRO_CAMP_PIECES = [
  "fence",
  "fence-wood",
  "wall-low",
  "wall-fortified",
  "wall-fortified-gate",
  "tower",
  "tower-base",
  "tower-top",
  "battlement",
  "detail-crate",
  "detail-barrel",
] as const;

export function kenneyRetroUrl(piece: string): string {
  return `${KENNEY_RETRO_CDN}/${piece}.glb`;
}

export function isRaceKitKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("race:") || k.includes("builtin:race:");
}

export interface CampStamp {
  name: string;
  side: CampSide;
  size: CampSize;
  x: number;
  z: number;
  yaw: number;
}

export interface CampPiece {
  name: string;
  kind: "model" | "fence-box" | "occupant";
  key?: string;
  dx: number;
  dz: number;
  yaw: number;
  scale: number;
}

const ENEMY_RACES = ["orc", "skeleton"] as const;
const ALLY_RACES = ["warrior", "elf"] as const;

export function occupantRace(side: CampSide, i: number): string {
  const pool = side === "ally" ? ALLY_RACES : ENEMY_RACES;
  return pool[i % pool.length]!;
}

/** Compass camps: one ally outpost + enemy camp/fort from seed. */
export function planCamps(
  worldMeters: number,
  density: number,
  rng: () => number,
): CampStamp[] {
  const r = Math.max(14, worldMeters * 0.28);
  const a0 = rng() * Math.PI * 2;
  const out: CampStamp[] = [
    {
      name: "Camp Ally Outpost",
      side: "ally",
      size: "outpost",
      x: Math.cos(a0) * r * 0.7,
      z: Math.sin(a0) * r * 0.7,
      yaw: a0 + Math.PI,
    },
    {
      name: "Camp Enemy Camp",
      side: "enemy",
      size: density > 0.55 ? "fort" : "camp",
      x: Math.cos(a0 + 2.2) * r,
      z: Math.sin(a0 + 2.2) * r,
      yaw: a0 + 2.2 + Math.PI,
    },
  ];
  if (density > 0.35) {
    out.push({
      name: "Camp Enemy Outpost",
      side: "enemy",
      size: "outpost",
      x: Math.cos(a0 - 2.1) * r * 0.85,
      z: Math.sin(a0 - 2.1) * r * 0.85,
      yaw: a0 - 2.1 + Math.PI,
    });
  }
  return out;
}

function palisade(radius: number, count: number, name: string): CampPiece[] {
  const pieces: CampPiece[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pieces.push({
      name,
      kind: "fence-box",
      dx: Math.cos(a) * radius,
      dz: Math.sin(a) * radius,
      yaw: a + Math.PI / 2,
      scale: 1,
    });
  }
  return pieces;
}

export function layoutCamp(size: CampSize, side: CampSide): CampPiece[] {
  const pieces: CampPiece[] = [];
  const tower = side === "ally" ? CAMP_RTS.tower : CAMP_RTS.fireTower;
  if (size === "outpost") {
    pieces.push({ name: "Camp Tent", kind: "model", key: CAMP_RTS.tent, dx: 0, dz: 0, yaw: 0, scale: 1 });
    pieces.push(...palisade(5.5, 6, "Camp Fence"));
    pieces.push({ name: "Camp Occupant", kind: "occupant", dx: 2.2, dz: 1.4, yaw: 0, scale: 1 });
    return pieces;
  }
  if (size === "camp") {
    pieces.push({ name: "Camp Tent", kind: "model", key: CAMP_RTS.tent, dx: -3, dz: -2, yaw: 0.4, scale: 1 });
    pieces.push({ name: "Camp Tent", kind: "model", key: CAMP_RTS.tent, dx: 3.2, dz: -1.5, yaw: -0.5, scale: 1 });
    pieces.push({ name: "Camp Hut", kind: "model", key: CAMP_RTS.hut, dx: 0, dz: 3.5, yaw: Math.PI, scale: 1 });
    pieces.push({ name: "Camp Tower", kind: "model", key: tower, dx: 6.5, dz: 5, yaw: 0, scale: 1 });
    pieces.push(...palisade(9, 10, "Camp Fence"));
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      pieces.push({
        name: "Camp Occupant",
        kind: "occupant",
        dx: Math.cos(a) * 3.5,
        dz: Math.sin(a) * 3.5,
        yaw: a + Math.PI,
        scale: 1,
      });
    }
    return pieces;
  }
  pieces.push({ name: "Camp Hall", kind: "model", key: CAMP_RTS.hall, dx: 0, dz: 0, yaw: 0, scale: 1 });
  pieces.push({ name: "Camp Barracks", kind: "model", key: CAMP_RTS.barracks, dx: -8, dz: 4, yaw: 0.2, scale: 1 });
  pieces.push({ name: "Camp Tower", kind: "model", key: tower, dx: 10, dz: 8, yaw: 0, scale: 1 });
  pieces.push({ name: "Camp Tower", kind: "model", key: CAMP_RTS.tower, dx: -10, dz: -7, yaw: Math.PI / 2, scale: 1 });
  pieces.push({ name: "Camp Tent", kind: "model", key: CAMP_RTS.tent, dx: 6, dz: -6, yaw: 1, scale: 1 });
  pieces.push(...palisade(14, 14, "Camp Fence"));
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05;
    pieces.push({
      name: "Camp Occupant",
      kind: "occupant",
      dx: Math.cos(a) * 5,
      dz: Math.sin(a) * 5,
      yaw: a + Math.PI,
      scale: 1,
    });
  }
  return pieces;
}
