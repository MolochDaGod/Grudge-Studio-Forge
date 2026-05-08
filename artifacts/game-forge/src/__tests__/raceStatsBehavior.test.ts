import { describe, expect, it } from "vitest";
import { BUILTIN_BEHAVIORS } from "@/lib/deathmatchBehaviors";
import { getRaceStats } from "@/scene/PlayRuntime";
import { RACES } from "@/lib/races";

function compileBehavior(src: string): {
  start: (entity: any, ctx: any) => void;
  update: (entity: any, ctx: any) => void;
} {
  const exports: any = {};
  const fn = new Function("exports", src);
  fn(exports);
  return exports;
}

function makeCtx() {
  const races = Object.fromEntries(RACES.map((r) => [r.id, { ...r.baseStats }]));
  const noop = () => {};
  return {
    state: {} as any,
    time: { elapsed: 0, delta: 0 },
    scene: {
      on: noop,
      freeze: noop,
      unfreeze: noop,
      findAll: () => [],
      findById: () => undefined,
      cameraPosition: () => [0, 0, 0],
      cameraDirection: () => [0, 0, -1],
      castRay: () => null,
      setPosition: noop,
    },
    events: { emit: noop, on: noop },
    input: { mouse: { left: false, right: false } },
    races,
  };
}

describe("deathmatch behaviors apply per-race stats", () => {
  it("PLAYER_DEATHMATCH start uses race health + damage when raceId is set", () => {
    const player = compileBehavior(BUILTIN_BEHAVIORS["player-deathmatch"]);
    const elf = getRaceStats("elf")!;
    const orc = getRaceStats("orc")!;

    const ctxElf = makeCtx();
    player.start({ id: "p1", raceId: "elf", position: [0, 0, 0] }, ctxElf);
    expect(ctxElf.state.maxHealth).toBe(elf.health);
    expect(ctxElf.state.shotDamage).toBe(elf.damage);
    expect(ctxElf.state.health).toBe(elf.health);

    const ctxOrc = makeCtx();
    player.start({ id: "p2", raceId: "orc", position: [0, 0, 0] }, ctxOrc);
    expect(ctxOrc.state.maxHealth).toBe(orc.health);
    expect(ctxOrc.state.shotDamage).toBe(orc.damage);

    // Elf and orc should differ — proves stats are race-driven, not constant.
    expect(ctxElf.state.maxHealth).not.toBe(ctxOrc.state.maxHealth);
  });

  it("PLAYER_DEATHMATCH start falls back to defaults when raceId is absent", () => {
    const player = compileBehavior(BUILTIN_BEHAVIORS["player-deathmatch"]);
    const ctx = makeCtx();
    player.start({ id: "p3", position: [0, 0, 0] }, ctx);
    // Default health = 100 (DEFAULT_MAX_HEALTH), default damage = 25.
    expect(ctx.state.maxHealth).toBe(100);
    expect(ctx.state.shotDamage).toBe(25);
  });
});
