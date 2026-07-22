/**
 * Lightweight C# → JS transpiler for the **hybrid** live-edit path.
 *
 * ## Canonical hybrid model (production)
 *
 * | Path | Trigger | Runtime |
 * |------|---------|---------|
 * | **Transpile** (this file) | `language: "cs"` source *without* pack headers | Unity-flavoured subset → JS |
 * | **Blazor attach/tick** | `// @forge-runtime: blazor` + `@forge-pack` / `@forge-assembly` | GameForgeRuntime.wasm |
 *
 * Built-in packs (WASM): **Spin**, **Bob**, **Strafe** — see `csHybrid.ts`.
 * Rebuild: `bash csharp/GameForgeRuntime/build.sh`
 *
 * Transpile subset:
 *   - `public class X : MonoBehaviour { ... }`
 *   - `public override void Start()` / `Update(float dt)`
 *   - `Transform.Position.X|Y|Z`, `Transform.Rotation.X|Y|Z`
 *   - `Input.GetKey("ArrowUp")`
 *   - `Debug.Log(...)`, `var`, `float`, `int`, `bool`
 *   - basic arithmetic and `if/else/for/while`
 *
 * Outside that subset → transpile error; use a prebuilt pack or JS.
 */

import type { TriggerEvent } from "./GameBus";

export type { TriggerEvent };

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
  /** Per-entity dialog line shown by the `npc-dialog` behavior. */
  npcLine?: string;
  /** Optional race id (one of the entries from the game-forge `RACES`
   *  catalog). The built-in deathmatch behaviors look this up against
   *  `ctx.races` to size max health, movement speed, and per-hit damage
   *  from the race's `baseStats`. Undefined for non-character entities. */
  raceId?: string;
  /** Built-in behavior key when set (e.g. `"rts-peon"`, `"spawnpoint"`).
   *  Surfaced so scripts can filter peers without re-reading the editor
   *  store — deathmatch + RTS behaviors depend on this. */
  behavior?: string;
}

/** Per-race tuning surfaced to scripts via {@link ScriptContext.races}.
 *  Mirrors the `baseStats` shape on the game-forge `Race` interface,
 *  decoupled here so `csTranspile` doesn't import the `lib/races`
 *  module. */
