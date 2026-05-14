import { describe, expect, it } from "vitest";

import { rtsFortRoyaleScene, withIdScope } from "../builders.js";

describe("rtsFortRoyaleScene (PR-1 RTS conversion)", () => {
  const scene = withIdScope("rtsFortRoyaleScene", () => rtsFortRoyaleScene());

  it("declares the RTS gamemode and an RTS-flavored camera mode", () => {
    expect(scene.environment.gameMode).toBe("rts");
    expect(scene.environment.cameraMode).toBe("rts");
    // cameraStart must be elevated and pulled back from the player base
    // so the editor doesn't dump the user inside the town hall.
    expect(scene.environment.cameraStart!.position[1]).toBeGreaterThan(50);
  });

  it("seeds mirror bases — one town_hall + one peon + one footman per faction", () => {
    const rtsEntities = scene.entities.filter((e) => e.rts);
    const playerSide = rtsEntities.filter((e) => e.rts!.faction === "player");
    const enemySide = rtsEntities.filter((e) => e.rts!.faction === "enemy");

    expect(playerSide.filter((e) => e.rts!.building === "town_hall")).toHaveLength(1);
    expect(enemySide.filter((e) => e.rts!.building === "town_hall")).toHaveLength(1);
    expect(playerSide.filter((e) => e.rts!.unit === "peon")).toHaveLength(1);
    expect(enemySide.filter((e) => e.rts!.unit === "peon")).toHaveLength(1);
    expect(playerSide.filter((e) => e.rts!.unit === "footman")).toHaveLength(1);
    expect(enemySide.filter((e) => e.rts!.unit === "footman")).toHaveLength(1);
  });

  it("attaches rts-building to town halls so footman damage actually decrements HP", () => {
    const halls = scene.entities.filter((e) => e.rts?.building === "town_hall");
    expect(halls).toHaveLength(2);
    for (const hall of halls) {
      expect(hall.behavior).toBe("rts-building");
      expect(hall.rts!.hp).toBeGreaterThan(0);
      expect(hall.rts!.maxHp).toBe(hall.rts!.hp);
    }
  });

  it("seeds at least one gold node and one wood node as neutral resources", () => {
    const resources = scene.entities.filter((e) => e.rts?.resource);
    const gold = resources.filter((e) => e.rts!.resource!.kind === "gold");
    const wood = resources.filter((e) => e.rts!.resource!.kind === "wood");
    expect(gold.length).toBeGreaterThanOrEqual(1);
    expect(wood.length).toBeGreaterThanOrEqual(1);
    for (const r of resources) {
      expect(r.rts!.faction).toBe("neutral");
      expect(r.rts!.resource!.amount).toBeGreaterThan(0);
    }
  });

  it("includes a hidden RTSGameManager carrying the rts-gamemode behavior", () => {
    const manager = scene.entities.find((e) => e.behavior === "rts-gamemode");
    expect(manager).toBeDefined();
    expect(manager!.name).toBe("RTSGameManager");
  });

  it("seeds 3 neutral mutant creep camps (PR-1.5) — 7 mutants total guarding the POIs", () => {
    const creeps = scene.entities.filter((e) => e.rts?.unit === "creep");
    expect(creeps.length).toBe(7); // 2 + 2 + 3
    for (const c of creeps) {
      expect(c.rts!.faction).toBe("neutral");
      expect(c.behavior).toBe("rts-creep");
      expect(c.layer).toBe("NPC");
      expect(c.type).toBe("model");
      expect(c.model?.url).toBe("builtin:creature:mutant");
      expect(c.rts!.hp).toBeGreaterThan(0);
    }
    // The mid-forest camp should have 3 mutants ringing the wood node.
    const midCamp = creeps.filter((c) => c.name.startsWith("Camp_MidForest"));
    expect(midCamp.length).toBe(3);
  });

  it("bakes per-unit combat stats into entity.rts.stats for footmen", () => {
    const footmen = scene.entities.filter((e) => e.rts?.unit === "footman");
    expect(footmen).toHaveLength(2);
    for (const f of footmen) {
      expect(f.rts!.stats).toBeDefined();
      expect(f.rts!.stats!.dmg).toBeGreaterThan(0);
      expect(f.rts!.stats!.range).toBeGreaterThan(0);
      expect(f.rts!.stats!.speed).toBeGreaterThan(0);
    }
  });
});
