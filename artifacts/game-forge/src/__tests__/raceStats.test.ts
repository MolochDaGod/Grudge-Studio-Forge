import { describe, expect, it } from "vitest";
import { getRaceStats } from "@/scene/PlayRuntime";
import { RACES } from "@/lib/races";

describe("per-race stats wiring", () => {
  it("exposes every race from the catalog", () => {
    for (const r of RACES) {
      const s = getRaceStats(r.id);
      expect(s).toBeDefined();
      expect(s!.health).toBe(r.baseStats.health);
      expect(s!.speed).toBe(r.baseStats.speed);
      expect(s!.damage).toBe(r.baseStats.damage);
    }
  });

  it("returns undefined for unknown race ids", () => {
    expect(getRaceStats(undefined)).toBeUndefined();
    expect(getRaceStats("nope")).toBeUndefined();
  });
});
