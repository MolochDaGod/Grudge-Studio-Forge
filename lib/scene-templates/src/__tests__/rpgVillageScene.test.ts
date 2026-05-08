import { describe, expect, it } from "vitest";

import { rpgVillageScene, withIdScope } from "../builders.js";

const RACES = [
  "warrior",
  "dwarf",
  "frost-dwarf",
  "elf",
  "orc",
  "skeleton",
] as const;

function build() {
  return withIdScope("rpg-village", () => rpgVillageScene());
}

describe("rpgVillageScene", () => {
  it("returns a valid SceneData with at least the expected backbone entities", () => {
    const scene = build();
    expect(scene).toBeTruthy();
    expect(Array.isArray(scene.entities)).toBe(true);
    // map + ground + player + rifle + 3 friendlies + 2 enemies + sun = 10
    expect(scene.entities.length).toBeGreaterThanOrEqual(10);
    // Every entity has the required scene-schema fields.
    for (const e of scene.entities) {
      expect(typeof e.id).toBe("string");
      expect(typeof e.name).toBe("string");
      expect(typeof e.type).toBe("string");
      expect(e.transform).toBeTruthy();
    }
  });

  it("spawns one entity per race using the durable builtin:race:<id> key", () => {
    const scene = build();
    for (const race of RACES) {
      const key = `builtin:race:${race}`;
      const matches = scene.entities.filter((e) => e.model?.url === key);
      expect(matches.length, `expected exactly one entity for ${race}`).toBe(1);
    }
  });

  it("has the warrior as the third-person player", () => {
    const scene = build();
    const player = scene.entities.find((e) => e.name === "Player");
    expect(player).toBeTruthy();
    expect(player?.model?.url).toBe("builtin:race:warrior");
    expect(player?.controllerKind).toBe("thirdPerson");
  });

  it("produces deterministic entity ids across rebuilds (idempotency)", () => {
    const a = build();
    const b = build();
    expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});
