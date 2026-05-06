import { describe, it, expect } from "vitest";
import { spawnAgent, clipForState } from "@/scene/agentRuntime";
import { DEFAULT_NAV_AGENT } from "@workspace/scene-schema";

describe("agent FSM transitions", () => {
  it("starts in idle and walks idle → patrol → chase → stop → idle", () => {
    const a = spawnAgent({ ...DEFAULT_NAV_AGENT });
    expect(a.state()).toBe("idle");
    a.send({ type: "patrol" });
    expect(a.state()).toBe("patrol");
    a.send({ type: "chase", targetId: "enemy-1" });
    expect(a.state()).toBe("chase");
    a.send({ type: "stop" });
    expect(a.state()).toBe("idle");
    a.stop();
  });

  it("flips to climb when the surface event fires Climb while patrolling", () => {
    const a = spawnAgent({ ...DEFAULT_NAV_AGENT });
    a.send({ type: "patrol" });
    a.send({ type: "surface", surface: "Climb" });
    expect(a.state()).toBe("climb");
    a.stop();
  });

  it("flips to swim when the surface event fires Swim while patrolling", () => {
    const a = spawnAgent({ ...DEFAULT_NAV_AGENT });
    a.send({ type: "patrol" });
    a.send({ type: "surface", surface: "Swim" });
    expect(a.state()).toBe("swim");
    a.stop();
  });

  it("transitions to stuck after three consecutive pathFailed events", () => {
    const a = spawnAgent({ ...DEFAULT_NAV_AGENT });
    a.send({ type: "patrol" });
    a.send({ type: "pathFailed" });
    a.send({ type: "pathFailed" });
    expect(a.state()).toBe("patrol");
    a.send({ type: "pathFailed" });
    expect(a.state()).toBe("stuck");
    a.stop();
  });

  it("kill is terminal and reachable from any state", () => {
    const a = spawnAgent({ ...DEFAULT_NAV_AGENT });
    a.send({ type: "patrol" });
    a.send({ type: "chase", targetId: "x" });
    a.send({ type: "kill" });
    expect(a.state()).toBe("dead");
    a.stop();
  });

  it("chase accepts moveTo updates without leaving the chase state and tick yields velocity toward the destination", () => {
    const a = spawnAgent({ ...DEFAULT_NAV_AGENT });
    a.send({ type: "chase", targetId: "enemy-1" });
    a.send({ type: "moveTo", destination: [10, 0, 0] });
    expect(a.state()).toBe("chase");
    const r1 = a.tick({ position: [0, 0, 0], dt: 1 / 60 });
    expect(r1.velocity[0]).toBeGreaterThan(0);
    expect(Math.abs(r1.velocity[2])).toBeLessThan(0.001);
    // Re-target mid-chase — destination updates and locomotion follows.
    a.send({ type: "moveTo", destination: [0, 0, 10] });
    const r2 = a.tick({ position: [0, 0, 0], dt: 1 / 60 });
    expect(r2.velocity[2]).toBeGreaterThan(0);
    a.stop();
  });

  it("tick reaches the destination and reports `reached`", () => {
    const a = spawnAgent({ ...DEFAULT_NAV_AGENT });
    a.send({ type: "moveTo", destination: [0.1, 0, 0] });
    const r = a.tick({ position: [0, 0, 0], dt: 1 / 60 });
    expect(r.reached).toBe(true);
    expect(r.velocity).toEqual([0, 0, 0]);
    a.stop();
  });

  it("clipForState honors per-agent overrides", () => {
    expect(clipForState("idle")).toBe("idle");
    expect(clipForState("patrol")).toBe("walk");
    expect(clipForState("chase")).toBe("run");
    expect(clipForState("patrol", { walk: "shamble" })).toBe("shamble");
    expect(clipForState("dead", { dead: "ragdoll" })).toBe("ragdoll");
  });
});
