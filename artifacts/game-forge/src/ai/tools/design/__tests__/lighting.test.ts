import { describe, it, expect } from "vitest";
import {
  LIGHTING_PRESETS,
  getLightingPreset,
  AUTO_LIGHTING_TAG,
} from "../lighting";

describe("lighting presets", () => {
  it("uses 'auto:lighting' as the replacement tag", () => {
    expect(AUTO_LIGHTING_TAG).toBe("auto:lighting");
  });

  it("ships the required preset ids", () => {
    const ids = new Set(LIGHTING_PRESETS.map((p) => p.id));
    for (const required of [
      "studio-3pt",
      "golden-hour",
      "night-neon",
      "overcast",
      "interior-warm",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
    expect(ids.size).toBe(LIGHTING_PRESETS.length);
  });

  it("each preset has a valid environment patch and lights", () => {
    for (const p of LIGHTING_PRESETS) {
      if (p.environment.skyColor) {
        expect(p.environment.skyColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      if (p.environment.ambientIntensity !== undefined) {
        expect(p.environment.ambientIntensity).toBeGreaterThanOrEqual(0);
      }
      for (const l of p.lights) {
        expect(l.color).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(l.intensity).toBeGreaterThan(0);
        expect(["point", "directional", "spot"]).toContain(l.kind);
      }
    }
  });

  it("at least one preset wires fog (night-neon)", () => {
    const neon = getLightingPreset("night-neon");
    expect(neon).toBeDefined();
    expect(neon!.environment.fog).toBeDefined();
    expect(neon!.environment.fog!.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("getLightingPreset returns the right entry", () => {
    expect(getLightingPreset("studio-3pt")?.name).toBe("Studio 3-Point");
    expect(getLightingPreset("nope")).toBeUndefined();
  });
});
