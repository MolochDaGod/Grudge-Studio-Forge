import { describe, expect, it } from "vitest";
import {
  normalizeCatalogClip,
  resolveClipName,
} from "../animationClipResolve";

describe("normalizeCatalogClip", () => {
  it("maps combat keys to attack", () => {
    expect(normalizeCatalogClip("attack-sword")).toBe("attack");
    expect(normalizeCatalogClip("attack-2h")).toBe("attack");
  });
  it("maps loco prefixes", () => {
    expect(normalizeCatalogClip("loco-walking")).toBe("walk");
    expect(normalizeCatalogClip("loco-running")).toBe("run");
    expect(normalizeCatalogClip("loco-idle")).toBe("idle");
  });
  it("maps hit-react", () => {
    expect(normalizeCatalogClip("hit-react")).toBe("hit");
  });
});

describe("resolveClipName", () => {
  const biped = ["idle", "walk", "run", "attack", "death", "jump"];
  const mixamo = [
    "mixamo.com|Idle",
    "mixamo.com|Walking",
    "mixamo.com|Running",
    "Sword And Shield Slash",
  ];

  it("exact match", () => {
    expect(resolveClipName("walk", biped)).toBe("walk");
  });

  it("case insensitive", () => {
    expect(resolveClipName("IDLE", biped)).toBe("idle");
  });

  it("fuzzy against Mixamo names", () => {
    expect(resolveClipName("idle", mixamo)).toBe("mixamo.com|Idle");
    expect(resolveClipName("walk", mixamo)).toBe("mixamo.com|Walking");
    expect(resolveClipName("run", mixamo)).toBe("mixamo.com|Running");
    expect(resolveClipName("attack", mixamo)).toBe("Sword And Shield Slash");
  });

  it("catalog attack-sword → attack on biped", () => {
    expect(resolveClipName("attack-sword", biped)).toBe("attack");
  });

  it("returns null when nothing matches", () => {
    expect(resolveClipName("moonwalk", biped)).toBeNull();
  });
});
