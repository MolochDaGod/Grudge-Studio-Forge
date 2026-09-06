/**
 * Fast options — one-click fleet + builtin assets for the Asset Browser.
 *
 * These are the production-ready spawns designers reach for first:
 * races, maps, VFX, RTS buildings, nature, vehicles. All use durable
 * `builtin:` keys (or verified CDN URLs) so scenes stay portable.
 *
 * Never invent CDN paths — only keys registered in BUILTIN_MODELS or
 * absolute https URLs verified 200 on assets.grudge-studio.com.
 */

export type FastAssetGroup =
  | "characters"
  | "maps"
  | "vfx"
  | "nature"
  | "buildings"
  | "vehicles"
  | "props"
  | "weapons";

export interface FastAsset {
  id: string;
  label: string;
  group: FastAssetGroup;
  /** Scene model url — prefer `builtin:…` keys */
  modelUrl: string;
  blurb: string;
  /** Optional default Y for feet-on-ground-ish spawn */
  spawnY?: number;
  /** Uniform scale applied at spawn (maps often need smaller SI) */
  scale?: number;
}

export const FAST_ASSET_GROUP_LABEL: Record<FastAssetGroup, string> = {
  characters: "Characters",
  maps: "Maps / worlds",
  vfx: "VFX",
  nature: "Nature",
  buildings: "Buildings",
  vehicles: "Vehicles",
  props: "Props",
  weapons: "Weapons",
};

