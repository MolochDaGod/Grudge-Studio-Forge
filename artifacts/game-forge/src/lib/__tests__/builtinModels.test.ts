import { describe, expect, it } from "vitest";
import {
  BUILTIN_MODEL_YAW_OFFSETS,
  BUILTIN_MODEL_CLIPS,
  getRaceClips,
  shouldShowRaceVariantMesh,
  isRaceVariantModel,
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

describe("isRaceVariantModel", () => {
  it("matches every builtin:race:<id> key for races in the catalog", () => {
    for (const r of RACES) {
      expect(isRaceVariantModel(`builtin:race:${r.id}`)).toBe(true);
    }
  });

  it("does NOT match the held-weapon keys, the legacy character key, or absolute URLs", () => {
    expect(isRaceVariantModel("builtin:race-weapon:warrior")).toBe(false);
    expect(isRaceVariantModel("builtin:character")).toBe(false);
    expect(isRaceVariantModel("builtin:rifle")).toBe(false);
    expect(isRaceVariantModel("builtin:map-encampment")).toBe(false);
    expect(isRaceVariantModel("https://cdn.example/foo.glb")).toBe(false);
    expect(isRaceVariantModel("")).toBe(false);
  });
});

describe("shouldShowRaceVariantMesh", () => {
  it("hides every mesh whose name contains weapon / shield / xtra (case-insensitive)", () => {
    const seen = new Set<string>();
    // Universal across the toon-rts pack — these prefixes appear in
    // human / dwarf / orc / undead / barbarian / elf rigs.
    expect(shouldShowRaceVariantMesh("WK_weapon_sword_A", seen)).toBe(false);
    expect(shouldShowRaceVariantMesh("DWF_weapon_axe_B", seen)).toBe(false);
    expect(shouldShowRaceVariantMesh("ELF_weapon_Bow", seen)).toBe(false);
    expect(shouldShowRaceVariantMesh("ORC_Shield_C", seen)).toBe(false);
    expect(shouldShowRaceVariantMesh("WK_Xtra_quiver", seen)).toBe(false);
    expect(shouldShowRaceVariantMesh("UD_xtra_bag", seen)).toBe(false);
  });

  it("keeps the FIRST body-part variant per category and hides the rest (deterministic GLB-order pick)", () => {
    const seen = new Set<string>();
    // Walked in the order the source GLB lists them — the warrior
    // (human.glb) emits Body_A first, then Body_B, etc.
    expect(shouldShowRaceVariantMesh("WK_Units_Body_A", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh("WK_Units_Body_B", seen)).toBe(false);
    expect(shouldShowRaceVariantMesh("WK_Units_Body_C", seen)).toBe(false);
    // Different category — head — gets its own first-keep.
    expect(shouldShowRaceVariantMesh("WK_Units_head_A", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh("WK_Units_head_B", seen)).toBe(false);
    // Arms / Legs / shoulderpads each independent.
    expect(shouldShowRaceVariantMesh("WK_Units_Arms_A", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh("WK_Units_Legs_A", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh("WK_Units_shoulderpads_A", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh("WK_Units_shoulderpads_B", seen)).toBe(false);
  });

  it("works across race prefixes (DWF / ELF / ORC / UD / BRB) using their own naming", () => {
    // Each call gets a fresh seen-set — simulating one filter pass per
    // cloned scene, the way EntityRenderer.LoadedModel uses it.
    {
      const seen = new Set<string>();
      expect(shouldShowRaceVariantMesh("DWF_Units_Body_A", seen)).toBe(true);
      expect(shouldShowRaceVariantMesh("DWF_Units_Body_E", seen)).toBe(false);
    }
    {
      const seen = new Set<string>();
      expect(shouldShowRaceVariantMesh("UD_Units_body_G", seen)).toBe(true);
      expect(shouldShowRaceVariantMesh("UD_Units_body_C", seen)).toBe(false);
    }
    {
      const seen = new Set<string>();
      expect(shouldShowRaceVariantMesh("BRB_body_A", seen)).toBe(true);
      expect(shouldShowRaceVariantMesh("BRB_body_F", seen)).toBe(false);
    }
  });

  it("keeps meshes with no recognized variant suffix (e.g. a unique skin / bone helper)", () => {
    const seen = new Set<string>();
    expect(shouldShowRaceVariantMesh("Bip001 Pelvis", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh("RootSkin", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh("", seen)).toBe(true);
    expect(shouldShowRaceVariantMesh(undefined, seen)).toBe(true);
  });
});
