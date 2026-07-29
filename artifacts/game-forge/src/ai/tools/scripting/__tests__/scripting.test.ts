import { describe, expect, it, beforeEach } from "vitest";
import { applyPatch, createTwoFilesPatch } from "diff";
import { validateScript } from "../validate";
import { SCRIPT_TEMPLATES, getTemplate } from "../templates";
import { defs, handlers, destructiveToolNames } from "../index";
import { useEditor } from "@/store/editor";
import { BUILTIN_BEHAVIORS } from "@/lib/deathmatchBehaviors";

describe("validateScript (js)", () => {
  it("accepts a well-formed script and detects exported hooks", () => {
    const code = `
      exports.start = function(entity, ctx) { ctx.state.x = 1; };
      exports.update = function(entity, ctx) { entity.position[1] += ctx.time.delta; };
    `;
    const r = validateScript("js", code);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.exports).toEqual({ start: true, update: true });
  });

  it("flags syntax errors with a message", () => {
    const r = validateScript("js", "exports.update = function(entity ctx) { };");
    expect(r.ok).toBe(false);
    expect(r.errors[0].message.length).toBeGreaterThan(0);
  });

  it("succeeds with no hooks but reports them as missing", () => {
    const r = validateScript("js", "var x = 1;");
    expect(r.ok).toBe(true);
    expect(r.exports).toEqual({ start: false, update: false });
  });
});

describe("validateScript (cs)", () => {
  it("transpiles a minimal C# script", () => {
    const r = validateScript(
      "cs",
      "public class S { public void Update(Entity entity, Context ctx) { } }",
    );
    // The transpiler is permissive; we just expect it not to throw.
    expect(r.ok).toBe(true);
  });
});

describe("patch flow (unified diff)", () => {
  const before = "exports.update = function(e, c) {\n  e.position[1] += 1;\n};\n";
  const after = "exports.update = function(e, c) {\n  e.position[1] += 2;\n};\n";

  it("createTwoFilesPatch + applyPatch roundtrips", () => {
    const patch = createTwoFilesPatch("a.js", "a.js", before, after, "before", "after");
    expect(patch).toContain("@@");
    const applied = applyPatch(before, patch);
    expect(applied).toBe(after);
  });

  it("applyPatch returns false on stale source", () => {
    const patch = createTwoFilesPatch("a.js", "a.js", before, after, "before", "after");
    const stale = "exports.update = function() { return 99; };\n";
    const result = applyPatch(stale, patch);
    expect(result).toBe(false);
  });

  it("validates the patched body before declaring success", () => {
    const patch = createTwoFilesPatch("a.js", "a.js", before, after, "before", "after");
    const next = applyPatch(before, patch);
    expect(typeof next).toBe("string");
    const v = validateScript("js", next as string);
    expect(v.ok).toBe(true);
  });
});

describe("script templates", () => {
  it("every template renders to validatable JS", () => {
    for (const tpl of SCRIPT_TEMPLATES) {
      // Blazor packs are C# markers, not JS play scripts
      if (tpl.key.startsWith("blazor-")) continue;
      const code = tpl.render({});
      const v = validateScript("js", code);
      expect(v.ok, `template ${tpl.key}: ${v.errors.map((e) => e.message).join("; ")}`).toBe(true);
    }
  });

  it("spin template responds to axis/speed params", () => {
    const code = getTemplate("spin")!.render({ axis: "x", speed: 9.5 });
    expect(code).toContain("rotation[0]");
    expect(code).toContain("9.5");
  });

  it("seek-player template embeds the target name safely", () => {
    const code = getTemplate("seek-player")!.render({ targetName: 'Bob"; evil' });
    // Name must be JSON-quoted, so the embedded quote is escaped, not raw.
    expect(code).toContain('"Bob\\"; evil"');
    const v = validateScript("js", code);
    expect(v.ok).toBe(true);
  });

  it("rejects an unknown template key via getTemplate", () => {
    expect(getTemplate("nope-not-real")).toBeUndefined();
  });

  it("pickup-trigger template wires onEnterTrigger + despawn", () => {
    const code = getTemplate("pickup-trigger")!.render({});
    expect(code).toContain("onEnterTrigger");
    expect(code).toContain("ctx.scene.despawn(entity.id)");
    expect(code).toContain('"Player"');
    const v = validateScript("js", code);
    expect(v.ok).toBe(true);
    expect(v.exports).toEqual({ start: true, update: false });
  });

  it("trigger-zone template logs both enter and exit overlaps", () => {
    const code = getTemplate("trigger-zone")!.render({ label: "lava" });
    expect(code).toContain("onEnterTrigger");
    expect(code).toContain("onExitTrigger");
    expect(code).toContain("[lava]");
    const v = validateScript("js", code);
    expect(v.ok).toBe(true);
  });

  it("pickup-trigger template embeds custom targetName/event safely", () => {
    const code = getTemplate("pickup-trigger")!.render({
      targetName: 'Hero"; evil',
      event: "coin-grab",
    });
    expect(code).toContain('"Hero\\"; evil"');
    expect(code).toContain('"coin-grab"');
    expect(validateScript("js", code).ok).toBe(true);
  });
});

