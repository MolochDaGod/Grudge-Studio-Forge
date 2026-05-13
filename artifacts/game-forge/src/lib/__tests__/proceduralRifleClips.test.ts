import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  synthesizeRifleClips,
  PROCEDURAL_RIFLE_CLIP_NAMES,
} from "../proceduralRifleClips";
import { BIPED_ANIM_PROFILES } from "../proceduralBipedAnimations";
import { WEAPON_CLIP_NAMES, pickClipName, BUILTIN_MODEL_CLIPS } from "../builtinModels";

/** Build a minimal Bip001 rig with the bones the rifle synthesizer
 *  touches. Mirror of the helper in proceduralBipedAnimations.test.ts —
 *  intentionally inlined so this file can run independently. */
function makeBipedRig(): THREE.Object3D {
  const root = new THREE.Object3D();
  const bones = [
    "Bip001 Pelvis",
    "Bip001 Spine",
    "Bip001 Neck",
    "Bip001 Head",
    "Bip001 L Clavicle",
    "Bip001 L UpperArm",
    "Bip001 L Forearm",
    "Bip001 R Clavicle",
    "Bip001 R UpperArm",
    "Bip001 R Forearm",
    "Bip001 L Thigh",
    "Bip001 L Calf",
    "Bip001 R Thigh",
    "Bip001 R Calf",
  ];
  for (const name of bones) {
    const o = new THREE.Object3D();
    o.name = name;
    root.add(o);
  }
  return root;
}

describe("synthesizeRifleClips", () => {
  it("emits the canonical rifle clip set on a Bip001 rig", () => {
    const clips = synthesizeRifleClips(makeBipedRig(), BIPED_ANIM_PROFILES.warrior);
    const names = clips.map((c) => c.name);
    expect(names).toContain(PROCEDURAL_RIFLE_CLIP_NAMES.idle);
    expect(names).toContain(PROCEDURAL_RIFLE_CLIP_NAMES.walk);
    expect(names).toContain(PROCEDURAL_RIFLE_CLIP_NAMES.run);
    expect(names).toContain(PROCEDURAL_RIFLE_CLIP_NAMES.aim);
    expect(names).toContain(PROCEDURAL_RIFLE_CLIP_NAMES.fire);
    expect(names).toContain(PROCEDURAL_RIFLE_CLIP_NAMES.reload);
  });

  it("returns an empty array for non-biped rigs (no false bindings)", () => {
    // Mirror of the same guard in synthesizeBipedClips. Non-biped
    // imports must NOT receive bogus rifle tracks targeting bones
    // they don't have.
    const root = new THREE.Object3D();
    const cube = new THREE.Object3D();
    cube.name = "Cube";
    root.add(cube);
    expect(synthesizeRifleClips(root)).toEqual([]);
  });

  it("caches per (sourceScene, profile.id) — second call returns same instances", () => {
    // Hot-path: 50 rifle-equipped enemies of one race must trigger
    // synthesis at most once per (rig, profile) pair.
    const rig = makeBipedRig();
    const a = synthesizeRifleClips(rig, BIPED_ANIM_PROFILES.warrior);
    const b = synthesizeRifleClips(rig, BIPED_ANIM_PROFILES.warrior);
    expect(a).toBe(b);
  });

  it("produces independent clip arrays per profile (per-race tuning)", () => {
    // Different profiles must NOT share clip arrays — the per-bone
    // deltas differ, so caching them under a single key would leak
    // a warrior's gait into an orc's rifle walk.
    const rig = makeBipedRig();
    const w = synthesizeRifleClips(rig, BIPED_ANIM_PROFILES.warrior);
    const o = synthesizeRifleClips(rig, BIPED_ANIM_PROFILES.orc);
    expect(w).not.toBe(o);
  });

  it("rifle clip names never collide with the unarmed biped clip names", () => {
    // EntityRenderer concatenates [biped, rifle] into a single
    // animations array — drei's useAnimations is keyed on clip.name,
    // so a name collision would mean one set silently shadows the
    // other. Enforce non-overlap.
    const rifleNames = new Set(Object.values(PROCEDURAL_RIFLE_CLIP_NAMES));
    const bipedNames = ["idle", "walk", "run", "attack", "death"];
    for (const n of bipedNames) {
      expect(rifleNames.has(n)).toBe(false);
    }
  });
});

describe("WEAPON_CLIP_NAMES parity with PROCEDURAL_RIFLE_CLIP_NAMES", () => {
  it("table in builtinModels.ts matches the synthesizer-emitted names exactly", () => {
    // Drift guard: if the synthesizer ever renames a clip but the
    // table doesn't, pickClipName() returns a name that doesn't
    // resolve to any AnimationAction and the entity silently drops
    // motion. Cheap two-way check.
    expect(WEAPON_CLIP_NAMES.rifle.idle).toBe(PROCEDURAL_RIFLE_CLIP_NAMES.idle);
    expect(WEAPON_CLIP_NAMES.rifle.walk).toBe(PROCEDURAL_RIFLE_CLIP_NAMES.walk);
    expect(WEAPON_CLIP_NAMES.rifle.run).toBe(PROCEDURAL_RIFLE_CLIP_NAMES.run);
    expect(WEAPON_CLIP_NAMES.rifle.aim).toBe(PROCEDURAL_RIFLE_CLIP_NAMES.aim);
    expect(WEAPON_CLIP_NAMES.rifle.fire).toBe(PROCEDURAL_RIFLE_CLIP_NAMES.fire);
    expect(WEAPON_CLIP_NAMES.rifle.reload).toBe(PROCEDURAL_RIFLE_CLIP_NAMES.reload);
  });
});

describe("pickClipName", () => {
  const warriorClips = BUILTIN_MODEL_CLIPS["race:warrior"];
  it("is the identity function for unarmed pose (back-compat)", () => {
    // Existing writers (CameraControllers, enemy-rpg) call this
    // unconditionally now. Unarmed entities MUST get the unmodified
    // clip name back, otherwise every existing scene breaks.
    expect(pickClipName("walk", "unarmed", warriorClips)).toBe("walk");
    expect(pickClipName("attack", "unarmed", warriorClips)).toBe("attack");
  });

  it("maps base names to weapon variants when a pose is set", () => {
    expect(pickClipName("walk", "rifle", warriorClips)).toBe("rifle_walk");
    expect(pickClipName("idle", "rifle", warriorClips)).toBe("rifle_idle");
    expect(pickClipName("attack", "rifle", warriorClips)).toBe("rifle_fire");
  });

  it("falls back to the base name when the race has no variants table", () => {
    // A race not yet wired with `weapons.rifle` (or a future custom
    // race) must not produce an undefined clip name. Falling back
    // to the unarmed base means the entity at worst plays unarmed
    // motion while equipped — visibly wrong, but never silent.
    expect(pickClipName("walk", "rifle", undefined)).toBe("walk");
    expect(pickClipName("walk", "rifle", { idle: "i", walk: "w", run: "r" })).toBe("walk");
  });

  it("falls back to the base name when the variant clip is missing", () => {
    // E.g. a race that ships rifle_idle/walk/run but no rifle_aim —
    // calling pickClipName("aim", "rifle", race) must return "aim",
    // not undefined.
    const partial = { idle: "i", walk: "w", run: "r", weapons: { rifle: { idle: "ri", walk: "rw", run: "rr" } } };
    expect(pickClipName("aim", "rifle", partial)).toBe("aim");
  });
});
