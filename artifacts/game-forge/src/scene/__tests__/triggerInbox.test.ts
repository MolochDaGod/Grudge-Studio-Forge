import { describe, expect, it, vi } from "vitest";
import { TriggerInbox, type TriggerEvent } from "../GameBus";
import { compileJsForTest, makePickupContext } from "./triggerHarness";

const ev = (id: string, name = "Player", layer = "Player"): TriggerEvent => ({
  otherId: id,
  otherName: name,
  otherLayer: layer,
});

describe("TriggerInbox", () => {
  it("delivers onEnter / onExit only to the registered entity", () => {
    const inbox = new TriggerInbox();
    const a = vi.fn();
    const b = vi.fn();
    inbox.registerEnter("a", a);
    inbox.registerExit("b", b);

    inbox.fireEnter("a", ev("p"));
    inbox.fireEnter("c", ev("p")); // no handler — silent
    inbox.fireExit("b", ev("p"));

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(ev("p"));
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("replaces the previous handler when re-registered (no duplicate fires)", () => {
    const inbox = new TriggerInbox();
    const first = vi.fn();
    const second = vi.fn();
    inbox.registerEnter("a", first);
    inbox.registerEnter("a", second);

    inbox.fireEnter("a", ev("p"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("isolates handler errors so other entities still receive their events", () => {
    const inbox = new TriggerInbox();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    inbox.registerEnter("a", () => {
      throw new Error("boom");
    });
    const safe = vi.fn();
    inbox.registerEnter("b", safe);

    inbox.fireEnter("a", ev("p"));
    inbox.fireEnter("b", ev("p"));

    expect(safe).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("clear(id) drops just that entity's handlers", () => {
    const inbox = new TriggerInbox();
    const a = vi.fn();
    const b = vi.fn();
    inbox.registerEnter("a", a);
    inbox.registerEnter("b", b);
    inbox.clear("a");

    inbox.fireEnter("a", ev("p"));
    inbox.fireEnter("b", ev("p"));

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("delivers exactly one enter and one exit per entity per overlap", () => {
    // Simulates EntityRenderer's dispatch contract: Rapier fires the
    // intersection callback on EACH body in the pair, and each body
    // dispatches ONLY to its own entity id (no mirror-firing). The two
    // participants must therefore each receive exactly one event.
    const inbox = new TriggerInbox();
    const sensorEnter = vi.fn();
    const sensorExit = vi.fn();
    const playerEnter = vi.fn();
    const playerExit = vi.fn();
    inbox.registerEnter("sensor", sensorEnter);
    inbox.registerExit("sensor", sensorExit);
    inbox.registerEnter("player", playerEnter);
    inbox.registerExit("player", playerExit);

    // Body A (the sensor) fires; payload.other is the player.
    inbox.fireEnter("sensor", ev("player", "Player", "Player"));
    // Body B (the player) fires; payload.other is the sensor.
    inbox.fireEnter("player", ev("sensor", "Pad", "Trigger"));

    expect(sensorEnter).toHaveBeenCalledTimes(1);
    expect(sensorEnter).toHaveBeenCalledWith(ev("player", "Player", "Player"));
    expect(playerEnter).toHaveBeenCalledTimes(1);
    expect(playerEnter).toHaveBeenCalledWith(ev("sensor", "Pad", "Trigger"));

    // Same arrangement for exit.
    inbox.fireExit("sensor", ev("player", "Player", "Player"));
    inbox.fireExit("player", ev("sensor", "Pad", "Trigger"));
    expect(sensorExit).toHaveBeenCalledTimes(1);
    expect(playerExit).toHaveBeenCalledTimes(1);
  });

  it("reset() drops every handler", () => {
    const inbox = new TriggerInbox();
    const h = vi.fn();
    inbox.registerEnter("a", h);
    inbox.registerExit("a", h);
    inbox.reset();

    inbox.fireEnter("a", ev("p"));
    inbox.fireExit("a", ev("p"));

    expect(h).not.toHaveBeenCalled();
  });
});

describe("pickup-trigger starter behavior", () => {
  it("despawns this entity when a Player-layer body overlaps and emits 'pickup'", () => {
    const { ctx, despawn, emit } = makePickupContext();
    const compiled = compileJsForTest(`
      exports.start = function(entity, ctx) {
        ctx.scene.onEnterTrigger(function(other) {
          var isPlayer = other.otherName === "Player" || other.otherLayer === "Player";
          if (!isPlayer) return;
          ctx.events.emit("pickup", { id: entity.id, by: other.otherId });
          ctx.scene.despawn(entity.id);
        });
      };
    `);
    compiled.start!({ id: "pickup-1", name: "Coin", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, ctx);

    // A non-Player body brushes the trigger first → ignored.
    ctx.triggers.fireEnter("pickup-1", ev("npc-1", "Goblin", "NPC"));
    expect(despawn).not.toHaveBeenCalled();

    // The Player walks in → pickup despawns and the bus event fires.
    ctx.triggers.fireEnter("pickup-1", ev("player-1", "Hero", "Player"));
    expect(emit).toHaveBeenCalledWith("pickup", { id: "pickup-1", by: "player-1" });
    expect(despawn).toHaveBeenCalledWith("pickup-1");
  });
});
