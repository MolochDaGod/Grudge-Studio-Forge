import { describe, expect, it } from "vitest";
import type { SceneEntity } from "@workspace/scene-schema";
import {
  runFullSceneVerification,
  verifyCharacterAnimation,
  verifyMeshScale,
  verifyTextures,
  verifyTerrainPhysics,
} from "../sceneVerification";
import { getThreeStandards } from "../threeStandards";

const ent = (
  o: Partial<SceneEntity> & { id: string; type: SceneEntity["type"] },
): SceneEntity =>
  ({
    name: o.name ?? o.id,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    parentId: null,
    ...o,
  }) as SceneEntity;

describe("verifyMeshScale", () => {
  it("flags 100× unit bug", () => {
    const findings = verifyMeshScale([
      ent({
        id: "giant",
        type: "model",
        name: "Hero",
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [100, 100, 100],
        },
        model: { builtin: "grudge6:warrior" },
      }),
    ]);
    expect(findings.some((f) => f.rule === "scale-unit-bug-100x")).toBe(true);
  });

  it("flags weapon fitted to human height", () => {
    const findings = verifyMeshScale([
      ent({
        id: "sword",
        type: "model",
        name: "Iron Sword",
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.8, 1.8, 1.8],
        },
        model: { url: "https://assets.grudge-studio.com/models/weapons/sword.glb" },
      }),
    ]);
    expect(findings.some((f) => f.rule === "weapon-fitted-to-human-height")).toBe(
      true,
    );
  });
});

describe("verifyTextures", () => {
  it("flags meshy placeholder", () => {
    const findings = verifyTextures([
      ent({
        id: "bad",
        type: "model",
        name: "Player",
        model: { url: "https://meshy.ai/fake.glb" },
        controllerKind: "thirdPerson",
      }),
    ]);
    expect(findings.some((f) => f.rule === "texture-placeholder-host")).toBe(
      true,
    );
  });
});

describe("verifyCharacterAnimation", () => {
  it("warns dynamic player controller", () => {
    const findings = verifyCharacterAnimation([
      ent({
        id: "p",
        type: "model",
        name: "Player",
        controllerKind: "thirdPerson",
        physics: { bodyType: "dynamic", colliderType: "cuboid" },
        model: { builtin: "blake" },
      }),
    ]);
    expect(findings.some((f) => f.rule === "controller-prefer-kinematic")).toBe(
      true,
    );
  });
});

describe("verifyTerrainPhysics", () => {
  it("warns when no ground", () => {
    const findings = verifyTerrainPhysics([
      ent({ id: "box", type: "box" }),
    ]);
    expect(findings.some((f) => f.rule === "terrain-missing")).toBe(true);
  });
});

describe("runFullSceneVerification", () => {
  it("returns summary", () => {
    const r = runFullSceneVerification([
      ent({ id: "plane", type: "plane" }),
      ent({
        id: "L",
        type: "light",
        light: { kind: "directional", intensity: 1 },
      }),
    ]);
    expect(r.summary).toBeTruthy();
    expect(typeof r.ok).toBe("boolean");
  });
});

describe("getThreeStandards", () => {
  it("returns all topics", () => {
    const all = getThreeStandards("all");
    expect(all.topics).toContain("terrain");
    expect(all.topics).toContain("animation");
    expect(all.topics).toContain("identity");
    expect(all.text).toContain("RAPIER");
  });

  it("returns single topic", () => {
    const t = getThreeStandards("controller");
    expect(t.text).toContain("CCT");
  });
});
