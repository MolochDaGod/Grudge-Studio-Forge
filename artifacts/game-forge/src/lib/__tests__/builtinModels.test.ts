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
  it("provides idle / walk / run for every race in the catalog", () => {
    for (const r of RACES) {
      const key = `race:${r.id}`;
      const clips = BUILTIN_MODEL_CLIPS[key];
      expect(clips, `missing clip set for ${key}`).toBeDefined();
      expect(clips.idle.length, `${key} idle empty`).toBeGreaterThan(0);
      expect(clips.walk.length, `${key} walk empty`).toBeGreaterThan(0);
      expect(clips.run.length, `${key} run empty`).toBeGreaterThan(0);
    }
  });

  it("getRaceClips returns the matching set by raceId and undefined for unknown races", () => {
    const orc = getRaceClips("orc");
    expect(orc?.run).toBe(BUILTIN_MODEL_CLIPS["race:orc"].run);
    expect(getRaceClips(undefined)).toBeUndefined();
    expect(getRaceClips(null)).toBeUndefined();
    expect(getRaceClips("not-a-race")).toBeUndefined();
  });

  it("enemy-rpg behavior's embedded RACE_CLIPS table mirrors BUILTIN_MODEL_CLIPS for every race (drift guard)", () => {
    // The behavior script (`deathmatchBehaviors.ts → ENEMY_RPG`) compiles
    // through `new Function()` and can't import builtinModels — so the
    // table is duplicated inline. This test extracts the inline object
    // literal and verifies every race entry's idle/walk/run/attack clip
    // names match the canonical registry, so future edits to one side
    // can't silently drift.
    const src = BUILTIN_BEHAVIORS["enemy-rpg"];
    for (const r of RACES) {
      const canonical = BUILTIN_MODEL_CLIPS[`race:${r.id}`];
      for (const field of ["idle", "walk", "run", "attack"] as const) {
        const expected = canonical[field];
        if (!expected) continue;
        // Each entry contains all four fields on one line, e.g.
        //   warrior:       { idle: "WK_male_loco_01_idle", walk: ... }
        // Just assert the canonical clip name string appears in the
        // source — a far cheaper drift guard than hand-parsing the
        // embedded JS object.
        expect(
          src.includes(`"${expected}"`),
          `enemy-rpg RACE_CLIPS missing ${r.id}.${field}="${expected}"`,
        ).toBe(true);
      }
    }
  });
});
