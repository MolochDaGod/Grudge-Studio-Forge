import { describe, expect, it } from "vitest";
import { applyPatch, createTwoFilesPatch } from "diff";
import { validateScript } from "../validate";
import { SCRIPT_TEMPLATES, getTemplate } from "../templates";

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
});
