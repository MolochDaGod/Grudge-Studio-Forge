import { describe, expect, it } from "vitest";
import { defs, handlers, destructiveToolNames } from "../index";

describe("motion tools", () => {
  it("exports matching defs/handlers", () => {
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(handlers).sort());
  });

  it("registers texture, animation, and physics tools", () => {
    const names = new Set(defs.map((d) => d.name));
    expect(names.has("set_material_map")).toBe(true);
    expect(names.has("list_animations")).toBe(true);
    expect(names.has("apply_animation")).toBe(true);
    expect(names.has("set_physics")).toBe(true);
  });

  it("marks mutating tools destructive", () => {
    expect(destructiveToolNames).toContain("set_material_map");
    expect(destructiveToolNames).toContain("set_physics");
    expect(destructiveToolNames).toContain("apply_animation");
  });

  it("list_animations returns catalog clips with playAs", async () => {
    const r = await handlers.list_animations!({});
    expect(r.ok).toBe(true);
    const data = r.data as {
      count: number;
      clips: Array<{ key: string; playAs: string }>;
      proceduralBiped: string[];
    };
    expect(data.count).toBeGreaterThan(5);
    expect(Array.isArray(data.clips)).toBe(true);
    expect(data.proceduralBiped).toContain("walk");
    const sword = data.clips.find((c) => c.key === "attack-sword");
    if (sword) expect(sword.playAs).toBe("attack");
  });

  it("set_material_map requires entityIds", async () => {
    const r = await handlers.set_material_map!({ mapUrl: "https://example.com/t.png" });
    expect(r.ok).toBe(false);
  });

  it("set_material_map accepts url+slot convenience", async () => {
    // No entities in empty store — still validates path accepts url
    const r = await handlers.set_material_map!({
      entityId: "missing-id",
      url: "https://example.com/t.png",
      slot: "mapUrl",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found|No entities/i);
  });

  it("apply_animation requires entityId", async () => {
    const r = await handlers.apply_animation!({ clip: "idle" });
    expect(r.ok).toBe(false);
  });

  it("set_physics requires entityIds", async () => {
    const r = await handlers.set_physics!({ bodyType: "dynamic" });
    expect(r.ok).toBe(false);
  });
});
