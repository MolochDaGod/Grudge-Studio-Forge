import { describe, expect, it } from "vitest";

import {
  ATTRIBUTES,
  DERIVED_STATS,
  DEFAULT_STATS,
  resolveStats,
  type StatsComponent,
  type StatModifier,
} from "./stats.js";

// ── resolveStats — baseline ─────────────────────────────────────────────

describe("resolveStats", () => {
  it("fills missing attributes with the default (10)", () => {
    const r = resolveStats({ base: {} });
    for (const a of ATTRIBUTES) {
      expect(r.attributes[a]).toBe(10);
    }
  });

  it("uses the provided base values", () => {
    const r = resolveStats({ base: { STR: 50, DEX: 0, VIT: 100 } });
    expect(r.attributes.STR).toBe(50);
    expect(r.attributes.DEX).toBe(0);
    expect(r.attributes.VIT).toBe(100);
    // Others fall back to 10
    expect(r.attributes.INT).toBe(10);
  });

  it("defaults level to 1 and xp to 0 when omitted", () => {
    const r = resolveStats({ base: {} });
    expect(r.level).toBe(1);
    expect(r.xp).toBe(0);
  });

  it("passes through explicit level and xp", () => {
    const r = resolveStats({ base: {}, level: 5, xp: 1200 });
    expect(r.level).toBe(5);
    expect(r.xp).toBe(1200);
  });

  it("returns all 20 derived stats", () => {
    const r = resolveStats(DEFAULT_STATS);
    for (const s of DERIVED_STATS) {
      expect(typeof r.derived[s]).toBe("number");
      expect(Number.isFinite(r.derived[s])).toBe(true);
    }
  });

  it("DEFAULT_STATS produces consistent baseline values", () => {
    const a = resolveStats(DEFAULT_STATS);
    const b = resolveStats(DEFAULT_STATS);
    // Pure function — same input → identical output.
    expect(a.derived).toEqual(b.derived);
    expect(a.attributes).toEqual(b.attributes);
  });
});

// ── resolveStats — derived stat formulas ────────────────────────────────

describe("resolveStats — derived formulas", () => {
  it("maxHealth scales with VIT", () => {
    const low = resolveStats({ base: { VIT: 5 } });
    const high = resolveStats({ base: { VIT: 80 } });
    expect(high.derived.maxHealth).toBeGreaterThan(low.derived.maxHealth);
  });

  it("moveSpeed scales with DEX", () => {
    const low = resolveStats({ base: { DEX: 5 } });
    const high = resolveStats({ base: { DEX: 80 } });
    expect(high.derived.moveSpeed).toBeGreaterThan(low.derived.moveSpeed);
  });

  it("level increases maxHealth (+5 per level)", () => {
    const l1 = resolveStats({ base: {}, level: 1 });
    const l10 = resolveStats({ base: {}, level: 10 });
    expect(l10.derived.maxHealth - l1.derived.maxHealth).toBe(45); // 9 levels × 5
  });

  it("attackDamage scales with STR primarily", () => {
    const base = resolveStats({ base: { STR: 10 } });
    const buffed = resolveStats({ base: { STR: 60 } });
    expect(buffed.derived.attackDamage).toBeGreaterThan(base.derived.attackDamage);
  });

  it("critChance uses diminishing returns and caps at 100", () => {
    const r = resolveStats({ base: { LCK: 100, DEX: 100 } });
    expect(r.derived.critChance).toBeLessThanOrEqual(100);
    expect(r.derived.critChance).toBeGreaterThan(0);
  });

  it("armor uses diminishing returns and caps at 95", () => {
    const r = resolveStats({ base: { STR: 100, VIT: 100 } });
    expect(r.derived.armor).toBeLessThanOrEqual(95);
    expect(r.derived.armor).toBeGreaterThan(0);
  });

  it("dodge caps at 75", () => {
    const r = resolveStats({ base: { DEX: 100, LCK: 100 } });
    expect(r.derived.dodge).toBeLessThanOrEqual(75);
  });

  it("cooldownReduction caps at 50", () => {
    const r = resolveStats({ base: { INT: 100, WIS: 100 } });
    expect(r.derived.cooldownReduction).toBeLessThanOrEqual(50);
  });
});

// ── resolveStats — clamping ─────────────────────────────────────────────

