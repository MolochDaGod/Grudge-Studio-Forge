import { describe, it, expect } from "vitest";
import {
  wallWithDoorway,
  archway,
  ladder,
  floorHoleRim,
  buildStructures,
} from "./structures";

describe("structure mesh kit", () => {
  let n = 0;
  const id = () => `t-${n++}`;

  it("doorwall has solid sides + empty doorway marker", () => {
    n = 0;
    const ents = wallWithDoorway(id, {
      position: [0, 0, 0],
      length: 8,
      doorwayWidth: 2,
    });
    const walls = ents.filter((e) => e.physics?.colliderType === "cuboid");
    const doorway = ents.find((e) => e.name?.includes("Doorway"));
    expect(walls.length).toBeGreaterThanOrEqual(2);
    expect(walls.every((w) => w.layer === "Terrain")).toBe(true);
    expect(doorway?.physics).toBeUndefined();
    expect(doorway?.surface).toBe("None");
  });

  it("ladder is Trigger + Climb sensor", () => {
    n = 0;
    const L = ladder(id, { position: [1, 0, 2], height: 5 });
    expect(L.layer).toBe("Trigger");
    expect(L.surface).toBe("Climb");
    expect(L.physics?.bodyType).toBe("fixed");
  });

  it("archway has open center empty", () => {
    n = 0;
    const ents = archway(id, { position: [0, 0, 0] });
    expect(ents.some((e) => e.name?.includes("Opening"))).toBe(true);
    expect(ents.filter((e) => e.physics).length).toBeGreaterThanOrEqual(3);
  });

  it("hole rim has no floor in the center", () => {
    n = 0;
    const ents = floorHoleRim(id, { position: [0, 0, 0], holeSize: [2, 2] });
    const opening = ents.find((e) => e.name?.includes("Opening"));
    expect(opening?.physics).toBeUndefined();
    expect(ents.filter((e) => e.physics).length).toBe(4);
  });

  it("buildStructures testkit returns many entities", () => {
    const ents = buildStructures("testkit", { position: [10, 0, 10] });
    expect(ents.length).toBeGreaterThan(8);
    expect(ents.some((e) => e.surface === "Climb")).toBe(true);
  });
});
