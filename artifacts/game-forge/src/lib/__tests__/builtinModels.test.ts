import { describe, expect, it } from "vitest";
import { BUILTIN_MODEL_YAW_OFFSETS, BUILTIN_MODEL_CLIPS, getRaceClips } from "../builtinModels";
import { BUILTIN_BEHAVIORS } from "../deathmatchBehaviors";
import { RACES } from "../races";

describe("BUILTIN_MODEL_YAW_OFFSETS", () => {
  it("registers a +π half-turn for every toon-rts race so the model faces away from the camera at rest", () => {
    for (const r of RACES) {
      const key = `race:${r.id}`;
      expect(BUILTIN_MODEL_YAW_OFFSETS[key], `missing yaw offset for ${key}`).toBe(Math.PI);
    }
  });
});

describe("BUILTIN_MODEL_CLIPS", () => {
  it("registers a clip set entry for every race in the catalog", () => {
    // Entry presence is what matters — the values are intentionally
    // empty strings today because the toon-rts character GLBs ship
    // with zero baked animations (verified by CDN probe). Writers
    // skip on a falsy clip name, so empty values are a safe no-op.
    for (const r of RACES) {
      const key = `race:${r.id}`;
      const clips = BUILTIN_MODEL_CLIPS[key];
      expect(clips, `missing clip set for ${key}`).toBeDefined();
      for (const field of ["idle", "walk", "run"] as const) {
        expect(typeof clips[field], `${key}.${field} should be string`).toBe("string");
      }
    }
  });

  it("getRaceClips returns the matching set by raceId and undefined for unknown races", () => {
    const orc = getRaceClips("orc");
    expect(orc).toBe(BUILTIN_MODEL_CLIPS["race:orc"]);
    expect(getRaceClips(undefined)).toBeUndefined();
    expect(getRaceClips(null)).toBeUndefined();
    expect(getRaceClips("not-a-race")).toBeUndefined();
  });

  it("enemy-rpg behavior's embedded RACE_CLIPS table covers every race id (drift guard)", () => {
    // The behavior script (`deathmatchBehaviors.ts → ENEMY_RPG`) compiles
    // through `new Function()` and can't import builtinModels — so the
    // table is duplicated inline. We can't easily eval the snippet, so
    // we sanity-check that every canonical race id appears as a key in
    // the embedded table. Once real clip names land, expand this test
    // to assert exact name parity.
    const src = BUILTIN_BEHAVIORS["enemy-rpg"];
    for (const r of RACES) {
      const keyToken = r.id.includes("-") ? `"${r.id}":` : `${r.id}:`;
      expect(
        src.includes(keyToken),
        `enemy-rpg RACE_CLIPS is missing race "${r.id}"`,
      ).toBe(true);
    }
  });
});
