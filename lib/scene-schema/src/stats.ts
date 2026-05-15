/**
 * Stats system — 8 primary attributes, derived stats with diminishing
 * returns, and a stacking modifier model.
 *
 * Design goals:
 *   - Pure functions — `resolveStats` is deterministic, no side effects.
 *   - Scene-serializable — `StatsComponent` lives on `SceneEntity` and
 *     survives JSON round-trips. Runtime-only `StatModifier`s don't.
 *   - Backward-compatible — entities without `stats` keep working;
 *     existing `RaceStats` consumers read from the resolved block.
 */

// ── Primary attributes ──────────────────────────────────────────────────

export const ATTRIBUTES = [
  "STR",
  "DEX",
  "INT",
  "VIT",
  "WIS",
  "LCK",
  "CHA",
  "END",
] as const;

export type Attribute = (typeof ATTRIBUTES)[number];

/** Display-friendly labels for the Inspector. */
export const ATTRIBUTE_LABELS: Readonly<Record<Attribute, string>> = {
  STR: "Strength",
  DEX: "Dexterity",
  INT: "Intelligence",
  VIT: "Vitality",
  WIS: "Wisdom",
  LCK: "Luck",
  CHA: "Charisma",
  END: "Endurance",
};

// ── Derived stats ───────────────────────────────────────────────────────

export const DERIVED_STATS = [
  "maxHealth",
  "maxMana",
  "maxStamina",
  "healthRegen",
  "manaRegen",
  "staminaRegen",
  "armor",
  "magicResist",
  "moveSpeed",
  "attackDamage",
  "abilityPower",
  "critChance",
  "critDamage",
  "dodge",
  "accuracy",
  "cooldownReduction",
  "xpBonus",
  "lootBonus",
  "persuasion",
  "carryCapacity",
] as const;

export type DerivedStat = (typeof DERIVED_STATS)[number];

// ── Scene-serialized component ──────────────────────────────────────────

/** Per-entity stat block persisted on the scene graph. Only `base`
 *  attributes are stored — derived stats are computed at runtime by
 *  {@link resolveStats}. */
export interface StatsComponent {
  /** Base attribute values (0–100 each). Missing keys default to 10. */
  base: Partial<Record<Attribute, number>>;
  /** Entity level (≥ 1). Default 1. */
  level?: number;
  /** Accumulated experience points. Default 0. */
  xp?: number;
}

// ── Runtime modifier (not serialized) ───────────────────────────────────

/** A runtime stat modifier applied by scripts / effects / equipment.
 *  These live only in the `StatsEngine` during play mode — they are
 *  never persisted to the scene JSON. */
export interface StatModifier {
  /** Unique id for this modifier instance (auto-generated if omitted). */
  id: string;
  /** Which derived stat this affects. When targeting a *primary*
   *  attribute, use the `attribute` field instead. */
  stat?: DerivedStat;
  /** Target a primary attribute directly (e.g. a STR buff). When set,
   *  `stat` is ignored — the engine re-derives all dependents. */
  attribute?: Attribute;
  /** Flat additive value applied AFTER percent scaling. */
  flat?: number;
  /** Multiplicative percent modifier (1.0 = +100%). Applied before flat. */
  percent?: number;
  /** Remaining duration in seconds. `undefined` = permanent until removed. */
  duration?: number;
  /** Free-form source tag (entity id, item id, effect name, etc.) so
   *  the caller can later remove all modifiers from that source. */
  source?: string;
  /** Optional stack id. Modifiers with the same `stackId` on the same
   *  entity are capped at `maxStacks`. New ones replace the oldest. */
  stackId?: string;
  /** Maximum concurrent modifiers sharing the same `stackId`. Default 1. */
  maxStacks?: number;
}

// ── Resolved output ─────────────────────────────────────────────────────

/** Fully resolved stat block produced by `resolveStats`. Read-only at
 *  the script surface — mutations go through `StatsEngine.modify()`. */
export interface ResolvedStats {
  /** Effective attribute values after attribute-level modifiers. */
  attributes: Readonly<Record<Attribute, number>>;
  /** Derived combat / gameplay stats. */
  derived: Readonly<Record<DerivedStat, number>>;
  /** Entity level. */
  level: number;
  /** Accumulated XP. */
  xp: number;
}

// ── Pure resolver ───────────────────────────────────────────────────────

const BASE_DEFAULT = 10;

/** Clamp with floor and ceil. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Diminishing-returns curve: `value * cap / (value + halfPoint)`.
 *  At `value === halfPoint` you get exactly `cap / 2`. */
function diminish(value: number, cap: number, halfPoint: number): number {
  if (value <= 0) return 0;
  return (value * cap) / (value + halfPoint);
}

/** Compute derived stats from base attributes + modifiers.
 *
 *  @param component   The persisted stats component (base + level + xp).
 *  @param modifiers   Runtime modifiers (empty array if none). Only
 *                     stat-level modifiers are applied here; attribute-
 *                     level modifiers are folded into the attribute
 *                     totals first.
 */
