import { describe, expect, it } from "vitest";
import {
  BUILTIN_MODELS,
  BUILTIN_MODEL_YAW_OFFSETS,
  BUILTIN_MODEL_CLIPS,
  getRaceClips,
  resolveModelUrl,
  resolveBuiltinModel,
} from "../builtinModels";
import { BUILTIN_BEHAVIORS } from "../deathmatchBehaviors";
import {
  PROCEDURAL_BIPED_CLIP_NAMES,
  BIPED_ANIM_PROFILES,
  DEFAULT_BIPED_PROFILE,
  getBipedProfile,
} from "../proceduralBipedAnimations";
import { RACES } from "../races";

describe("BUILTIN_MODEL_YAW_OFFSETS", () => {
  it("registers a +π half-turn for every toon-rts race so the model faces away from the camera at rest", () => {
    for (const r of RACES) {
      const key = `race:${r.id}`;
      expect(BUILTIN_MODEL_YAW_OFFSETS[key], `missing yaw offset for ${key}`).toBe(Math.PI);
    }
  });
});

describe("RTS demo assets", () => {
  it("maps creature:mutant to a real CDN race GLB (no SPA HTML 404 path)", () => {
    const url = resolveBuiltinModel("builtin:creature:mutant");
    expect(url).toBeTruthy();
    expect(url).toMatch(/^https:\/\/assets\.grudge-studio\.com\//);
    expect(url).toMatch(/\.glb$/);
    // Must not request literal "creature:mutant.glb" which 404s and crashes demos
    expect(url).not.toContain("creature:mutant");
  });

  it("rewrites absolute broken R2 mutant URLs that older SPAs already resolved", () => {
    const broken =
      "https://assets.grudge-studio.com/builtin/creature:mutant.glb";
    const url = resolveModelUrl(broken);
    expect(url).not.toContain("creature:mutant");
    expect(url).toMatch(/\.glb$/);
    expect(url).toMatch(/^https:\/\/assets\.grudge-studio\.com\//);
  });

  it("never returns a relative SPA path for unknown builtins (would yield HTML as GLB)", () => {
    const url = resolveModelUrl("builtin:this-key-does-not-exist-xyz");
    expect(url).toMatch(/^https:\/\//);
    expect(url).not.toMatch(/index\.html/);
  });

  it("registers RTS behaviors used by rts-fort-royale", () => {
    for (const k of [
      "rts-peon",
      "rts-footman",
      "rts-archer",
      "rts-creep",
      "rts-building",
      "rts-tower",
      "gamemode-rts",
    ] as const) {
      expect(BUILTIN_BEHAVIORS[k], `missing behavior ${k}`).toBeTruthy();
      expect(BUILTIN_BEHAVIORS[k].length).toBeGreaterThan(50);
    }
  });

  it("registers CDN RTS building keys", () => {
    for (const k of [
      "rts-bldg-townhall",
      "rts-bldg-barracks",
      "rts-bldg-farm",
      "rts-tower-archer",
    ] as const) {
      expect(BUILTIN_MODELS[k], `missing model ${k}`).toMatch(/^https:\/\//);
    }
  });

  it("maps grudge6 kits to production CDN GLBs (not SPA-relative)", () => {
    for (const id of [
      "warrior",
      "dwarf",
      "frost-dwarf",
      "elf",
      "orc",
      "skeleton",
    ] as const) {
      const url = resolveBuiltinModel(`builtin:grudge6:${id}`);
      expect(url, `grudge6:${id}`).toMatch(
        /^https:\/\/assets\.grudge-studio\.com\/models\/grudge6\/races\/.+\.glb$/,
      );
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
      // Death is now a real procedural one-shot collapse pose; the
      // renderer detects this clip name and switches the action to
      // LoopOnce + clampWhenFinished so the body stays in the final
      // pose. Empty-string would silently skip the publish call site
      // in `enemy-rpg → publishClip`, so this guard catches drift.
      expect(clips.death).toBe(PROCEDURAL_BIPED_CLIP_NAMES.death);
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
    // the embedded table with the full procedural clip name set,
    // including `death` (the renderer plays this as a one-shot
    // LoopOnce + clampWhenFinished collapse pose).
    const src = BUILTIN_BEHAVIORS["enemy-rpg"];
    for (const r of RACES) {
      const keyToken = r.id.includes("-") ? `"${r.id}":` : `${r.id}:`;
      expect(
        src.includes(keyToken),
        `enemy-rpg RACE_CLIPS is missing race "${r.id}"`,
      ).toBe(true);
      // Exact-name parity: every race must point at the procedural
      // clip names. Detect a row like
      //   warrior: { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" }
      const rowRe = new RegExp(
        `${keyToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*idle:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.idle}"[^}]*walk:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.walk}"[^}]*run:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.run}"[^}]*attack:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.attack}"[^}]*death:\\s*"${PROCEDURAL_BIPED_CLIP_NAMES.death}"`,
      );
      expect(
        rowRe.test(src),
        `enemy-rpg RACE_CLIPS for "${r.id}" must use procedural clip names ${JSON.stringify(PROCEDURAL_BIPED_CLIP_NAMES)}`,
      ).toBe(true);
    }
  });
});

describe("BIPED_ANIM_PROFILES", () => {
  it("registers a per-race profile for every race in the catalog", () => {
    for (const r of RACES) {
      const p = BIPED_ANIM_PROFILES[r.id];
      expect(p, `missing biped profile for ${r.id}`).toBeDefined();
      expect(p.id).toBe(r.id);
    }
  });

  it("each profile has a positive duration and finite swing amplitudes", () => {
    for (const r of RACES) {
      const p = BIPED_ANIM_PROFILES[r.id];
      expect(p.idleDur).toBeGreaterThan(0);
      expect(p.walk.dur).toBeGreaterThan(0);
      expect(p.run.dur).toBeGreaterThan(0);
      expect(p.attack.dur).toBeGreaterThan(0);
      expect(p.run.dur).toBeLessThan(p.walk.dur); // run is faster than walk
      for (const phase of [p.walk, p.run] as const) {
        expect(Number.isFinite(phase.ampLeg)).toBe(true);
        expect(Number.isFinite(phase.ampArm)).toBe(true);
        expect(Number.isFinite(phase.ampKnee)).toBe(true);
        expect(Number.isFinite(phase.bob)).toBe(true);
      }
    }
  });

  it("races have visibly different personalities (not just clones of the default profile)", () => {
    // Loose drift guard — without this any future refactor that
    // collapses every race onto the default profile silently passes
    // typechecking + the per-race-key test above.
    const distinctWalkDurs = new Set(RACES.map((r) => BIPED_ANIM_PROFILES[r.id].walk.dur));
    const distinctAttackKinds = new Set(RACES.map((r) => BIPED_ANIM_PROFILES[r.id].attack.kind));
    expect(distinctWalkDurs.size).toBeGreaterThanOrEqual(3);
    expect(distinctAttackKinds.size).toBeGreaterThanOrEqual(3);
  });

  it("getBipedProfile falls back to DEFAULT_BIPED_PROFILE for unknown / null race ids", () => {
    expect(getBipedProfile(null)).toBe(DEFAULT_BIPED_PROFILE);
    expect(getBipedProfile(undefined)).toBe(DEFAULT_BIPED_PROFILE);
    expect(getBipedProfile("not-a-race")).toBe(DEFAULT_BIPED_PROFILE);
    expect(getBipedProfile("orc")).toBe(BIPED_ANIM_PROFILES.orc);
  });

  it("emits a death pose name in the procedural clip catalog", () => {
    expect(PROCEDURAL_BIPED_CLIP_NAMES.death).toBe("death");
  });
});
