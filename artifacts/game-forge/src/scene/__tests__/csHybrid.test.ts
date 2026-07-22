import { describe, expect, it } from "vitest";
import {
  blazorPackTemplateSource,
  FORGE_BUILTIN_PACKS,
  isForgeBuiltinPack,
  parseCsHybridMeta,
} from "../csHybrid";
import { getCompiledScript, projectNeedsBlazor } from "../PlayRuntime";
import type { Script } from "@workspace/api-client-react";

function fakeScript(partial: Partial<Script> & { code: string; language: Script["language"] }): Script {
  return {
    id: partial.id ?? 1,
    projectId: 1,
    name: partial.name ?? "Test",
    language: partial.language,
    code: partial.code,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("csHybrid parseCsHybridMeta", () => {
  it("defaults to transpile without directives", () => {
    const meta = parseCsHybridMeta(`
public class Foo : MonoBehaviour {
  public override void Update(float dt) { }
}
`);
    expect(meta.mode).toBe("transpile");
  });

  it("detects blazor pack directive", () => {
    const meta = parseCsHybridMeta(`// @forge-runtime: blazor
// @forge-pack: Spin
`);
    expect(meta.mode).toBe("blazor");
    expect(meta.pack).toBe("Spin");
    expect(isForgeBuiltinPack(meta.pack!)).toBe(true);
  });

  it("detects assembly base64 path", () => {
    const meta = parseCsHybridMeta(`// @forge-assembly: AAAABBBB
// @forge-runtime: blazor
`, "MyMod");
    expect(meta.mode).toBe("blazor");
    expect(meta.assemblyBase64).toBe("AAAABBBB");
  });

  it("pack alone implies blazor", () => {
    expect(parseCsHybridMeta("// @forge-pack: Bob\n").mode).toBe("blazor");
  });
});

describe("hybrid getCompiledScript routing", () => {
  it("marks blazor packs without transpile start/update", () => {
    const s = fakeScript({
      language: "cs",
      name: "SpinPack",
      code: blazorPackTemplateSource("Spin"),
    });
    const c = getCompiledScript(s);
    expect(c.blazor?.mode).toBe("blazor");
    expect(c.blazor?.pack).toBe("Spin");
    expect(c.start).toBeUndefined();
    expect(c.update).toBeUndefined();
    expect(c.error).toBeUndefined();
  });

  it("routes plain C# (no pack headers) to transpile mode, not blazor", () => {
    const s = fakeScript({
      language: "cs",
      code: `// live edit path — no @forge-pack
public class Spinny : MonoBehaviour {
  public override void Update(float deltaTime) {
    Debug.Log("tick");
  }
}`,
    });
    const c = getCompiledScript(s);
    expect(c.blazor).toBeUndefined();
    // Transpile success is best-effort on subset surface; mode must not be blazor.
    expect(c.blazor?.mode).not.toBe("blazor");
  });

  it("projectNeedsBlazor detects packs", () => {
    const scripts = [
      fakeScript({ id: 1, language: "js", code: "exports.update=function(){}" }),
      fakeScript({ id: 2, language: "cs", code: blazorPackTemplateSource("Bob") }),
    ];
    expect(projectNeedsBlazor(scripts)).toBe(true);
    expect(projectNeedsBlazor([scripts[0]!])).toBe(false);
  });

  it("lists production builtins", () => {
    expect(FORGE_BUILTIN_PACKS).toEqual(["Spin", "Bob", "Strafe"]);
  });
});

describe("blazorScriptSession pure helpers", () => {
  it("round-trips transform JSON", async () => {
    const { serializeTransform, parseTransformJson } = await import("../blazorScriptSession");
    const t = {
      position: [1, 2, 3] as [number, number, number],
      rotation: [0, 90, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const json = serializeTransform(t);
    const back = parseTransformJson(json, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(back.position).toEqual([1, 2, 3]);
    expect(back.rotation[1]).toBe(90);
  });
});
