import warriorIcon from "@assets/warrior_1777807348521.png";
import dwarfIcon from "@assets/dwarf_1777807348521.png";
import frostDwarfIcon from "@assets/frost-dwarf_1777807348520.png";
import elfIcon from "@assets/elf_1777807348522.png";
import orcIcon from "@assets/orc_1777807348520.png";
import skeletonIcon from "@assets/skeleton_1777807348521.png";

export type RaceId =
  | "warrior"
  | "dwarf"
  | "frost-dwarf"
  | "elf"
  | "orc"
  | "skeleton";

export type RaceRole = "player" | "enemy";

export interface Race {
  id: RaceId;
  name: string;
  role: RaceRole;
  icon: string;
  description: string;
  baseStats: {
    health: number;
    speed: number;
    damage: number;
  };
}

/** Catalog of playable / spawnable races. The icons are the 6 portraits the
 *  user dropped into `attached_assets/` — wired through the Vite `@assets`
 *  alias so they're bundled and hashed like any other module asset.  */
export const RACES: readonly Race[] = [
  {
    id: "warrior",
    name: "Human Warrior",
    role: "player",
    icon: warriorIcon,
    description: "Versatile sword-and-shield infantry. Balanced stats.",
    baseStats: { health: 100, speed: 5.0, damage: 12 },
  },
  {
    id: "dwarf",
    name: "Dwarf",
    role: "player",
    icon: dwarfIcon,
    description: "Stout mountain folk. Heavy armour, slower stride.",
    baseStats: { health: 130, speed: 4.2, damage: 14 },
  },
  {
    id: "frost-dwarf",
    name: "Frost Dwarf",
    role: "player",
    icon: frostDwarfIcon,
    description: "Northern dwarven raider. Cold-resistant, hits like a glacier.",
    baseStats: { health: 135, speed: 4.4, damage: 16 },
  },
  {
    id: "elf",
    name: "High Elf",
    role: "player",
    icon: elfIcon,
    description: "Swift archer caste. Low health, very high mobility.",
    baseStats: { health: 80, speed: 6.2, damage: 10 },
  },
  {
    id: "orc",
    name: "Orc",
    role: "enemy",
    icon: orcIcon,
    description: "Hostile raider. High damage, brutal melee.",
    baseStats: { health: 120, speed: 4.8, damage: 18 },
  },
  {
    id: "skeleton",
    name: "Skeleton",
    role: "enemy",
    icon: skeletonIcon,
    description: "Undead minion. Fragile but cheap to spawn in waves.",
    baseStats: { health: 45, speed: 4.0, damage: 8 },
  },
] as const;

export function getRace(id: RaceId): Race | undefined {
  return RACES.find((r) => r.id === id);
}
