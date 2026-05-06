import { describe, expect, it } from "vitest";
import { diagnoseScene, summarizeBySeverity } from "../diagnose";
import type { SceneEntity } from "@workspace/scene-schema";

const ent = (overrides: Partial<SceneEntity> & { id: string; type: SceneEntity["type"] }): SceneEntity => ({
  id: overrides.id,
  name: overrides.name ?? overrides.id,
  type: overrides.type,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  parentId: overrides.parentId ?? null,
  ...overrides,
});

describe("diagnoseScene", () => {
  it("flags an empty scene as missing lights and ground", () => {
    const issues = diagnoseScene({ entities: [], environment: {} });
    const rules = issues.map((i) => i.rule);
    expect(rules).toContain("no-lights");
    expect(rules).toContain("no-ground");
  });

  it("reports follow-camera with no target as an error", () => {
    const issues = diagnoseScene({
      entities: [
        ent({ id: "p", type: "plane" }),
        ent({ id: "L", type: "light", light: { kind: "directional" } }),
      ],
      environment: { cameraMode: "follow", cameraTargetEntityId: null },
    });
    const e = issues.find((i) => i.rule === "follow-without-target");
    expect(e?.severity).toBe("error");
  });

  it("reports a missing camera target id as an error", () => {
    const issues = diagnoseScene({
      entities: [
        ent({ id: "p", type: "plane" }),
        ent({ id: "L", type: "light", light: { kind: "directional" } }),
      ],
      environment: { cameraMode: "follow", cameraTargetEntityId: "ghost" },
    });
    expect(issues.some((i) => i.rule === "camera-target-missing")).toBe(true);
  });

  it("flags multiple controllers", () => {
    const issues = diagnoseScene({
      entities: [
        ent({ id: "p", type: "plane" }),
        ent({ id: "L", type: "light", light: { kind: "directional" } }),
        ent({ id: "a", type: "model", controllerKind: "thirdPerson" }),
        ent({ id: "b", type: "model", controllerKind: "firstPerson" }),
      ],
      environment: {},
    });
    const m = issues.find((i) => i.rule === "multiple-players");
    expect(m).toBeDefined();
    expect(m?.entityIds).toEqual(["a", "b"]);
  });

  it("flags orphan parents and duplicate ids", () => {
    const issues = diagnoseScene({
      entities: [
        ent({ id: "p", type: "plane" }),
        ent({ id: "L", type: "light", light: { kind: "directional" } }),
        ent({ id: "x", type: "box", parentId: "missing" }),
        ent({ id: "x", type: "box" }),
      ],
      environment: {},
    });
    expect(issues.some((i) => i.rule === "duplicate-ids")).toBe(true);
    expect(issues.some((i) => i.rule === "orphan-parent")).toBe(true);
  });

  it("flags deathmatch scene missing gamemode + spawnpoint when deathmatch:true", () => {
    const issues = diagnoseScene({
      entities: [
        ent({ id: "p", type: "plane" }),
        ent({ id: "L", type: "light", light: { kind: "directional" } }),
      ],
      environment: {},
      deathmatch: true,
    });
    const rules = issues.map((i) => i.rule);
    expect(rules).toContain("deathmatch-no-gamemode");
    expect(rules).toContain("deathmatch-no-spawnpoint");
  });

  it("does not run deathmatch checks by default", () => {
    const issues = diagnoseScene({
      entities: [
        ent({ id: "p", type: "plane" }),
        ent({ id: "L", type: "light", light: { kind: "directional" } }),
      ],
      environment: {},
    });
    expect(issues.some((i) => i.rule.startsWith("deathmatch-"))).toBe(false);
  });

  it("summarizes by severity", () => {
    const counts = summarizeBySeverity([
      { rule: "a", severity: "error", message: "" },
      { rule: "b", severity: "warn", message: "" },
      { rule: "c", severity: "warn", message: "" },
      { rule: "d", severity: "info", message: "" },
    ]);
    expect(counts).toEqual({ error: 1, warn: 2, info: 1 });
  });
});
