import { describe, expect, it, beforeEach } from "vitest";
import {
  LAYERS,
  DEFAULT_COLLISION_MATRIX,
  DEFAULT_SENSOR_LAYERS,
  layerBit,
  layerFilterMask,
  layersCollide,
  pairKey,
  rapierCollisionGroups,
} from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";
import { defs, handlers } from "../index";

const resetScene = () => {
  useEditor.setState({
    sceneData: {
      entities: [
        {
          id: "e1",
          name: "Hero",
          type: "box",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          layer: "Player",
        },
        {
          id: "e2",
          name: "Goblin",
          type: "box",
          transform: {
            position: [1, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          layer: "NPC",
        },
        {
          id: "e3",
          name: "Coin",
          type: "sphere",
          transform: {
            position: [2, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          layer: "Item",
        },
      ],
      environment: {},
    },
    isDirty: false,
  });
};

describe("layers schema helpers", () => {
  it("includes the 10 fixed Unity-style layers in a stable order", () => {
    expect(LAYERS).toEqual([
      "Default",
      "Terrain",
      "Player",
      "NPC",
      "Item",
      "Projectile",
      "Trigger",
      "Water",
      "IgnoreRaycast",
      "UI3D",
    ]);
  });

  it("pairKey is order-insensitive", () => {
    expect(pairKey("Player", "NPC")).toBe(pairKey("NPC", "Player"));
  });

  it("layersCollide treats unspecified pairs as colliding", () => {
    expect(layersCollide(undefined, "Player", "Terrain")).toBe(true);
    expect(layersCollide({}, "Player", "Terrain")).toBe(true);
  });

  it("DEFAULT_COLLISION_MATRIX disables Item↔NPC, Projectile↔Projectile, UI3D↔*", () => {
    expect(layersCollide(DEFAULT_COLLISION_MATRIX, "Item", "NPC")).toBe(false);
    expect(layersCollide(DEFAULT_COLLISION_MATRIX, "Projectile", "Projectile")).toBe(
      false,
    );
    for (const other of LAYERS) {
      expect(layersCollide(DEFAULT_COLLISION_MATRIX, "UI3D", other)).toBe(false);
    }
  });

  it("user override beats the default", () => {
    const m = { [pairKey("Item", "NPC")]: true };
    expect(layersCollide(m, "Item", "NPC")).toBe(true);
  });

  it("layerBit assigns 1<<index bits within 16 bits", () => {
    expect(layerBit("Default")).toBe(1);
    expect(layerBit("Terrain")).toBe(2);
    expect(layerBit("UI3D")).toBe(1 << 9);
  });

  it("layerFilterMask reflects matrix toggles", () => {
    const allOn = layerFilterMask("Player", undefined);
    const off = { [pairKey("Player", "NPC")]: false };
    const masked = layerFilterMask("Player", off);
    expect(masked).toBe(allOn & ~layerBit("NPC"));
  });

  it("rapierCollisionGroups packs membership in high 16 and filter in low 16", () => {
    const groups = rapierCollisionGroups("Player", undefined);
    expect((groups >>> 16) & 0xffff).toBe(layerBit("Player"));
    expect(groups & 0xffff).toBe(layerFilterMask("Player", undefined));
  });

  it("DEFAULT_SENSOR_LAYERS marks Trigger and Water", () => {
    expect(DEFAULT_SENSOR_LAYERS).toContain("Trigger");
    expect(DEFAULT_SENSOR_LAYERS).toContain("Water");
  });
});

describe("layers AI tools", () => {
  beforeEach(resetScene);

  it("exports five tool defs with stable names", () => {
    expect(defs.map((d) => d.name).sort()).toEqual(
      [
        "find_entities_by_layer",
        "get_layer_matrix",
        "list_layers",
        "set_layer",
        "set_layer_matrix",
      ].sort(),
    );
  });

  it("list_layers returns the registry plus sensor flags", async () => {
    const r = await handlers.list_layers({});
    expect(r.ok).toBe(true);
    const data = r.data as {
      layers: { name: string; sensor: boolean }[];
      defaultSensorLayers: string[];
    };
    expect(data.layers).toHaveLength(LAYERS.length);
    const trigger = data.layers.find((l) => l.name === "Trigger")!;
    expect(trigger.sensor).toBe(true);
    expect(data.defaultSensorLayers).toContain("Water");
  });

  it("set_layer mutates one entity (array form) and returns previous values", async () => {
    const r = await handlers.set_layer({ entityIds: ["e1"], layer: "Trigger" });
    expect(r.ok).toBe(true);
    const data = r.data as {
      layer: string;
      count: number;
      updated: { id: string; previous: string }[];
    };
    expect(data.count).toBe(1);
    expect(data.layer).toBe("Trigger");
    expect(data.updated[0]).toMatchObject({ id: "e1", previous: "Player" });
    const e1 = useEditor.getState().sceneData.entities.find((e) => e.id === "e1");
    expect(e1?.layer).toBe("Trigger");
  });

  it("set_layer applies a layer to many entities in one undoable step", async () => {
    const r = await handlers.set_layer({
      entityIds: ["e1", "e2", "e3"],
      layer: "IgnoreRaycast",
    });
    expect(r.ok).toBe(true);
    const data = r.data as { count: number };
    expect(data.count).toBe(3);
    const ents = useEditor.getState().sceneData.entities;
    expect(ents.every((e) => e.layer === "IgnoreRaycast")).toBe(true);
    // Single command pushed → single Ctrl+Z reverts every entity.
    expect(useEditor.getState().commandStack.canUndo()).toBe(true);
    useEditor.getState().commandStack.undo();
    const reverted = useEditor.getState().sceneData.entities;
    expect(reverted.find((e) => e.id === "e1")?.layer).toBe("Player");
    expect(reverted.find((e) => e.id === "e2")?.layer).toBe("NPC");
    expect(reverted.find((e) => e.id === "e3")?.layer).toBe("Item");
  });

  it("set_layer reports notFound ids but still applies the rest", async () => {
    const r = await handlers.set_layer({
      entityIds: ["e1", "ghost"],
      layer: "Projectile",
    });
    expect(r.ok).toBe(true);
    const data = r.data as { count: number; notFound?: string[] };
    expect(data.count).toBe(1);
    expect(data.notFound).toEqual(["ghost"]);
  });

  it("set_layer rejects empty ids and bogus layers", async () => {
    const a = await handlers.set_layer({ entityIds: ["missing"], layer: "NPC" });
    expect(a.ok).toBe(false);
    const b = await handlers.set_layer({ entityIds: ["e1"], layer: "Bogus" });
    expect(b.ok).toBe(false);
    const c = await handlers.set_layer({ entityIds: [], layer: "NPC" });
    expect(c.ok).toBe(false);
  });

  it("set_layer_matrix toggles a pair, persists into Environment, and is undoable", async () => {
    const r = await handlers.set_layer_matrix({
      a: "Player",
      b: "NPC",
      collide: false,
    });
    expect(r.ok).toBe(true);
    const env = useEditor.getState().sceneData.environment;
    expect(env.collisionMatrix?.[pairKey("Player", "NPC")]).toBe(false);
    expect(layersCollide(env.collisionMatrix, "Player", "NPC")).toBe(false);
    // Ctrl+Z restores the pre-edit collision matrix.
    expect(useEditor.getState().commandStack.canUndo()).toBe(true);
    useEditor.getState().commandStack.undo();
    expect(
      layersCollide(
        useEditor.getState().sceneData.environment.collisionMatrix,
        "Player",
        "NPC",
      ),
    ).toBe(true);
  });

  it("get_layer_matrix returns dedupe pairs reflecting overrides", async () => {
    await handlers.set_layer_matrix({ a: "Item", b: "NPC", collide: true });
    const r = await handlers.get_layer_matrix({});
    expect(r.ok).toBe(true);
    const data = r.data as {
      pairs: { a: string; b: string; collide: boolean }[];
    };
    const overridden = data.pairs.find(
      (p) =>
        (p.a === "Item" && p.b === "NPC") || (p.a === "NPC" && p.b === "Item"),
    );
    expect(overridden?.collide).toBe(true);
  });

  it("find_entities_by_layer returns matching entities only", async () => {
    const r = await handlers.find_entities_by_layer({ layer: "NPC" });
    expect(r.ok).toBe(true);
    const data = r.data as { count: number; entities: { id: string }[] };
    expect(data.count).toBe(1);
    expect(data.entities[0].id).toBe("e2");
  });
});