export function resolveStats(
  component: StatsComponent,
  modifiers: readonly StatModifier[] = [],
): ResolvedStats {
  const level = component.level ?? 1;
  const xp = component.xp ?? 0;

  // ── 1. Resolve effective attributes ─────────────────────────────────
  const attrs = {} as Record<Attribute, number>;
  for (const a of ATTRIBUTES) {
    attrs[a] = component.base[a] ?? BASE_DEFAULT;
  }
  // Apply attribute-level modifiers (percent first, then flat).
  for (const m of modifiers) {
    if (!m.attribute) continue;
    const a = m.attribute;
    if (m.percent) attrs[a] *= 1 + m.percent;
    if (m.flat) attrs[a] += m.flat;
  }
  // Floor at 0, round for display sanity.
  for (const a of ATTRIBUTES) {
    attrs[a] = Math.max(0, Math.round(attrs[a] * 100) / 100);
  }

  // ── 2. Derive stats from attributes ─────────────────────────────────
  // Each formula uses 1–3 attributes and a level scalar. Diminishing
  // returns on most combat-relevant stats prevent runaway scaling.
  const raw: Record<DerivedStat, number> = {
    maxHealth: 50 + attrs.VIT * 8 + attrs.END * 3 + level * 5,
    maxMana: 30 + attrs.INT * 6 + attrs.WIS * 4 + level * 3,
    maxStamina: 40 + attrs.END * 6 + attrs.VIT * 2 + level * 2,
    healthRegen: 0.5 + attrs.VIT * 0.08 + attrs.END * 0.03,
    manaRegen: 0.3 + attrs.WIS * 0.1 + attrs.INT * 0.04,
    staminaRegen: 1.0 + attrs.END * 0.12 + attrs.DEX * 0.04,
    armor: diminish(attrs.STR * 1.5 + attrs.VIT * 0.8, 80, 60),
    magicResist: diminish(attrs.WIS * 1.2 + attrs.INT * 0.6, 75, 55),
    moveSpeed: 4.0 + diminish(attrs.DEX * 0.5 + attrs.END * 0.2, 6, 30),
    attackDamage: 5 + attrs.STR * 1.2 + attrs.DEX * 0.3 + level * 0.8,
    abilityPower: attrs.INT * 1.5 + attrs.WIS * 0.5 + level * 0.6,
    critChance: diminish(attrs.LCK * 0.8 + attrs.DEX * 0.4, 50, 40),
    critDamage: 150 + diminish(attrs.STR * 0.5 + attrs.LCK * 0.6, 100, 50),
    dodge: diminish(attrs.DEX * 0.7 + attrs.LCK * 0.3, 45, 35),
    accuracy: 70 + diminish(attrs.DEX * 0.8 + attrs.WIS * 0.3, 30, 30),
    cooldownReduction: diminish(attrs.INT * 0.4 + attrs.WIS * 0.3, 40, 35),
    xpBonus: diminish(attrs.WIS * 0.5 + attrs.CHA * 0.3, 50, 40),
    lootBonus: diminish(attrs.LCK * 0.8 + attrs.CHA * 0.2, 60, 35),
    persuasion: diminish(attrs.CHA * 1.2 + attrs.WIS * 0.3, 100, 40),
    carryCapacity: 20 + attrs.STR * 1.5 + attrs.END * 0.5,
  };

  // ── 3. Apply stat-level modifiers (percent then flat) ───────────────
  const derived = { ...raw };
  for (const m of modifiers) {
    if (!m.stat || m.attribute) continue;
    const s = m.stat;
    if (m.percent) derived[s] *= 1 + m.percent;
    if (m.flat) derived[s] += m.flat;
  }

  // ── 4. Clamp to sensible ranges ────────────────────────────────────
  derived.maxHealth = Math.max(1, Math.round(derived.maxHealth));
  derived.maxMana = Math.max(0, Math.round(derived.maxMana));
  derived.maxStamina = Math.max(0, Math.round(derived.maxStamina));
  derived.armor = clamp(derived.armor, 0, 95);
  derived.magicResist = clamp(derived.magicResist, 0, 95);
  derived.critChance = clamp(derived.critChance, 0, 100);
  derived.critDamage = Math.max(100, derived.critDamage);
  derived.dodge = clamp(derived.dodge, 0, 75);
  derived.accuracy = clamp(derived.accuracy, 0, 100);
  derived.cooldownReduction = clamp(derived.cooldownReduction, 0, 50);
  derived.xpBonus = Math.max(0, derived.xpBonus);
  derived.lootBonus = Math.max(0, derived.lootBonus);
  derived.moveSpeed = Math.max(0, derived.moveSpeed);
  derived.healthRegen = Math.max(0, derived.healthRegen);
  derived.manaRegen = Math.max(0, derived.manaRegen);
  derived.staminaRegen = Math.max(0, derived.staminaRegen);

  // Round everything to 2dp for clean display.
  for (const k of DERIVED_STATS) {
    derived[k] = Math.round(derived[k] * 100) / 100;
  }

  return {
    attributes: Object.freeze({ ...attrs }),
    derived: Object.freeze(derived),
    level,
    xp,
  };
}

/** Default stats for a brand-new entity — all attributes at 10, level 1. */
export const DEFAULT_STATS: StatsComponent = {
  base: { STR: 10, DEX: 10, INT: 10, VIT: 10, WIS: 10, LCK: 10, CHA: 10, END: 10 },
  level: 1,
  xp: 0,
};
