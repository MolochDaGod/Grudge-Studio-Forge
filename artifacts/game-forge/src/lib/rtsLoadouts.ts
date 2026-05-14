import type { RaceId } from "./races";
import type { UnitKind } from "@workspace/scene-schema";

export type AttackKind = "melee" | "ranged" | "magic";

export interface UnitStats {
  hp: number;
  dmg: number;
  range: number;
  speed: number;
  scale: number;
  attackKind: AttackKind;
  /** Cost paid at training time. */
  cost: { gold: number; wood: number };
  /** Brief tooltip / training description. */
  description: string;
}

const BASE: Record<UnitKind, UnitStats> = {
  peon:           { hp: 40,  dmg: 4,   range: 1.4, speed: 4.2, scale: 0.9,  attackKind: "melee",  cost: { gold: 50,  wood: 0   }, description: "Worker. Gathers gold and wood; constructs buildings." },
  footman:        { hp: 90,  dmg: 12,  range: 1.6, speed: 4.5, scale: 1.0,  attackKind: "melee",  cost: { gold: 80,  wood: 0   }, description: "Sword infantry. Backbone melee unit." },
  archer:         { hp: 55,  dmg: 9,   range: 14,  speed: 4.8, scale: 0.95, attackKind: "ranged", cost: { gold: 70,  wood: 30  }, description: "Ranged unit. Fires arrows from a distance." },
  mage:           { hp: 50,  dmg: 18,  range: 11,  speed: 4.4, scale: 0.95, attackKind: "magic",  cost: { gold: 100, wood: 0   }, description: "Spellcaster. High burst damage, fragile." },
  knight:         { hp: 140, dmg: 18,  range: 1.8, speed: 6.5, scale: 1.05, attackKind: "melee",  cost: { gold: 120, wood: 0   }, description: "Mounted melee. Heavy charge, high HP." },
  mounted_archer: { hp: 75,  dmg: 11,  range: 13,  speed: 6.8, scale: 1.0,  attackKind: "ranged", cost: { gold: 130, wood: 40  }, description: "Mounted ranged. Hit-and-run skirmisher." },
  mounted_mage:   { hp: 70,  dmg: 20,  range: 12,  speed: 6.2, scale: 1.0,  attackKind: "magic",  cost: { gold: 160, wood: 0   }, description: "Mounted caster. Mobile artillery." },
  catapult:       { hp: 120, dmg: 50,  range: 18,  speed: 2.4, scale: 1.4,  attackKind: "ranged", cost: { gold: 200, wood: 100 }, description: "Siege engine. Devastates buildings; slow." },
};

/** Per-race stat multipliers reflecting the user's flavor brief:
 *  human = balanced w/ knight emphasis, elf = ranger, skeleton = mage,
 *  orc = heavy melee, dwarf = ranged crossbow, frost-dwarf = fast scout. */
type Mult = Partial<Record<keyof UnitStats, number>>;
const RACE_MULT: Record<RaceId, Partial<Record<UnitKind, Mult>>> = {
  warrior: {
    knight:  { hp: 1.15, dmg: 1.10 },
    footman: { hp: 1.05 },
  },
  elf: {
    archer:         { dmg: 1.20, range: 1.10 },
    mounted_archer: { dmg: 1.15, range: 1.10 },
  },
  skeleton: {
    mage:         { dmg: 1.25 },
    mounted_mage: { dmg: 1.20 },
  },
  orc: {
    footman: { hp: 1.20, dmg: 1.15, speed: 0.95 },
    knight:  { hp: 1.10, dmg: 1.10 },
  },
  dwarf: {
    archer:   { dmg: 1.15, range: 1.05, speed: 0.95 },
    catapult: { dmg: 1.10 },
  },
  "frost-dwarf": {
    peon:    { speed: 1.15 },
    archer:  { speed: 1.10, range: 1.05 },
    knight:  { speed: 1.10 },
  },
};

/** Resolve final stats for a (race, unit) pair. */
export function getUnitStats(race: RaceId, unit: UnitKind): UnitStats {
  const base = BASE[unit];
  const mult = RACE_MULT[race]?.[unit] ?? {};
  const out: UnitStats = { ...base, cost: { ...base.cost } };
  for (const k of Object.keys(mult) as (keyof Mult)[]) {
    const m = mult[k];
    if (typeof m !== "number") continue;
    const bag = out as unknown as Record<string, unknown>;
    const v = bag[k];
    if (typeof v === "number") {
      bag[k] = v * m;
    }
  }
  return out;
}

/** Model key resolver. Today every race+unit uses the per-race rigged
 *  character GLB; mounted variants get a slight scale bump (PR-3 will
 *  swap in real mount meshes). Catapult falls back to the character
 *  rig with a large scale until a siege model ships. */
export function getUnitModelKey(race: RaceId): string {
  return `builtin:race:${race}`;
}

export const ALL_UNIT_KINDS: readonly UnitKind[] = [
  "peon", "footman", "archer", "mage",
  "knight", "mounted_archer", "mounted_mage", "catapult",
];
