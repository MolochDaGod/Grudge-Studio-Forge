import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveClip, unifyClips } from "../clipResolver";

const clip = (name: string) => new THREE.AnimationClip(name, 1, []);

describe("resolveClip", () => {
  it("prefers retargeted over baked over synthesized", () => {
    // Same name in all three layers — retargeted should win because
    // it's the user-authored content the project explicitly opted
    // into. Tested by identity, not value, so we know the right
    // CLIP instance is selected (not just a clip with the right name).
    const r = clip("idle");
    const b = clip("idle");
    const s = clip("idle");
    expect(resolveClip("idle", { retargeted: [r], baked: [b], synthesized: [s] })).toBe(r);
    expect(resolveClip("idle", { baked: [b], synthesized: [s] })).toBe(b);
    expect(resolveClip("idle", { baked: [], synthesized: [s] })).toBe(s);
  });

  it("returns undefined when no source has the clip", () => {
    // Caller contract — returning a junk fallback would silently
    // play the wrong animation; undefined forces the caller to
    // make a deliberate choice (skip crossfade, log, etc.).
    expect(resolveClip("rifle_aim", { baked: [clip("idle")] })).toBeUndefined();
  });

  it("ignores undefined source layers gracefully", () => {
    // The retargeted/synthesized layers are optional; baked is the
    // only required one. Missing layers must not throw.
    expect(resolveClip("idle", { baked: [clip("idle")] })).toBeDefined();
  });
});

describe("unifyClips", () => {
  it("produces a deduped array preferring earlier layers on name collision", () => {
    const r = clip("idle");
    const b = clip("idle");
    const s = clip("walk");
    const out = unifyClips({ retargeted: [r], baked: [b], synthesized: [s] });
    // Two unique names → two clips, and "idle" must be the
    // retargeted instance (priority).
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.name === "idle")).toBe(r);
    expect(out.find((c) => c.name === "walk")).toBe(s);
  });

  it("returns a fresh array (caller-safe to feed to React state)", () => {
    // unifyClips is called in render paths — handing back one of the
    // input arrays would risk downstream code mutating it and
    // confusing memoization.
    const baked = [clip("idle")];
    const out = unifyClips({ baked });
    expect(out).not.toBe(baked);
  });

  it("handles all three layers being undefined / empty without throwing", () => {
    expect(unifyClips({ baked: [] })).toEqual([]);
  });
});
