import { describe, expect, it, beforeEach } from "vitest";
import { StatsEngine } from "@/scene/StatsEngine";
import { DEFAULT_STATS, resolveStats, type StatsComponent } from "@workspace/scene-schema";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Shorthand: an entity with default stats. */
const entity = (id: string, stats?: StatsComponent) => ({
  id,
  stats: stats ?? { ...DEFAULT_STATS, base: { ...DEFAULT_STATS.base } },
});

/** Warrior-like stats: high STR/VIT, low INT. */
const warrior: StatsComponent = {
  base: { STR: 40, DEX: 15, INT: 5, VIT: 35, WIS: 8, LCK: 10, CHA: 10, END: 25 },
  level: 3,
  xp: 450,
};

// ── Lifecycle ───────────────────────────────────────────────────────────

describe("StatsEngine — lifecycle", () => {
  let engine: StatsEngine;
  beforeEach(() => {
    engine = new StatsEngine();
  });

  it("ignores entities without stats on init", () => {
    engine.init([{ id: "noStats" }, entity("hasStats")]);
    expect(engine.get("noStats")).toBeUndefined();
    expect(engine.get("hasStats")).toBeDefined();
  });

  it("init deep-copies the component (mutation-safe)", () => {
    const stats: StatsComponent = { base: { STR: 20 }, level: 1 };
    engine.init([{ id: "a", stats }]);
    // Mutate the source — engine should not see it.
    stats.base.STR = 99;
    expect(engine.getBase("a")!.base.STR).toBe(20);
  });

  it("reset clears all entries", () => {
    engine.init([entity("a"), entity("b")]);
    engine.reset();
    expect(engine.get("a")).toBeUndefined();
    expect(engine.get("b")).toBeUndefined();
  });

  it("re-init replaces previous entries", () => {
    engine.init([entity("a")]);
    engine.modify("a", { stat: "maxHealth", flat: 100 });

    engine.init([entity("a")]); // fresh init
    // Modifier should be gone.
    const base = resolveStats(DEFAULT_STATS);
    expect(engine.get("a")!.derived.maxHealth).toBe(base.derived.maxHealth);
  });
});

// ── get / getBase ───────────────────────────────────────────────────────

describe("StatsEngine — get / getBase", () => {
  let engine: StatsEngine;
  beforeEach(() => {
    engine = new StatsEngine();
    engine.init([entity("a"), { id: "w", stats: warrior }]);
  });

  it("get returns resolved stats matching resolveStats output", () => {
    const direct = resolveStats(DEFAULT_STATS);
    const fromEngine = engine.get("a")!;
    expect(fromEngine.derived.maxHealth).toBe(direct.derived.maxHealth);
    expect(fromEngine.level).toBe(1);
  });

  it("getBase returns the persisted component", () => {
    const base = engine.getBase("w")!;
    expect(base.base.STR).toBe(40);
    expect(base.level).toBe(3);
    expect(base.xp).toBe(450);
  });

  it("get returns undefined for unknown ids", () => {
    expect(engine.get("nope")).toBeUndefined();
  });

  it("getBase returns undefined for unknown ids", () => {
    expect(engine.getBase("nope")).toBeUndefined();
  });
});

// ── modify ──────────────────────────────────────────────────────────────

describe("StatsEngine — modify", () => {
  let engine: StatsEngine;
  beforeEach(() => {
    engine = new StatsEngine();
    engine.init([entity("a")]);
  });

  it("flat stat modifier increases derived stat", () => {
    const before = engine.get("a")!.derived.maxHealth;
    engine.modify("a", { stat: "maxHealth", flat: 50 });
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 50);
  });

  it("percent modifier scales derived stat", () => {
    const before = engine.get("a")!.derived.attackDamage;
    engine.modify("a", { stat: "attackDamage", percent: 1.0 });
    const after = engine.get("a")!.derived.attackDamage;
    // Doubled, with rounding.
    expect(after).toBeCloseTo(before * 2, 1);
  });

  it("attribute modifier changes effective attribute + downstream derivations", () => {
    const before = engine.get("a")!;
    engine.modify("a", { attribute: "STR", flat: 30 });
    const after = engine.get("a")!;
    expect(after.attributes.STR).toBe(before.attributes.STR + 30);
    expect(after.derived.attackDamage).toBeGreaterThan(before.derived.attackDamage);
  });

  it("returns a modifier id", () => {
    const id = engine.modify("a", { stat: "maxHealth", flat: 10 });
    expect(typeof id).toBe("string");
    expect(id!.length).toBeGreaterThan(0);
  });

  it("returns undefined for unknown entity", () => {
    expect(engine.modify("nope", { stat: "maxHealth", flat: 10 })).toBeUndefined();
  });

  it("uses provided id when given", () => {
    const id = engine.modify("a", { id: "custom-id", stat: "maxHealth", flat: 10 });
    expect(id).toBe("custom-id");
  });

  it("multiple modifiers on different stats coexist", () => {
    const before = engine.get("a")!;
    engine.modify("a", { stat: "maxHealth", flat: 50 });
    engine.modify("a", { stat: "moveSpeed", flat: 3 });
    const after = engine.get("a")!;
    expect(after.derived.maxHealth).toBe(before.derived.maxHealth + 50);
    expect(after.derived.moveSpeed).toBeCloseTo(before.derived.moveSpeed + 3, 1);
  });
});