describe("resolveStats — clamping", () => {
  it("maxHealth never drops below 1", () => {
    // Even with 0 in all attributes and negative modifiers, health ≥ 1.
    const r = resolveStats(
      { base: { VIT: 0, END: 0 }, level: 1 },
      [{ id: "x", stat: "maxHealth", flat: -9999 }],
    );
    expect(r.derived.maxHealth).toBeGreaterThanOrEqual(1);
  });

  it("moveSpeed never goes negative", () => {
    const r = resolveStats(
      { base: { DEX: 0, END: 0 } },
      [{ id: "x", stat: "moveSpeed", flat: -100 }],
    );
    expect(r.derived.moveSpeed).toBeGreaterThanOrEqual(0);
  });

  it("attributes floor at 0 after negative modifiers", () => {
    const r = resolveStats(
      { base: { STR: 5 } },
      [{ id: "x", attribute: "STR", flat: -100 }],
    );
    expect(r.attributes.STR).toBe(0);
  });

  it("critDamage never drops below 100", () => {
    const r = resolveStats(
      { base: {} },
      [{ id: "x", stat: "critDamage", flat: -9999 }],
    );
    expect(r.derived.critDamage).toBeGreaterThanOrEqual(100);
  });
});

// ── resolveStats — modifiers ────────────────────────────────────────────

describe("resolveStats — stat modifiers", () => {
  it("flat modifier adds to a derived stat", () => {
    const base = resolveStats(DEFAULT_STATS);
    const buffed = resolveStats(DEFAULT_STATS, [
      { id: "a", stat: "maxHealth", flat: 50 },
    ]);
    expect(buffed.derived.maxHealth).toBe(base.derived.maxHealth + 50);
  });

  it("percent modifier scales a derived stat", () => {
    const base = resolveStats(DEFAULT_STATS);
    const buffed = resolveStats(DEFAULT_STATS, [
      { id: "a", stat: "attackDamage", percent: 0.5 },
    ]);
    // 50% increase, rounded to 2dp
    const expected = Math.round(base.derived.attackDamage * 1.5 * 100) / 100;
    expect(buffed.derived.attackDamage).toBe(expected);
  });

  it("percent + flat together: percent applies first, then flat", () => {
    const base = resolveStats(DEFAULT_STATS);
    const buffed = resolveStats(DEFAULT_STATS, [
      { id: "a", stat: "maxHealth", percent: 1.0, flat: 10 },
    ]);
    // percent doubles the raw value, then flat adds 10, then round.
    const rawDoubled = (base.derived.maxHealth) * 2;
    expect(buffed.derived.maxHealth).toBe(Math.max(1, Math.round(rawDoubled + 10)));
  });

  it("multiple flat modifiers on the same stat stack additively", () => {
    const base = resolveStats(DEFAULT_STATS);
    const buffed = resolveStats(DEFAULT_STATS, [
      { id: "a", stat: "maxHealth", flat: 20 },
      { id: "b", stat: "maxHealth", flat: 30 },
    ]);
    expect(buffed.derived.maxHealth).toBe(base.derived.maxHealth + 50);
  });

  it("negative flat modifier reduces a derived stat", () => {
    const base = resolveStats(DEFAULT_STATS);
    const debuffed = resolveStats(DEFAULT_STATS, [
      { id: "a", stat: "moveSpeed", flat: -2 },
    ]);
    expect(debuffed.derived.moveSpeed).toBeLessThan(base.derived.moveSpeed);
  });
});

// ── resolveStats — attribute modifiers ──────────────────────────────────

describe("resolveStats — attribute modifiers", () => {
  it("flat attribute modifier increases the effective attribute", () => {
    const base = resolveStats(DEFAULT_STATS);
    const buffed = resolveStats(DEFAULT_STATS, [
      { id: "a", attribute: "STR", flat: 20 },
    ]);
    expect(buffed.attributes.STR).toBe(30);
    // STR feeds into attackDamage and armor — both should increase.
    expect(buffed.derived.attackDamage).toBeGreaterThan(base.derived.attackDamage);
  });

  it("percent attribute modifier scales the base value", () => {
    const buffed = resolveStats(DEFAULT_STATS, [
      { id: "a", attribute: "VIT", percent: 1.0 }, // +100%
    ]);
    // VIT was 10, × 2 = 20
    expect(buffed.attributes.VIT).toBe(20);
  });

  it("attribute modifier with both percent and flat: percent first", () => {
    const r = resolveStats(
      { base: { DEX: 20 } },
      [{ id: "a", attribute: "DEX", percent: 0.5, flat: 5 }],
    );
    // 20 × 1.5 = 30, + 5 = 35
    expect(r.attributes.DEX).toBe(35);
  });

  it("attribute modifier does NOT apply as a stat modifier", () => {
    // A modifier with `attribute` set should not touch the `stat` field.
    const base = resolveStats(DEFAULT_STATS);
    const r = resolveStats(DEFAULT_STATS, [
      { id: "a", attribute: "STR", stat: "maxHealth", flat: 999 },
    ]);
    // maxHealth should NOT have +999 added from the stat path, because
    // attribute is set and `stat` is ignored.
    expect(r.derived.maxHealth).toBeLessThan(base.derived.maxHealth + 999);
  });
});
