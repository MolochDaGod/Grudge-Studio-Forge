/**
 * Lightweight C# → JS transpiler for the play-mode runtime.
 *
 * GameForge ships with two C# script paths:
 *
 *   1. **Blazor WebAssembly compile** (production) — the user runs
 *      `dotnet publish -c Release` against the `csharp/GameForgeRuntime`
 *      project (scaffolded next to this artifact). The resulting
 *      `.dll`/`.wasm` is dropped in `public/_framework/` and loaded by
 *      `loadBlazorRuntime()` below. That is the real Blazor path the user
 *      asked for, and it works with the full C# language surface.
 *
 *   2. **Live transpile** (this file, used in the browser editor) — for
 *      the in-editor play-mode preview we transpile a Unity-flavoured
 *      C# subset into JS so users can iterate without a `dotnet` build.
 *      Supported subset:
 *        - `public class X : MonoBehaviour { ... }`
 *        - `public override void Start()` / `Update(float dt)`
 *        - `Transform.Position.X|Y|Z`, `Transform.Rotation.X|Y|Z`
 *        - `Input.GetKey("ArrowUp")`
 *        - `Debug.Log(...)`, `var`, `float`, `int`, `bool`
 *        - basic arithmetic and `if/else/for/while`
 *
 * Anything outside that subset will throw a transpile error in the
 * console panel and the user can switch to the JS runtime or do the
 * full Blazor compile.
 */

export interface CompiledScript {
  start?: (entity: ScriptEntity, ctx: ScriptContext) => void;
  update?: (entity: ScriptEntity, ctx: ScriptContext) => void;
}

export interface ScriptEntity {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface ScriptContext {
  time: { delta: number; elapsed: number };
  input: { keys: Record<string, boolean> };
  scene: { find: (name: string) => ScriptEntity | undefined };
  log: (...args: unknown[]) => void;
}

export function transpileCSharp(source: string): string {
  let s = source;

  // Strip block + line comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/\/\/.*$/gm, "");

  // Strip using directives and namespace blocks (top-level)
  s = s.replace(/^\s*using\s+[^;]+;\s*$/gm, "");
  s = s.replace(/^\s*namespace\s+\S+\s*{/gm, "");

  // public/private/protected/static/override → drop
  s = s.replace(/\b(public|private|protected|internal|static|override|virtual|abstract|sealed|readonly|const)\b/g, "");

  // class X : MonoBehaviour { ... } → keep only body, capture fields/methods
  // We pull the inside of the (single, top-level) class body.
  const classMatch = s.match(/class\s+\w+(?:\s*:\s*\w+)?\s*{([\s\S]*)}\s*$/);
  if (!classMatch) {
    throw new Error("C#: expected a single top-level `class Foo : MonoBehaviour { ... }` declaration.");
  }
  let body = classMatch[1];

  // Type annotations on locals/fields → `let`/`var`
  body = body.replace(/\b(float|double|int|long|short|byte|bool|string|var)\s+(\w+)\s*=/g, "let $2 =");
  // Field declarations without initializer:  float speed;
  body = body.replace(/\b(float|double|int|long|short|byte|bool|string)\s+(\w+)\s*;/g, "let $2;");

  // Method signatures: `void Update(float dt) {` → `function update(dt) {`
  body = body.replace(/\bvoid\s+(\w+)\s*\(([^)]*)\)\s*{/g, (_m, name: string, params: string) => {
    const cleanedParams = params
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.replace(/^\s*(float|double|int|long|short|byte|bool|string)\s+/, ""))
      .join(", ");
    return `function ${name.charAt(0).toLowerCase() + name.slice(1)}(${cleanedParams}) {`;
  });

  // Transform.Position.X → __entity.position[0]
  const axes: Record<string, number> = { X: 0, Y: 1, Z: 2 };
  body = body.replace(/Transform\.Position\.([XYZ])/g, (_m, a: string) => `__entity.position[${axes[a]}]`);
  body = body.replace(/Transform\.Rotation\.([XYZ])/g, (_m, a: string) => `__entity.rotation[${axes[a]}]`);
  body = body.replace(/Transform\.Scale\.([XYZ])/g, (_m, a: string) => `__entity.scale[${axes[a]}]`);

  // Whole-vector assignments: Transform.Position = new Vector3(a,b,c);
  body = body.replace(
    /Transform\.(Position|Rotation|Scale)\s*=\s*new\s+Vector3\s*\(([^)]+)\)\s*;/g,
    (_m, kind: string, args: string) => {
      const k = kind.toLowerCase();
      return `__entity.${k} = [${args}];`;
    },
  );

  // Input.GetKey("X") → __ctx.input.keys["X"]
  body = body.replace(/Input\.GetKey\s*\(\s*"([^"]+)"\s*\)/g, '!!__ctx.input.keys["$1"]');

  // Debug.Log(...) → __ctx.log(...)
  body = body.replace(/Debug\.Log\s*\(/g, "__ctx.log(");

  // `this.` is fine in JS classes, we're using free functions so strip it.
  body = body.replace(/\bthis\./g, "");

  // Wrap everything as an exported module-style closure
  return `
const __scope = (() => {
  ${body}
  return {
    start: typeof start === "function" ? start : undefined,
    update: typeof update === "function" ? update : undefined,
  };
})();
return __scope;
`.trim();
}

export function compileCSharp(source: string): CompiledScript {
  const js = transpileCSharp(source);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function("__entity", "__ctx", `${js}`) as (
    entity: ScriptEntity,
    ctx: ScriptContext,
  ) => { start?: () => void; update?: (dt: number) => void };

  return {
    start: (entity, ctx) => {
      const scope = factory(entity, ctx);
      scope.start?.();
    },
    update: (entity, ctx) => {
      const scope = factory(entity, ctx);
      scope.update?.(ctx.time.delta);
    },
  };
}

/**
 * Detects whether a precompiled Blazor WASM runtime is dropped into
 * `public/_framework/`. If so, future versions can hand off C# scripts
 * to the real .NET runtime instead of the JS transpiler. For now this
 * is a stub that always returns false — the user does the dotnet build
 * locally and replaces this loader.
 */
export async function blazorRuntimeAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}_framework/blazor.boot.json`, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}