// ── remove / removeBySource ─────────────────────────────────────────────

describe("StatsEngine — remove", () => {
  let engine: StatsEngine;
  beforeEach(() => {
    engine = new StatsEngine();
    engine.init([entity("a")]);
  });

  it("remove by id restores stats to pre-modifier value", () => {
    const before = engine.get("a")!.derived.maxHealth;
    const modId = engine.modify("a", { stat: "maxHealth", flat: 100 })!;
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 100);

    const removed = engine.remove("a", modId);
    expect(removed).toBe(true);
    expect(engine.get("a")!.derived.maxHealth).toBe(before);
  });

  it("remove returns false for unknown modifier id", () => {
    expect(engine.remove("a", "nonexistent")).toBe(false);
  });

  it("remove returns false for unknown entity", () => {
    expect(engine.remove("nope", "any")).toBe(false);
  });

  it("removeBySource removes all modifiers from that source", () => {
    const before = engine.get("a")!.derived.maxHealth;
    engine.modify("a", { stat: "maxHealth", flat: 20, source: "buff:warCry" });
    engine.modify("a", { stat: "armor", flat: 5, source: "buff:warCry" });
    engine.modify("a", { stat: "moveSpeed", flat: 1, source: "item:boots" });

    const removed = engine.removeBySource("a", "buff:warCry");
    expect(removed).toBe(2);
    // maxHealth should be back to base (warCry removed).
    expect(engine.get("a")!.derived.maxHealth).toBe(before);
    // boots modifier should still be there.
    expect(engine.listModifiers("a").length).toBe(1);
  });

  it("removeBySource returns 0 when no modifiers match", () => {
    engine.modify("a", { stat: "maxHealth", flat: 10, source: "x" });
    expect(engine.removeBySource("a", "y")).toBe(0);
  });

  it("removeBySource returns 0 for unknown entity", () => {
    expect(engine.removeBySource("nope", "x")).toBe(0);
  });
});

// ── tick — duration expiry ──────────────────────────────────────────────

describe("StatsEngine — tick (duration expiry)", () => {
  let engine: StatsEngine;
  beforeEach(() => {
    engine = new StatsEngine();
    engine.init([entity("a")]);
  });

  it("permanent modifier (no duration) survives ticks", () => {
    const before = engine.get("a")!.derived.maxHealth;
    engine.modify("a", { stat: "maxHealth", flat: 50 });
    engine.tick(100); // 100 seconds
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 50);
  });

  it("timed modifier is removed after its duration expires", () => {
    const before = engine.get("a")!.derived.maxHealth;
    engine.modify("a", { stat: "maxHealth", flat: 50, duration: 3 });
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 50);

    engine.tick(1); // 2s left
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 50);

    engine.tick(1); // 1s left
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 50);

    engine.tick(1.1); // past duration
    expect(engine.get("a")!.derived.maxHealth).toBe(before);
    expect(engine.listModifiers("a").length).toBe(0);
  });

  it("mixed permanent + timed: only timed expires", () => {
    const before = engine.get("a")!.derived.maxHealth;
    engine.modify("a", { stat: "maxHealth", flat: 100 }); // permanent
    engine.modify("a", { stat: "maxHealth", flat: 50, duration: 1 }); // timed

    expect(engine.get("a")!.derived.maxHealth).toBe(before + 150);

    engine.tick(1.5);
    // Timed expired, permanent remains.
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 100);
    expect(engine.listModifiers("a").length).toBe(1);
  });

  it("tick with zero-length delta does not expire duration>0 modifiers", () => {
    engine.modify("a", { stat: "maxHealth", flat: 10, duration: 0.5 });
    engine.tick(0);
    expect(engine.listModifiers("a").length).toBe(1);
  });

  it("tick correctly handles multiple entities", () => {
    engine.init([entity("a"), entity("b")]);
    engine.modify("a", { stat: "maxHealth", flat: 20, duration: 1 });
    engine.modify("b", { stat: "maxHealth", flat: 30, duration: 3 });

    engine.tick(2);
    // a's modifier expired, b's still alive.
    expect(engine.listModifiers("a").length).toBe(0);
    expect(engine.listModifiers("b").length).toBe(1);
  });
});

// ── Stack enforcement ───────────────────────────────────────────────────

