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
    // map + ground + player + 3 friendlies + 2 enemies + sun = 9
    // (player-rpg is melee/interact — no rifle prop attached)
    expect(scene.entities.length).toBeGreaterThanOrEqual(9);
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

describe("rpgVillageScene cameraStart", () => {
  it("sets a behind-and-above starting view that frames the plaza on load", () => {
    const env = build().environment;
    expect(env.cameraStart).toBeDefined();
    const cs = env.cameraStart!;
    // Camera must be ABOVE the player (y high enough to see the ring
    // of NPCs) and OUTSIDE the player's collider — within sight of
    // both the friendly cluster (-X side) and the enemies (+X side).
    expect(cs.position[1]).toBeGreaterThan(2);
    expect(Math.hypot(cs.position[0], cs.position[2])).toBeGreaterThan(4);
    // Target should sit near plaza centre, NOT inside the ground (y >= 0).
    expect(cs.target[1]).toBeGreaterThanOrEqual(0);
  });
});
