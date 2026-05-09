import { describe, expect, it } from "vitest";
import { BUILTIN_MODEL_YAW_OFFSETS, BUILTIN_MODEL_CLIPS, getRaceClips } from "../builtinModels";
import { BUILTIN_BEHAVIORS } from "../deathmatchBehaviors";
import { PROCEDURAL_BIPED_CLIP_NAMES } from "../proceduralBipedAnimations";
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
  it("registers a clip set entry for every race in the catalog, pointing at the procedural-biped clip names", () => {
    // The toon-rts character GLBs ship with zero baked animations
    // (verified by CDN probe), so `LoadedModel` falls back to the
    // procedural-biped synthesizer. The names below must match what
    // that synthesizer emits — `synthesizeBipedClips` in
    // `proceduralBipedAnimations.ts` — or writes via __agentClips
    // resolve to nothing and the rig stays in T-pose.
    for (const r of RACES) {
      const key = `race:${r.id}`;
      const clips = BUILTIN_MODEL_CLIPS[key];
      expect(clips, `missing clip set for ${key}`).toBeDefined();
      expect(clips.idle).toBe(PROCEDURAL_BIPED_CLIP_NAMES.idle);
      expect(clips.walk).toBe(PROCEDURAL_BIPED_CLIP_NAMES.walk);
      expect(clips.run).toBe(PROCEDURAL_BIPED_CLIP_NAMES.run);
      expect(clips.attack).toBe(PROCEDURAL_BIPED_CLIP_NAMES.attack);
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
      // Exact-name parity: every race must point at the procedural
      // clip names. Detect a row like
      //   warrior:       { idle: "idle", walk: "walk", run: "run", attack: "attack" }
      const rowRe = new RegExp(
        `${keyToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*idle:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.idle}"[^}]*walk:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.walk}"[^}]*run:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.run}"[^}]*attack:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.attack}"`,
      );
      expect(
        rowRe.test(src),
        `enemy-rpg RACE_CLIPS for "${r.id}" must use procedural clip names ${JSON.stringify(PROCEDURAL_BIPED_CLIP_NAMES)}`,
      ).toBe(true);
    }
  });
});