export interface RaceStats {
  health: number;
  speed: number;
  damage: number;
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

/** Script-facing handle on an agent's state machine. Backed by an
 *  `AgentActor` from `agentRuntime.ts` — the runtime keeps one per
 *  entity carrying a `navAgent` component during play mode. */
export interface AgentHandle {
  /** Current state name: idle / patrol / chase / attack / climb / swim / stuck / dead. */
  state: () => string;
  /** Animation clip name the renderer should currently be crossfading to. */
  currentClip: () => string;
  /** Convenience for `state() === "stuck"` — true while the failed-
   *  path watchdog has the agent parked. */
  isStuck: () => boolean;
  /** Drop into Patrol from any non-terminal state. */
  patrol: () => void;
  /** Pursue an entity by id (Chase). */
  chase: (targetId: string) => void;
  /** Move to either a world position OR a target entity id. The
   *  entity-id form pulls the live world position of the target each
   *  tick, so a moving target keeps the agent honest. */
  moveTo: (target: string | [number, number, number]) => void;
  /** Engage the named entity (Attack state — drives the attack clip
   *  and parks locomotion until `chase` / `moveTo` / `stop` clears
   *  it). */
  attack: (targetId: string) => void;
  /** Force a re-plan after a Stuck stall — the runtime re-samples the
   *  nearest walkable poly and bounces back into Chase. */
  replan: () => void;
  /** Stop and return to Idle. */
  stop: () => void;
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
  /** Resolved {@link MaterialKind} of the entity hit (read from the
   *  parent chain via `userData.material`). `null` for decorative
   *  non-entity meshes that have no stamp. */
  material?: string | null;
  /** Resolved Material density (kg/m³) read alongside `material`. */
  density?: number | null;
  /** Per-kind occlusion flags read alongside `material`. `null` when
   *  the hit object's chain has no material stamp; consumers may
   *  treat null as "blocking" for safety (matches how decorative
   *  static world is rendered). */
  blocksLineOfSight?: boolean | null;
  blocksProjectiles?: boolean | null;
  blocksAudio?: boolean | null;
}

/** Optional per-cast Material filter forwarded to
 *  {@link raycastEntities}. See PlayRuntime for full semantics. */
export interface MaterialRayFilter {
  requireBlocksLineOfSight?: boolean;
  requireBlocksProjectiles?: boolean;
  requireBlocksAudio?: boolean;
  kinds?: string[];
}

/** Script-facing stats API. Backed by the play-session
 *  {@link StatsEngine}; available as `ctx.stats`. */
export interface StatsContext {
  /** Get the fully-resolved stat block (attributes + derived + level).
   *  Returns `undefined` when the entity has no stats component. */
  get: (id: string) => ResolvedStatsView | undefined;
  /** Get just the base persisted component (no modifiers applied). */
  getBase: (id: string) => StatsBaseView | undefined;
  /** Add a runtime modifier. Returns the modifier id. */
  modify: (
    entityId: string,
    mod: {
      stat?: string;
      attribute?: string;
      flat?: number;
      percent?: number;
      duration?: number;
      source?: string;
      stackId?: string;
      maxStacks?: number;
    },
  ) => string | undefined;
  /** Remove a specific modifier by id. Returns true if found. */
  remove: (entityId: string, modifierId: string) => boolean;
  /** Remove all modifiers from a given source on an entity. */
  removeBySource: (entityId: string, source: string) => number;
}

/** Resolved stats view exposed to scripts — mirrors ResolvedStats from
 *  scene-schema but typed loosely so scripts don't need TS imports. */
export interface ResolvedStatsView {
  attributes: Record<string, number>;
  derived: Record<string, number>;
  level: number;
  xp: number;
}

export interface StatsBaseView {
  base: Record<string, number>;
  level: number;
  xp: number;
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
      /** Material-aware filter. e.g. a bullet check passes
       *  `{ requireBlocksProjectiles: true }` so glass / foliage /
       *  smoke don't stop the ray; an audio occlusion check passes
       *  `{ requireBlocksAudio: true }`. */
      materialFilter?: MaterialRayFilter,
    ) => RaycastHit | null;
    /** Cast a ray from the active camera through the current pointer
     *  (NDC from `ctx.input.mouse`). Used by RTS selection / ground orders.
     *  When no mesh is hit, falls back to a y=0 ground plane intersection so
     *  move-orders still land on open terrain. */
    castScreenRay: (maxDistance?: number) => RaycastHit | null;
    /** Spawn a new entity mid-play (appends to the live scene store, no undo).
     *  Returns the new entity id, or null on failure. Used by RTS production. */
    spawn: (spec: {
      name: string;
      position: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
      modelUrl?: string;
      raceId?: string;
      layer?: string;
      behavior?: string;
      tint?: string;
      parentId?: string | null;
    }) => string | null;
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
    /** Subscribe to "another body started overlapping this entity" events.
     *
     *  Fires whenever Rapier reports an intersection-enter for a sensor
     *  pair that involves this entity (typically because this entity sits
     *  on the `Trigger` / `Water` layer). Both participants of the pair
     *  receive the event with swapped identities, so a script attached to
     *  either the trigger volume OR the body that walked into it can react.
     *  Handler is replace-on-register; calling it again swaps the closure. */
    onEnterTrigger: (handler: (other: TriggerEvent) => void) => void;
    /** Inverse of {@link onEnterTrigger}. Fires once when the overlap ends. */
    onExitTrigger: (handler: (other: TriggerEvent) => void) => void;
    /** Despawn an entity from the scene mid-play (removes it from the editor
     *  store, which tears down its renderer + rigid body). Returns true if
     *  the entity existed. Useful for pickups / consumables. */
    despawn: (id: string) => boolean;
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
    /** Switch the entity's RigidBody into a free-falling ragdoll: forces
     *  it dynamic (in case it was kinematic), unlocks all rotation axes,
     *  re-enables gravity, and applies a one-shot impulse so the corpse
     *  tumbles in `direction` (which is normalized internally — pass an
     *  un-normalized killer→victim vector). The body then settles against
     *  the floor / props under regular Rapier physics. Subsequent agent
     *  FSM ticks for this id stop writing `setLinvel`, so gravity and the
     *  impulse run uncontested. The mesh's procedural death pose still
     *  plays on top — the AnimationMixer drives bones, physics drives
     *  the capsule. Returns true when an active rigid body was found.
     *  Falsy returns (no body / non-physics group) leave the entity
     *  posed by the death clip alone — the zero-physics fallback. */
    ragdoll: (
      id: string,
      direction: [number, number, number],
      force?: number,
    ) => boolean;
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
    /** Look up the per-entity nav-agent handle for an entity carrying a
     *  `navAgent` component. Returns `undefined` when the entity has no
     *  agent or play mode hasn't spawned one yet. The handle proxies
     *  the agent's XState actor with a script-friendly surface:
     *
     *  ```ts
     *  const a = ctx.scene.agent(targetId);
     *  if (a?.state() === "idle") a.chase(playerId);
     *  ```
     *
     *  Mutating calls (`patrol`, `chase`, `moveTo`, `stop`) are queued
     *  to the actor on the same frame and observed on the next. */
    agent: (id: string) => AgentHandle | undefined;
  };
  /** Navmesh query helpers, available whenever the scene has a baked
   *  navmesh (`Environment.navmeshAssetId` set). Returns `null` when
   *  the navmesh isn't loaded yet — scripts should treat that as a
   *  transient miss and fall back to direct steering. */
  nav: {
    /** Compute a corridor of waypoints between two world positions.
     *  Returns `null` when no path exists or either endpoint is
     *  off-mesh.
     *
     *  Optional `options.areaFilter` restricts pathfinding to specific
     *  Recast areas — pass e.g. `["Walk","Jump"]` to refuse routes
     *  through Swim / Climb polys, or `["Swim"]` for swim-only AI. */
    findPath: (
      start: [number, number, number],
      end: [number, number, number],
      options?: {
        areaFilter?: Array<"Walk" | "Jump" | "Climb" | "Swim" | "Dig">;
      },
    ) => [number, number, number][] | null;
    /** Snap a world position onto the nearest walkable poly. Returns
     *  `{ point, areaId }` or `null` when no poly is found within the
     *  default search extent. */
    sample: (
      position: [number, number, number],
    ) => { point: [number, number, number]; areaId: number } | null;
  };
  /** Global game event bus — used to drive the HUD (kill counter, damage flash,
   *  hit indicator, win/lose banner). */
  events: {
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => void;
  };
  /** Per-race tuning catalog keyed by race id (e.g. `"warrior"` →
   *  `{health:100, speed:5, damage:12}`). Built-in deathmatch behaviors
   *  read `ctx.races[entity.raceId]` at start to size max health and
   *  per-hit damage, and at update for movement speed. Empty when no
   *  catalog has been wired (older test harnesses) — behaviors fall
   *  back to their hardcoded constants in that case. */
  races: Record<string, RaceStats>;
  /** Per-entity stats API — read resolved stats, apply runtime modifiers
   *  (buffs/debuffs), and remove them by id or source. Available whenever
   *  the session's StatsEngine has been initialized. */
  stats: StatsContext;
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
 * Detects whether production GameForgeRuntime.wasm is served from
 * `public/_framework/` (hybrid Blazor attach/tick path).
 */
export async function blazorRuntimeAvailable(): Promise<boolean> {
  try {
    const base = import.meta.env.BASE_URL ?? "/";
    const root = base.endsWith("/") ? base : `${base}/`;
    const r = await fetch(`${root}_framework/blazor.boot.json`, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}