// ── Behavior attach / detach tools ───────────────────────────────────────
const seedSceneWithEntity = (
  overrides: Partial<{
    behavior: string | undefined;
    layer: string | undefined;
  }> = {},
) => {
  useEditor.setState({
    sceneData: {
      entities: [
        {
          id: "coin-1",
          name: "Coin",
          type: "sphere",
          transform: {
            position: [0, 1, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          ...(overrides.layer !== undefined ? { layer: overrides.layer } : {}),
          ...(overrides.behavior !== undefined
            ? { behavior: overrides.behavior }
            : {}),
        },
      ],
      environment: {},
    },
    isDirty: false,
  } as Parameters<typeof useEditor.setState>[0]);
};

describe("attach_behavior tool", () => {
  beforeEach(() => seedSceneWithEntity({ layer: "Trigger" }));

  it("is exposed in defs / handlers and marked destructive", () => {
    expect(defs.find((d) => d.name === "attach_behavior")).toBeTruthy();
    expect(defs.find((d) => d.name === "detach_behavior")).toBeTruthy();
    expect(defs.find((d) => d.name === "list_builtin_behaviors")).toBeTruthy();
    expect(handlers.attach_behavior).toBeTypeOf("function");
    expect(handlers.detach_behavior).toBeTypeOf("function");
    expect(handlers.list_builtin_behaviors).toBeTypeOf("function");
    expect(destructiveToolNames).toContain("attach_behavior");
    expect(destructiveToolNames).toContain("detach_behavior");
  });

  it("the schema enum lists every BUILTIN_BEHAVIORS key including pickup-trigger", () => {
    const def = defs.find((d) => d.name === "attach_behavior")!;
    const enumVals = (
      (def.input_schema.properties as Record<string, { enum?: string[] }>).behavior
        .enum ?? []
    ).slice().sort();
    expect(enumVals).toEqual(Object.keys(BUILTIN_BEHAVIORS).slice().sort());
    expect(enumVals).toContain("pickup-trigger");
  });

  it("tags an entity with pickup-trigger and reports no layer hint when on Trigger", async () => {
    const r = await handlers.attach_behavior({
      entityId: "coin-1",
      behavior: "pickup-trigger",
    });
    expect(r.ok).toBe(true);
    const data = r.data as {
      entityId: string;
      behavior: string;
      previousBehavior: string | null;
      layer: string;
      hint?: string;
    };
    expect(data).toMatchObject({
      entityId: "coin-1",
      behavior: "pickup-trigger",
      previousBehavior: null,
      layer: "Trigger",
    });
    expect(data.hint).toBeUndefined();
    const ent = useEditor
      .getState()
      .sceneData.entities.find((e) => e.id === "coin-1");
    expect(ent?.behavior).toBe("pickup-trigger");
  });

  it("returns a layer hint when pickup-trigger is attached to a non-Trigger entity", async () => {
    seedSceneWithEntity({ layer: "Default" });
    const r = await handlers.attach_behavior({
      entityId: "coin-1",
      behavior: "pickup-trigger",
    });
    expect(r.ok).toBe(true);
    const data = r.data as { hint?: string; layer: string };
    expect(data.layer).toBe("Default");
    expect(data.hint).toMatch(/Trigger/);
  });

  it("rejects unknown behavior keys without mutating state", async () => {
    const r = await handlers.attach_behavior({
      entityId: "coin-1",
      behavior: "not-a-real-behavior",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown behavior/);
    const ent = useEditor
      .getState()
      .sceneData.entities.find((e) => e.id === "coin-1");
    expect(ent?.behavior).toBeUndefined();
  });

  it("errors cleanly when the entity id is unknown", async () => {
    const r = await handlers.attach_behavior({
      entityId: "missing",
      behavior: "pickup-trigger",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No entity/);
  });
});

describe("detach_behavior tool", () => {
  beforeEach(() => seedSceneWithEntity({ behavior: "pickup-trigger", layer: "Trigger" }));

  it("clears the behavior tag and reports the previous value", async () => {
    const r = await handlers.detach_behavior({ entityId: "coin-1" });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({
      entityId: "coin-1",
      previousBehavior: "pickup-trigger",
    });
    const ent = useEditor
      .getState()
      .sceneData.entities.find((e) => e.id === "coin-1");
    expect(ent?.behavior).toBeUndefined();
  });

  it("errors cleanly when the entity id is unknown", async () => {
    const r = await handlers.detach_behavior({ entityId: "missing" });
    expect(r.ok).toBe(false);
  });
});

describe("list_builtin_behaviors tool", () => {
  it("returns one row per BUILTIN_BEHAVIORS key with a description", async () => {
    const r = await handlers.list_builtin_behaviors({});
    expect(r.ok).toBe(true);
    const rows = (r.data as { behaviors: Array<{ key: string; description: string; recommendedLayer?: string }> }).behaviors;
    expect(rows.map((b) => b.key).slice().sort()).toEqual(
      Object.keys(BUILTIN_BEHAVIORS).slice().sort(),
    );
    const pickup = rows.find((b) => b.key === "pickup-trigger");
    expect(pickup?.recommendedLayer).toBe("Trigger");
    expect(pickup?.description.length).toBeGreaterThan(0);
  });
});
