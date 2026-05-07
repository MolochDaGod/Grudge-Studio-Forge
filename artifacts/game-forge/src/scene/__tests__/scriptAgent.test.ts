import { describe, it, expect } from "vitest";
import { spawnAgent, type AgentActor } from "@/scene/agentRuntime";
import type { AgentHandle } from "@/scene/csTranspile";
import { DEFAULT_NAV_AGENT } from "@workspace/scene-schema";
import { compileJsForTest, makePickupContext } from "./triggerHarness";

/** Build the script-facing AgentHandle that PlayRuntime / Viewport hand
 *  to scripts via `ctx.scene.agent(id)`. Mirrors the closure in
 *  `Viewport.tsx` so this test exercises the same surface. */
function handleFor(actor: AgentActor): AgentHandle {
  return {
    state: () => actor.state(),
    currentClip: () => actor.currentClip(),
    isStuck: () => actor.isStuck(),
    patrol: () => actor.send({ type: "patrol" }),
    chase: (targetId) => actor.send({ type: "chase", targetId }),
    moveTo: (target) => {
      if (typeof target === "string") {
        actor.send({ type: "moveTo", destination: [0, 0, 0] });
      } else {
        actor.send({ type: "moveTo", destination: target });
      }
    },
    attack: (targetId) => actor.send({ type: "attack", targetId }),
    replan: () => actor.send({ type: "replan" }),
    stop: () => actor.send({ type: "stop" }),
  };
}

describe("ctx.scene.agent(id) script API", () => {
  it("a script calling scene.agent(id).chase('foo') flips the FSM into chase", () => {
    const actor = spawnAgent({ ...DEFAULT_NAV_AGENT });
    const { ctx } = makePickupContext();
    // Override the harness's no-op agent lookup with a handle bound to
    // the actor under test — the same wiring PlayRuntime's
    // `makeContext({ agentFor })` does in production.
    ctx.scene.agent = (id: string) =>
      id === "enemy-1" ? handleFor(actor) : undefined;

    const compiled = compileJsForTest(`
      exports.update = (entity, ctx) => {
        const a = ctx.scene.agent("enemy-1");
        if (a && a.state() === "idle") a.chase("foo");
      };
    `);

    const entity = {
      id: "scripted-1",
      name: "Scripted",
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };

    expect(actor.state()).toBe("idle");
    compiled.update?.(entity, ctx);
    expect(actor.state()).toBe("chase");

    actor.stop();
  });

  it("scene.agent(id) returns undefined for entities without a spawned actor", () => {
    const { ctx } = makePickupContext();
    expect(ctx.scene.agent("nope")).toBeUndefined();
  });

  it("nav.findPath / nav.sample default to null when no navmesh is loaded", () => {
    const { ctx } = makePickupContext();
    expect(ctx.nav.findPath([0, 0, 0], [1, 0, 0])).toBeNull();
    expect(ctx.nav.sample([0, 0, 0])).toBeNull();
  });
});