/** Ordered catalog — featured production assets for the Fast tab. */
export const FAST_ASSETS: FastAsset[] = [
  // ── Characters ────────────────────────────────────────────────────
  {
    id: "char-blake",
    label: "Blake",
    group: "characters",
    modelUrl: "builtin:blake",
    blurb: "Hero starter · bundled",
    spawnY: 0,
  },
  {
    id: "char-race-warrior",
    label: "Race · Warrior",
    group: "characters",
    modelUrl: "builtin:race:warrior",
    blurb: "Toon RTS human · CDN",
  },
  {
    id: "char-race-orc",
    label: "Race · Orc",
    group: "characters",
    modelUrl: "builtin:race:orc",
    blurb: "Toon RTS orc · CDN",
  },
  {
    id: "char-race-elf",
    label: "Race · Elf",
    group: "characters",
    modelUrl: "builtin:race:elf",
    blurb: "Toon RTS elf · CDN",
  },
  {
    id: "char-race-dwarf",
    label: "Race · Dwarf",
    group: "characters",
    modelUrl: "builtin:race:dwarf",
    blurb: "Toon RTS dwarf · CDN",
  },
  {
    id: "char-race-frost",
    label: "Race · Frost Dwarf",
    group: "characters",
    modelUrl: "builtin:race:frost-dwarf",
    blurb: "Toon RTS barbarian · CDN",
  },
  {
    id: "char-race-skel",
    label: "Race · Skeleton",
    group: "characters",
    modelUrl: "builtin:race:skeleton",
    blurb: "Toon RTS undead · CDN",
  },
  {
    id: "char-boss-orc",
    label: "Boss Orc",
    group: "characters",
    modelUrl: "builtin:char-boss-orc",
    blurb: "Boss mesh",
  },
  {
    id: "char-wolf",
    label: "Wolf",
    group: "characters",
    modelUrl: "builtin:char-wolf",
    blurb: "Stylized creature",
  },
  // grudge6 modular kits (production GLB on R2 — preferred production heroes)
  {
    id: "char-g6-human",
    label: "Grudge6 · Human kit",
    group: "characters",
    modelUrl: "builtin:grudge6:warrior",
    blurb: "WK_Characters.glb · CDN modular",
  },
  {
    id: "char-g6-orc",
    label: "Grudge6 · Orc kit",
    group: "characters",
    modelUrl: "builtin:grudge6:orc",
    blurb: "ORC_Characters.glb · CDN modular",
  },
  {
    id: "char-g6-elf",
    label: "Grudge6 · Elf kit",
    group: "characters",
    modelUrl: "builtin:grudge6:elf",
    blurb: "ELF_Characters.glb · CDN modular",
  },
  {
    id: "char-g6-dwarf",
    label: "Grudge6 · Dwarf kit",
    group: "characters",
    modelUrl: "builtin:grudge6:dwarf",
    blurb: "DWF_Characters.glb · CDN modular",
  },
  {
    id: "char-g6-barb",
    label: "Grudge6 · Barbarian kit",
    group: "characters",
    modelUrl: "builtin:grudge6:frost-dwarf",
    blurb: "BRB_Characters.glb · CDN modular",
  },
  {
    id: "char-g6-undead",
    label: "Grudge6 · Undead kit",
    group: "characters",
    modelUrl: "builtin:grudge6:skeleton",
    blurb: "UD_Characters.glb · CDN modular",
  },

  // ── Maps ──────────────────────────────────────────────────────────
  {
    id: "map-pirate",
    label: "Pirate Islands",
    group: "maps",
    modelUrl: "builtin:map-pirate-islands-scene",
    blurb: "Lobby MAP shell only — not a tree/rock instance. Terrain/shovel/harvest on this mesh.",
    spawnY: 0,
    scale: 1,
  },
  {
    id: "map-mistytown",
    label: "Misty Town",
    group: "maps",
    modelUrl: "builtin:map-mistytown",
    blurb: "Chicken Gun map · R2",
    scale: 1,
  },
  {
    id: "map-cyberpunk",
    label: "Cyberpunk",
    group: "maps",
    modelUrl: "builtin:map-cyberpunk",
    blurb: "Deathmatch city",
  },
  {
    id: "map-encampment",
    label: "Encampment",
    group: "maps",
    modelUrl: "builtin:map-encampment",
    blurb: "Winter camp",
  },
  {
    id: "map-fort",
    label: "Fort Royale",
    group: "maps",
    modelUrl: "builtin:map-fort-royale",
    blurb: "Arena fort",
  },
  {
    id: "map-underground",
    label: "Underground Wars",
    group: "maps",
    modelUrl: "builtin:map-underground-wars",
    blurb: "PvP arena · R2",
  },
  {
    id: "map-pirate-builtin",
    label: "Pirate Island (builtin)",
    group: "maps",
    modelUrl: "builtin:map-pirate-island",
    blurb: "Bundled pirate plate",
  },

  // ── VFX ───────────────────────────────────────────────────────────
  {
    id: "vfx-fire",
    label: "Stylized Fire",
    group: "vfx",
    modelUrl: "builtin:vfx-stylized-fire",
    blurb: "Loop fire",
    spawnY: 0.5,
  },
  {
    id: "vfx-tornado",
    label: "Fire Tornado",
    group: "vfx",
    modelUrl: "builtin:vfx-stylized-fire-tornado",
    blurb: "Vertical fire funnel",
    spawnY: 0,
  },
  {
    id: "vfx-explosion-a",
    label: "Explosion A",
    group: "vfx",
    modelUrl: "builtin:vfx-explosion-a",
    blurb: "Burst mesh",
    spawnY: 1,
  },
  {
    id: "vfx-explosion-b",
    label: "Explosion B",
    group: "vfx",
    modelUrl: "builtin:vfx-explosion-b",
    blurb: "Burst mesh",
    spawnY: 1,
  },
  {
    id: "vfx-freeze",
    label: "Freeze",
    group: "vfx",
    modelUrl: "builtin:vfx-freeze",
    blurb: "Ice effect",
    spawnY: 0.5,
  },
  {
    id: "vfx-leaves",
    label: "Falling Leaves",
    group: "vfx",
    modelUrl: "builtin:vfx-leaves",
    blurb: "Nature FX",
  },
  {
    id: "vfx-trail",
    label: "Trail",
    group: "vfx",
    modelUrl: "builtin:vfx-trail",
    blurb: "Animated trail",
  },
  {
    id: "vfx-circuits",
    label: "Greeble Circuits",
    group: "vfx",
    modelUrl: "builtin:vfx-circuits",
    blurb: "Tech FX",
  },

  // ── Nature (Kenney singles only — never a pack as one tree) ──────
  {
    id: "nature-tree-1",
    label: "Common Tree 1",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/CommonTree_1.glb",
    blurb: "Single Kenney tree mesh",
  },
  {
    id: "nature-pine-1",
    label: "Pine 1",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/Pine_1.glb",
    blurb: "Single Kenney pine mesh",
  },
  {
    id: "nature-rock-1",
    label: "Rock Medium 1",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/Rock_Medium_1.glb",
    blurb: "Single Kenney rock mesh",
  },
  {
    id: "nature-bush",
    label: "Bush Common",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/Bush_Common.glb",
    blurb: "Single bush mesh",
  },
  {
    id: "nature-tree-2",
    label: "Common Tree 2",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/CommonTree_2.glb",
    blurb: "Single Kenney tree mesh",
  },
  {
    id: "nature-pine-2",
    label: "Pine 2",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/Pine_2.glb",
    blurb: "Single Kenney pine mesh",
  },
  {
    id: "nature-rock-2",
    label: "Rock Medium 2",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/Rock_Medium_2.glb",
    blurb: "Single Kenney rock mesh",
  },
  {
    id: "nature-fern",
    label: "Fern 1",
    group: "nature",
    modelUrl: "https://assets.grudge-studio.com/models/nature/Fern_1.glb",
    blurb: "Single fern mesh",
  },

  // ── Buildings ─────────────────────────────────────────────────────
  {
    id: "bldg-tavern",
    label: "Tavern",
    group: "buildings",
    modelUrl: "builtin:bldg-tavern",
    blurb: "Stylized building",
  },
  {
    id: "bldg-hut",
    label: "Woodcutter Hut",
    group: "buildings",
    modelUrl: "builtin:bldg-woodcutter-hut",
    blurb: "Stylized building",
  },
  {
    id: "rts-townhall",
    label: "RTS Town Hall",
    group: "buildings",
    modelUrl: "builtin:rts-bldg-townhall",
    blurb: "Orc settlement · CDN",
  },
  {
    id: "rts-barracks",
    label: "RTS Barracks",
    group: "buildings",
    modelUrl: "builtin:rts-bldg-barracks",
    blurb: "Smithy kit · CDN",
  },
  {
    id: "rts-tower",
    label: "Archer Tower",
    group: "buildings",
    modelUrl: "builtin:rts-tower-archer",
    blurb: "Battle tower · CDN",
  },

  // ── Vehicles ──────────────────────────────────────────────────────
  {
    id: "veh-sports",
    label: "Sports Car",
    group: "vehicles",
    modelUrl: "builtin:vehicle-sports",
    blurb: "Realistic car pack",
  },
  {
    id: "veh-suv",
    label: "SUV",
    group: "vehicles",
    modelUrl: "builtin:vehicle-suv",
    blurb: "Realistic car pack",
  },
  {
    id: "veh-cop",
    label: "Cop Car",
    group: "vehicles",
    modelUrl: "builtin:vehicle-cop",
    blurb: "Realistic car pack",
  },

  // ── Props ─────────────────────────────────────────────────────────
  {
    id: "prop-crystal",
    label: "Crystal Gems",
    group: "props",
    modelUrl: "builtin:prop-crystal-gems",
    blurb: "STUB/pack — do not scatter as one harvest node.",
    spawnY: 0.5,
  },
  {
    id: "prop-medieval",
    label: "Medieval Props",
    group: "props",
    modelUrl: "builtin:prop-medieval",
    blurb: "PACK/stub — isolate meshes; do not place as one rock.",
  },
  {
    id: "prop-weapons",
    label: "Toon Weapons",
    group: "props",
    modelUrl: "builtin:prop-toon-weapons",
    blurb: "Weapon pack",
  },
  {
    id: "prop-tent",
    label: "Survivors Tent",
    group: "props",
    modelUrl: "builtin:prop-survivors-tent",
    blurb: "Camp prop",
  },

  // ── Weapons (race kit) ────────────────────────────────────────────
  {
    id: "wpn-warrior",
    label: "Warrior Sword",
    group: "weapons",
    modelUrl: "builtin:race-weapon:warrior",
    blurb: "grudge6 library · CDN",
    spawnY: 1,
  },
  {
    id: "wpn-elf",
    label: "Elf Bow",
    group: "weapons",
    modelUrl: "builtin:race-weapon:elf",
    blurb: "grudge6 library · CDN",
    spawnY: 1,
  },
  {
    id: "wpn-orc",
    label: "Orc Axe",
    group: "weapons",
    modelUrl: "builtin:race-weapon:orc",
    blurb: "grudge6 library · CDN",
    spawnY: 1,
  },
  {
    id: "wpn-rifle",
    label: "Rifle",
    group: "weapons",
    modelUrl: "builtin:rifle",
    blurb: "Bundled rifle",
    spawnY: 1,
  },
  {
    id: "wpn-dwarf",
    label: "Dwarf Axe",
    group: "weapons",
    modelUrl: "builtin:race-weapon:dwarf",
    blurb: "grudge6 library · CDN",
    spawnY: 1,
  },
  {
    id: "wpn-barb",
    label: "Barbarian Hammer",
    group: "weapons",
    modelUrl: "builtin:race-weapon:frost-dwarf",
    blurb: "grudge6 library · CDN",
    spawnY: 1,
  },
  {
    id: "wpn-undead",
    label: "Undead Sword",
    group: "weapons",
    modelUrl: "builtin:race-weapon:skeleton",
    blurb: "grudge6 library · CDN",
    spawnY: 1,
  },
];

export function fastAssetsByGroup(): {
  group: FastAssetGroup;
  label: string;
  items: FastAsset[];
}[] {
  const order: FastAssetGroup[] = [
    "characters",
    "maps",
    "vfx",
    "weapons",
    "nature",
    "buildings",
    "vehicles",
    "props",
  ];
  return order
    .map((group) => ({
      group,
      label: FAST_ASSET_GROUP_LABEL[group],
      items: FAST_ASSETS.filter((a) => a.group === group),
    }))
    .filter((g) => g.items.length > 0);
}
