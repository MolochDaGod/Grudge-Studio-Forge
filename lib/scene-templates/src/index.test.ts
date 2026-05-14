import { describe, expect, it } from "vitest";

import { SCENE_TEMPLATES, TEMPLATES_VERSION } from "./index.js";

describe("scene-templates manifest", () => {
  it("ships the curated deathmatch maps, the RTS Fort Royale, and the RPG village starter", () => {
    expect(SCENE_TEMPLATES.map((t) => t.key)).toEqual([
      "dm-cyberpunk",
      "rts-fort-royale",
      "dm-encampment",
      "rpg-village",
    ]);
  });

  it("has unique keys (object-storage filenames must not collide)", () => {
    const keys = SCENE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("each entry has a non-empty label/description and a callable builder", () => {
    for (const entry of SCENE_TEMPLATES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.build).toBe("function");
    }
  });

  it("each builder returns a scene with at least one root entity", () => {
    for (const entry of SCENE_TEMPLATES) {
      const scene = entry.build();
      expect(scene).toBeTruthy();
      expect(Array.isArray(scene.entities)).toBe(true);
      expect(scene.entities.length).toBeGreaterThan(0);
    }
  });

  it("TEMPLATES_VERSION matches the yyyymmdd.n format", () => {
    expect(TEMPLATES_VERSION).toMatch(/^\d{8}\.\d+$/);
  });
});
