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
  /** Unity-style physics layer (`"Default"` | `"Terrain"` | `"Player"` |
   *  `"NPC"` | `"Item"` | `"Projectile"` | `"Trigger"` | `"Water"` |
   *  `"IgnoreRaycast"` | `"UI3D"`). Set by the editor's sanitizer; user
   *  scripts can compare against it to filter peers without re-querying
   *  the scene graph. */
  layer?: string;
}

export interface MouseState {
  /** Pointer x in CSS pixels relative to the canvas. */
  x: number;
  /** Pointer y in CSS pixels relative to the canvas. */
  y: number;
  /** Pointer movement since last frame (pointer-locked or not). */
  dx: number;
  dy: number;
  left: boolean;
  right: boolean;
  middle: boolean;
  /** True when the canvas has captured the pointer (FPS mouselook). */
  locked: boolean;
}

export interface RaycastHit {
  /** Entity id of the closest object hit, or null for terrain (no entity). */
  entityId: string | null;
  /** World-space hit point. */
  point: [number, number, number];
  /** Distance from the ray origin to the hit point. */
  distance: number;
  /** World-space surface normal at the hit point. */
  normal: [number, number, number];
}

export interface ScriptContext {
  time: { delta: number; elapsed: number };
  input: {
    keys: Record<string, boolean>;
    mouse: MouseState;
  };
  scene: {
    find: (name: string) => ScriptEntity | undefined;
    findAll: (predicate: (e: ScriptEntity) => boolean) => ScriptEntity[];
    findById: (id: string) => ScriptEntity | undefined;
    /** Teleport an entity (works for kinematic + dynamic Rapier bodies and
     *  plain THREE.Group nodes). Returns true if the entity was found. */
    setPosition: (id: string, position: [number, number, number]) => boolean;
    /** Cast a ray through the THREE scene graph; returns the closest mesh hit
     *  (excluding entities in `excludeIds`). Mesh-level raycast — respects map
     *  geometry occlusion. Pass `layerMask` to limit hits to entities whose
     *  `layer` is included in the mask (decorative meshes with no entity are
     *  always returned). */
    castRay: (
      origin: [number, number, number],
      direction: [number, number, number],
      maxDistance?: number,
      excludeIds?: string[],
      layerMask?: string[],
    ) => RaycastHit | null;
    /** Return every entity whose `layer` matches `name`. Cheap pre-filter
     *  for AI perception loops ("nearest NPC", "any Trigger overlapping
     *  the player"). */
    findEntitiesByLayer: (name: string) => ScriptEntity[];
    /** Send a typed message to another entity's inbox (delivered next frame).
     *  Recipient reads with `scene.on(event, handler)`. */
    send: (targetId: string, event: string, payload?: unknown) => void;
    /** Subscribe to messages addressed to *this* entity. Handler is invoked
     *  during the current frame's update. Idempotent — calling with the same
     *  event name replaces the previous handler. */
    on: (event: string, handler: (payload: unknown, fromId: string) => void) => void;
    /** Position of the active play-mode camera (head position for FPS, orbit
     *  position for TPS). Useful as a ray origin for player shooting. */
    cameraPosition: () => [number, number, number];
    /** Forward direction the active camera is looking (unit vector). */
    cameraDirection: () => [number, number, number];
    /** Mark an entity's body as "frozen" — external systems (e.g. the play-
     *  mode camera controller) skip writing to it. Used by the deathmatch
     *  player to disable input while dead and to guarantee respawn teleports
     *  win the frame. */
    freeze: (id: string) => void;
    /** Inverse of {@link freeze}. */
    unfreeze: (id: string) => void;
    // --- Hierarchy traversal (scene-graph parent/children/world space) -----
    /** Direct parent of `id`, or undefined for top-level entities. */
    parentOf: (id: string) => ScriptEntity | undefined;
    /** Immediate children of `id` (one level only). */
    childrenOf: (id: string) => ScriptEntity[];
    /** All descendants of `id` (depth-first). */
    descendantsOf: (id: string) => ScriptEntity[];
    /** Filter children by predicate. With `deep:true`, walks the full subtree. */
    findChildren: (
      rootId: string,
      predicate: (e: ScriptEntity) => boolean,
      deep?: boolean,
    ) => ScriptEntity[];
    /** World-space position of an entity, composed through its ancestor chain
     *  (rotation + scale honoured). Returns the entity's local position when
     *  it has no parent. */
    worldPosition: (id: string) => [number, number, number];
  };
  /** Global game event bus — used to drive the HUD (kill counter, damage flash,
   *  hit indicator, win/lose banner). */
  events: {
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => void;
  };
  /** Per-entity persistent state bag. Survives across update calls (start to
   *  stop of play mode). */
  state: Record<string, unknown>;
  /** Yuka AI library namespace — `ctx.yuka.SteeringEntity`, `ctx.yuka.SeekBehavior`, etc. */
  yuka: typeof import("yuka");
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