describe("StatsEngine — stack enforcement", () => {
  let engine: StatsEngine;
  beforeEach(() => {
    engine = new StatsEngine();
    engine.init([entity("a")]);
  });

  it("default maxStacks=1: second modifier with same stackId replaces first", () => {
    const id1 = engine.modify("a", {
      stat: "maxHealth", flat: 10, stackId: "poison",
    })!;
    const id2 = engine.modify("a", {
      stat: "maxHealth", flat: 20, stackId: "poison",
    })!;

    const mods = engine.listModifiers("a");
    expect(mods.length).toBe(1);
    expect(mods[0].id).toBe(id2);
    expect(mods[0].flat).toBe(20);
  });

  it("maxStacks=3: allows up to 3, evicts oldest on 4th", () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(engine.modify("a", {
        stat: "maxHealth", flat: 10 * (i + 1),
        stackId: "regen", maxStacks: 3,
      })!);
    }

    const mods = engine.listModifiers("a");
    expect(mods.length).toBe(3);
    // First (flat=10) should be evicted.
    expect(mods.map((m) => m.flat)).toEqual([20, 30, 40]);
  });

  it("different stackIds do not interfere", () => {
    engine.modify("a", { stat: "maxHealth", flat: 10, stackId: "fire" });
    engine.modify("a", { stat: "maxHealth", flat: 20, stackId: "ice" });
    engine.modify("a", { stat: "maxHealth", flat: 30, stackId: "fire" }); // evicts first fire

    const mods = engine.listModifiers("a");
    expect(mods.length).toBe(2);
    expect(mods.map((m) => m.stackId)).toEqual(["ice", "fire"]);
    expect(mods.map((m) => m.flat)).toEqual([20, 30]);
  });
});

// ── Dirty re-derivation ─────────────────────────────────────────────────

describe("StatsEngine — dirty re-derivation", () => {
  let engine: StatsEngine;
  beforeEach(() => {
    engine = new StatsEngine();
    engine.init([entity("a")]);
  });

  it("get() lazily re-derives after modify", () => {
    const before = engine.get("a")!.derived.maxHealth;
    engine.modify("a", { stat: "maxHealth", flat: 25 });
    // No explicit tick — get() should re-derive on access.
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 25);
  });

  it("get() lazily re-derives after remove", () => {
    const before = engine.get("a")!.derived.maxHealth;
    const id = engine.modify("a", { stat: "maxHealth", flat: 25 })!;
    expect(engine.get("a")!.derived.maxHealth).toBe(before + 25);

    engine.remove("a", id);
    expect(engine.get("a")!.derived.maxHealth).toBe(before);
  });

  it("consecutive get() calls without mutations return the same object", () => {
    const r1 = engine.get("a");
    const r2 = engine.get("a");
    // No mutation in between → same cached resolved object.
    expect(r1).toBe(r2);
  });

  it("modify invalidates the cache so next get() returns a fresh object", () => {
    const r1 = engine.get("a");
    engine.modify("a", { stat: "maxHealth", flat: 1 });
    const r2 = engine.get("a");
    expect(r1).not.toBe(r2);
  });
});

// ── toRaceStats ─────────────────────────────────────────────────────────

describe("StatsEngine — toRaceStats", () => {
  it("produces health/speed/damage from resolved derived stats", () => {
    const engine = new StatsEngine();
    engine.init([{ id: "w", stats: warrior }]);

    const rs = engine.toRaceStats("w")!;
    const resolved = engine.get("w")!;
    expect(rs.health).toBe(resolved.derived.maxHealth);
    expect(rs.speed).toBe(resolved.derived.moveSpeed);
    expect(rs.damage).toBe(resolved.derived.attackDamage);
  });

  it("reflects active modifiers", () => {
    const engine = new StatsEngine();
    engine.init([{ id: "w", stats: warrior }]);

    const before = engine.toRaceStats("w")!.health;
    engine.modify("w", { stat: "maxHealth", flat: 200 });
    expect(engine.toRaceStats("w")!.health).toBe(before + 200);
  });

  it("returns undefined for unknown entity", () => {
    const engine = new StatsEngine();
    engine.init([]);
    expect(engine.toRaceStats("nope")).toBeUndefined();
  });
});

// ── listModifiers ───────────────────────────────────────────────────────

describe("StatsEngine — listModifiers", () => {
  it("returns empty array when no modifiers are active", () => {
    const engine = new StatsEngine();
    engine.init([entity("a")]);
    expect(engine.listModifiers("a")).toEqual([]);
  });

  it("returns empty array for unknown entity", () => {
    const engine = new StatsEngine();
    expect(engine.listModifiers("nope")).toEqual([]);
  });

  it("returns all active modifiers in insertion order", () => {
    const engine = new StatsEngine();
    engine.init([entity("a")]);
    engine.modify("a", { id: "m1", stat: "maxHealth", flat: 10 });
    engine.modify("a", { id: "m2", stat: "armor", flat: 5 });
    const mods = engine.listModifiers("a");
    expect(mods.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
