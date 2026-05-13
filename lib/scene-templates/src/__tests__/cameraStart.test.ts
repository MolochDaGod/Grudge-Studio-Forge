import { describe, expect, it } from "vitest";

import {
  cyberpunkDeathmatchScene,
  encampmentDeathmatchScene,
  deserttownDeathmatchScene,
  fortRoyaleDeathmatchScene,
  yardDeathmatchScene,
  winterBaseDeathmatchScene,
  fpsArenaScene,
  tpsZombieDemoScene,
  withIdScope,
} from "../builders.js";
import type { SceneData } from "@workspace/scene-schema";

const TEMPLATES: { name: string; build: () => SceneData; mode: "thirdPerson" | "firstPerson" }[] = [
  { name: "tps-zombie-demo", build: () => withIdScope("tpsZombieDemoScene", () => tpsZombieDemoScene()), mode: "thirdPerson" },
  { name: "fps-arena", build: () => withIdScope("fpsArenaScene", () => fpsArenaScene()), mode: "firstPerson" },
  { name: "dm-cyberpunk", build: () => withIdScope("cyberpunkDeathmatchScene", () => cyberpunkDeathmatchScene()), mode: "thirdPerson" },
  { name: "dm-encampment", build: () => withIdScope("encampmentDeathmatchScene", () => encampmentDeathmatchScene()), mode: "thirdPerson" },
  { name: "dm-deserttown", build: () => withIdScope("deserttownDeathmatchScene", () => deserttownDeathmatchScene()), mode: "thirdPerson" },
  { name: "dm-fort-royale", build: () => withIdScope("fortRoyaleDeathmatchScene", () => fortRoyaleDeathmatchScene()), mode: "thirdPerson" },
  { name: "dm-yard", build: () => withIdScope("yardDeathmatchScene", () => yardDeathmatchScene()), mode: "thirdPerson" },
  { name: "dm-winter-base", build: () => withIdScope("winterBaseDeathmatchScene", () => winterBaseDeathmatchScene()), mode: "thirdPerson" },
];

describe("cameraStart on game-mode templates", () => {
  for (const t of TEMPLATES) {
    it(`${t.name} sets cameraStart with a sensible behind/above pose`, () => {
      const env = t.build().environment;
      // Every game-mode template must publish cameraStart so the editor
      // doesn't dump the user at a stale orbit pose, AND so Play press
      // doesn't snap the camera to the default (yaw=0, pitch=0.18)
      // heading. Templates without a player camera (sandbox, showcase)
      // are intentionally excluded from this enforcement.
      expect(env.cameraStart, `${t.name} is missing cameraStart`).toBeDefined();
      const cs = env.cameraStart!;
      // Position must be elevated (above the player rig top) and at a
      // non-zero standoff so the editor camera actually sees the scene.
      expect(cs.position[1], `${t.name} camera height too low`).toBeGreaterThan(2);
      const standoff = Math.hypot(
        cs.position[0] - cs.target[0],
        cs.position[2] - cs.target[2],
      );
      expect(standoff, `${t.name} camera standoff too short`).toBeGreaterThan(3);
      // Target must sit at or above the ground plane — `target.y < 0`
      // would point the editor camera into the void / below-map.
      expect(cs.target[1], `${t.name} target below ground`).toBeGreaterThanOrEqual(0);
      // The configured camera mode must match — we don't ship FPS
      // cameraStart on a TPS template (or vice versa) by accident.
      expect(env.cameraMode).toBe(t.mode);
    });
  }
});

describe("cameraStart sanity for the deathmatch family", () => {
  it("scales standoff with the spawn radius (small maps don't get a 100m camera, big maps don't get a claustrophobic one)", () => {
    // The dm-* maps share `buildDeathmatch` which derives the camera
    // standoff from `opts.spawnRadius`. This test guards that the
    // standoff stays in proportion across the radius range we ship.
    const cyber = withIdScope("cyberpunkDeathmatchScene", () => cyberpunkDeathmatchScene()).environment.cameraStart!;
    const winter = withIdScope("winterBaseDeathmatchScene", () => winterBaseDeathmatchScene()).environment.cameraStart!;
    const cyberStandoff = Math.hypot(cyber.position[0], cyber.position[2]);
    const winterStandoff = Math.hypot(winter.position[0], winter.position[2]);
    // Both must be sensible (within an order of magnitude of each
    // other). If we ever ship a deathmatch with spawnRadius < 4 the
    // computed standoff would drop under 4 — guard for that here.
    expect(cyberStandoff).toBeGreaterThan(4);
    expect(winterStandoff).toBeGreaterThan(4);
    expect(Math.max(cyberStandoff, winterStandoff) / Math.min(cyberStandoff, winterStandoff))
      .toBeLessThan(10);
  });
});
