export * from "./layers";
export * from "./materials";
export * from "./inheritance";
import type { LayerName } from "./layers";
import { DEFAULT_SENSOR_LAYERS } from "./layers";
import type { MaterialComponent } from "./materials";

export type Vec3 = [number, number, number];

export type EntityType =
  | "box"
  | "sphere"
  | "cylinder"
  | "plane"
  | "light"
  | "camera"
  | "model"
  | "empty"
  /** Soft / dynamic material entity types — first-class citizens of the
   *  Material system. Renderer stamps a Cloth / Flag / Particles
   *  material kind by default and the dynamics scene chooses a
   *  matching primitive (a draped plane, a flagpole-mounted plane, a
   *  small sprite cloud) so the entity is visible even before a GLB
   *  is wired up. */
  | "cloth"
  | "flag"
  | "particles";

export type BodyType = "fixed" | "dynamic" | "kinematicPosition" | "kinematicVelocity";

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface PhysicsComponent {
  bodyType?: BodyType;
  /** `convex-decomp` reads V-HACD output stored alongside the GLB asset
   *  (sibling JSON of convex hull point arrays) and renders a compound
   *  collider built from those hulls — produces dynamic-friendly
   *  collisions for non-convex props that would otherwise require slow
   *  trimeshes. See `lib/colliderBaker.ts`. */
  colliderType?: "cuboid" | "ball" | "cylinder" | "trimesh" | "convex-decomp";
  mass?: number;
  restitution?: number;
  friction?: number;
  /** When `colliderType === "convex-decomp"`, points to the asset id
   *  holding the precomputed hull set (array of Vec3 vertex arrays). */
  collidersAssetId?: number;
  /** Persisted V-HACD knobs used the last time this entity's hulls were
   *  baked. Saved so the Inspector "Re-bake" button and the AI
   *  `bake_convex_hulls` tool can reproduce the same decomposition. See
   *  `lib/colliderBaker.ts → BuildHullsOptions`. */
  colliderBakeOptions?: ColliderBakeOptions;
}

/** V-HACD tuning knobs surfaced in the Inspector's advanced bake panel
 *  and accepted by the AI `bake_convex_hulls` tool. All fields are
 *  optional — unset means "use the V-HACD default". */
export interface ColliderBakeOptions {
  /** Hard cap on hull count per mesh. V-HACD default: 64. */
  maxHulls?: number;
  /** Drop hulls below this volume (m³) after decomposition. */
  minHullVolume?: number;
  /** Voxel grid resolution V-HACD uses to approximate the source mesh.
   *  Higher = finer detail and slower bake. V-HACD default: 400000. */
  voxelResolution?: number;
  /** Maximum vertices in any single output hull. V-HACD default: 64. */
  maxVerticesPerHull?: number;
  /** How V-HACD fills the voxel interior:
   *   - `flood`   — fastest, assumes a watertight closed mesh (default).
   *   - `raycast` — slower, robust for non-watertight meshes.
   *   - `surface` — treat the mesh as hollow; only the skin is decomposed.
   */
  fillMode?: "flood" | "raycast" | "surface";
}

// `MaterialComponent` is defined in ./materials and re-exported above —
// it carries `kind` (registry slot) plus per-entity visual + physical
// overrides. The legacy color/metalness/roughness/emissive fields stay
// optional so older scenes load unchanged.

export interface LightComponent {
  kind?: "point" | "directional" | "spot";
  color?: string;
  intensity?: number;
  distance?: number;
}

export interface ModelComponent {
  url?: string;
  assetId?: number;
  /** Animation clip name to play (matches THREE.AnimationClip.name). When
   *  unset, EntityRenderer auto-picks a clip preferring "idle" / "loop". */
  clip?: string;
  /** Hex color tint applied to all MeshStandard/Phong materials in the GLB
   *  (mirrors PlayerImporter's tint feature for team / variant colors). */
  tint?: string;
  /** Floating sprite label shown above the model (player name, NPC tag, etc.). */
  label?: string;
  /** When true, this entity is a *transform-only locator* mirroring a sub-node
   *  of its parent's GLB (created by the "Expose Children" action). The renderer
   *  skips loading a model for proxies — only the parent GLB renders the geometry.
   *  Proxies still expose a transform (queryable from scripts via
   *  `ctx.scene.worldPosition`) and can host their own children, scripts, and
   *  behaviors (e.g. attach `behavior:"spawnpoint"` to a `Spawn_*` proxy). */
  proxy?: boolean;
  /** Name of the GLB sub-node this proxy refers to (informational, used by the
   *  inspector and for debugging — runtime does not key off it). */
  subNode?: string;
  /** Extra Y rotation (radians) applied to the rendered GLB to compensate
   *  for asset-pack authoring conventions where "forward" is +Z instead of
   *  three.js' default -Z. Does NOT change physics or rigidbody yaw — the
   *  body still rotates to camera yaw — only the model inside the body
   *  spins by this offset. Defaults to 0; per-model defaults live in
   *  `BUILTIN_MODEL_YAW_OFFSETS` (game-forge `lib/builtinModels.ts`). */
  yawOffset?: number;
}

export type ControllerKind = "none" | "thirdPerson" | "firstPerson";

/** Multi-area surface kinds. Drives **both** pathfinding (Recast area
 *  type filtering — see {@link surfaceToAreaId}) and gameplay state
 *  (the matching `userData.surface` tag is read by spatial queries and
 *  the agent state machine, e.g. entering a `Swim` surface flips the
 *  agent into the Swim state). When a surface is set on an entity the
 *  command stack also pins the matching {@link LayerName} so the three
 *  systems (surface, layer, userData tag) move in lockstep. */
export type SurfaceKind = "Walk" | "Climb" | "Swim" | "Jump" | "Dig" | "None";

export const SURFACES: readonly SurfaceKind[] = [
  "Walk",
  "Climb",
  "Swim",
  "Jump",
  "Dig",
  "None",
] as const;

/** Recast area-type id assigned to walkable polys baked over a mesh that
 *  carries this surface. Recast reserves 0 = unwalkable; we use 1 for
 *  generic walk and increment per kind. Stable and forward-compatible:
 *  callers that bake an old scene against a new schema can still read
 *  the same id for Walk. */
export function surfaceToAreaId(s: SurfaceKind | undefined): number {
  switch (s) {
    case "Walk":
      return 1;
    case "Jump":
      return 2;
    case "Climb":
      return 3;
    case "Swim":
      return 4;
    case "Dig":
      return 5;
    default:
      return 0;
  }
}

/** Inverse of {@link surfaceToAreaId} — used by the navmesh debug
 *  overlay to colour walkable polys per area. */
export function areaIdToSurface(a: number): SurfaceKind {
  switch (a) {
    case 1:
      return "Walk";
    case 2:
      return "Jump";
    case 3:
      return "Climb";
    case 4:
      return "Swim";
    case 5:
      return "Dig";
    default:
      return "None";
  }
}

/** Surface → physics layer mapping used by the lockstep
 *  {@link SurfaceKind}/Layer/`userData.surface` writer in the editor. */
export function surfaceToLayer(s: SurfaceKind): LayerName | undefined {
  switch (s) {
    case "Walk":
    case "Jump":
    case "Climb":
    case "Dig":
      return "Terrain";
    case "Swim":
      return "Water";
    default:
      return undefined;
  }
}

/** Inverse hint — when a user assigns a layer the editor offers the
 *  matching default surface (so the three lockstep fields agree without
 *  the user touching every dropdown). */
export function layerToSurface(l: LayerName | undefined): SurfaceKind {
  switch (l) {
    case "Terrain":
      return "Walk";
    case "Water":
      return "Swim";
    default:
      return "None";
  }
}

/** Per-NPC nav-agent component. Editor renders an Inspector card; the
 *  runtime ({@link agentRuntime}) wires one XState machine per agent
 *  in play mode. `filter` is the set of surface kinds this agent can
 *  traverse (defaults to `["Walk", "Jump"]` when omitted). */
export interface NavAgentComponent {
  filter?: SurfaceKind[];
  /** Steering speed cap (m/s). Default 4. */
  speed?: number;
  /** Capsule radius used for crowd separation + path corridor width. */
  radius?: number;
  /** Capsule height — informational, surfaced to the runtime so future
   *  off-mesh links can route under-ceiling crawls. */
  height?: number;
  /** Steering acceleration (m/s²). */
  acceleration?: number;
  /** Maximum yaw rate (radians/s). */
  turnSpeed?: number;
  /** Optional explicit override map for animation clip names — keys are
   *  agent state names (idle/walk/run/climb/swim/dead). When omitted the
   *  runtime maps states to clips by convention. */
  animationClips?: Partial<Record<
    "idle" | "walk" | "run" | "climb" | "swim" | "dead",
    string
  >>;
}

export const DEFAULT_NAV_AGENT: Required<Omit<NavAgentComponent, "animationClips">> = {
  filter: ["Walk", "Jump"],
  speed: 4,
  radius: 0.4,
  height: 1.8,
  acceleration: 8,
  turnSpeed: Math.PI * 2,
};

/** Built-in deathmatch behaviors run by the script runtime in play mode.
 *  These are equivalent to attaching a pre-written script — they live in
 *  `lib/deathmatchBehaviors.ts` and are compiled through the same JS pipeline
 *  as user scripts. They run *in addition to* a user-attached `scriptId`. */
// NOTE: when adding a new BehaviorKind here, also add it to BEHAVIOR_DOCS
// in artifacts/game-forge/src/ai/tools/scripting/index.ts (exhaustive
// Record<BehaviorKind, …> — typecheck will fail otherwise) AND to
// BUILTIN_BEHAVIORS / BEHAVIOR_DEFAULT_LAYERS in deathmatchBehaviors.ts.
export type BehaviorKind =
  | "player-deathmatch"
  | "enemy-deathmatch"
  | "gamemode-deathmatch"
  | "spawnpoint"
  /** Despawns this entity the moment a `Player`-named or `Player`-layer body
   *  enters its sensor volume. Demonstrates the trigger-event API
   *  (`ctx.scene.onEnterTrigger`) and is suitable as a starter behavior on
   *  pickups, score zones, and consumables placed on the `Trigger` layer. */
  | "pickup-trigger"
  /** RPG-flavored player: short-range melee swing on LMB, "interact" event
   *  on E (for NPC dialog / pickups), health + damage HUD wiring, but NO
   *  respawn (death is permanent for the run) and NO kill-feed scoring.
   *  Companion to `enemy-rpg` for quieter adventure-style starter scenes. */
  | "player-rpg"
  /** RPG-flavored enemy: wanders peacefully, only becomes hostile after
   *  taking damage or when the player gets very close. Chases + melee
   *  attacks on aggro, drops dead permanently (no respawn). Does not emit
   *  `kill` events so the deathmatch scoreboard stays silent. */
  | "enemy-rpg"
  /** Friendly NPC dialog. Listens for the scene-level `interact` event
   *  emitted by `player-rpg` (E key); when the targeted entity id matches
   *  this entity, emits a `npcDialog` HUD event with the per-entity
   *  {@link SceneEntity.npcLine} (or a generic fallback). The HUD speech
   *  bubble in `PlayHUD` shows the line for a few seconds. */
  | "npc-dialog"
  /** RTS peon (worker). Right-click on a `resource`-tagged entity to
   *  gather; auto-shuttles between the resource and the nearest friendly
   *  `town_hall`. Deposits emit `rts:resources` events to the HUD. */
  /** RTS building (passive damage receiver). Required on town_hall and
   *  any other static building so the footman attack pipeline (`scene.send`
   *  on `damage`) actually decrements `entity.rts.hp` and fires
   *  `rts:killed` for the gamemode win/lose check. */
  | "rts-building"
  /** RTS creep (neutral leashed attacker — POI / minion camp guards).
   *  Aggros any non-neutral unit within sight; chases until pulled past
   *  `LEASH_RADIUS` from spawn, then walks home. Aggro-on-hit even
   *  when the attacker is outside sight range. */
  | "rts-creep"
  | "rts-peon"
  /** RTS combat unit (footman/archer/mage). Auto-attacks the nearest
   *  enemy-faction unit/building within sight; obeys explicit move/attack
   *  right-clicks via `rts:command` scene messages. */
  | "rts-footman"
  /** RTS gamemode manager. Seeds starting resources per faction, owns
   *  the resource counters, declares win/lose when a side's town_hall
   *  HP reaches 0. One per scene. */
  | "rts-gamemode";

// ─────────────────────────────────────────────────────────────────────────
// RTS taxonomy (PR-1: foundation for the Warcraft-2-style game mode).
// All fields are optional on SceneEntity so existing scenes are unaffected.
// ─────────────────────────────────────────────────────────────────────────

/** Which side a unit/building/resource belongs to. `neutral` is for
 *  resource nodes (gold mines, forests) and any unaligned props. */
export type Faction = "player" | "enemy" | "neutral";

/** Catalog of unit kinds. Five infantry types + three mounted variants +
 *  catapult. The mounted variants are upgrades unlocked in PR-3. */
export type UnitKind =
  | "peon"
  | "footman"
  | "archer"
  | "mage"
  | "knight"
  | "mounted_archer"
  | "mounted_mage"
  | "catapult"
  /** Neutral creep — POI / camp guard driven by the `rts-creep` behavior.
   *  Doesn't belong to either player faction; spawned by template builders
   *  to gate access to gold mines / forest patches. */
  | "creep";

/** Catalog of building kinds. Maps to the five building types the user
 *  asked for plus the central town_hall. */
export type BuildingKind =
  | "town_hall"
  | "barracks"
  | "tower"
  | "blacksmith"
  | "archery"
  | "mage_hall";

/** Harvestable resource kinds. */
export type ResourceKind = "gold" | "wood";

/** RTS component attached to units, buildings, and resource nodes. All
 *  inner fields are optional — a unit fills `unit`, a building fills
 *  `building`, a resource node fills `resource`. */
export interface RTSComponent {
  faction: Faction;
  /** Set on units. */
  unit?: UnitKind;
  /** Set on buildings. */
  building?: BuildingKind;
  /** Set on resource nodes (gold mine, forest). `amount` is the remaining
   *  reserves; once 0 the node despawns. */
  resource?: { kind: ResourceKind; amount: number };
  /** Current HP. Defaults to `maxHp` on spawn. */
  hp: number;
  /** Maximum HP — drives the health bar fill. */
  maxHp: number;
  /** Set on peons while they're carrying a load home. */
  carrying?: { kind: ResourceKind; amount: number };
  /** Combat stats baked in by the template builder (resolved through
   *  RACE_LOADOUTS at template-build time). Read by `rts-footman` so
   *  the script doesn't need to import the game-forge race catalog. */
  stats?: { dmg: number; range: number; speed: number };
}

export interface SceneEntity {
  id: string;
  name: string;
  type: EntityType;
  transform: Transform;
  physics?: PhysicsComponent;
  material?: MaterialComponent;
  light?: LightComponent;
  model?: ModelComponent;
  scriptId?: number | null;
  /** Built-in behavior — see {@link BehaviorKind}. */
  behavior?: BehaviorKind;
  /** Per-entity dialog line shown by the `npc-dialog` behavior when the
   *  player presses E nearby. Ignored by other behaviors. */
  npcLine?: string;
  /** Optional race id (one of the entries from the game-forge `RACES`
   *  catalog — e.g. `"warrior"`, `"orc"`, `"skeleton"`). When set, the
   *  built-in deathmatch behaviors and the play-mode camera controller
   *  read the matching `baseStats` (max health, movement speed, per-hit
   *  damage) so race choice actually affects gameplay instead of being
   *  cosmetic. Stored as a free-form string here to keep `scene-schema`
   *  decoupled from the game-forge artifact's race catalog. */
  raceId?: string;
  /** Mark this entity as the player. The active camera controller will move it
   *  in play mode (WASD + mouselook for FPS / orbit for TPS). */
  controllerKind?: ControllerKind;
  /** Parent entity id for the scene hierarchy (null/undefined → root). Children
   *  inherit their parent's transform in edit mode; in play mode physics-enabled
   *  bodies stay world-space (rapier RigidBody owns its transform). */
  parentId?: string | null;
  /** When this entity was instantiated from a Prefab, this is the prefab id. */
  prefabId?: number | null;
  /** UI: collapsed in the hierarchy panel. */
  collapsed?: boolean;
  /** Unity-style physics layer. Drives Rapier `collisionGroups` plus the
   *  global `Environment.collisionMatrix`. Defaults to `"Default"` when
   *  unset; the editor's loader runs an inference pass to upgrade Map /
   *  player / enemy / spawnpoint entities to more specific layers. */
  layer?: LayerName;
  /** Multi-area surface tag. Drives Recast area-type filtering during
   *  navmesh bake AND the agent state machine's surface-driven
   *  transitions. Setting this through `cmdSetEntitySurface` also pins
   *  the matching {@link LayerName} so the editor's three signals stay
   *  in lockstep. Inferred from layer when unset (Terrain → Walk,
   *  Water → Swim) without overwriting an explicit value. */
  surface?: SurfaceKind;
  /** Optional nav-agent component. When set + the entity is in play
   *  mode, the agent runtime instantiates one XState machine to drive
   *  it (idle/patrol/chase/climb/swim/stuck/dead). */
  navAgent?: NavAgentComponent;
  /** One-shot flag: after the entity mounts, raycast straight down
   *  against scene meshes tagged `userData.surface === "Walk"` and snap
   *  the entity's Y position to the hit point — then clear this flag.
   *  Set by scene-template authors so characters don't spawn floating
   *  above (or buried under) a map at non-trivial scale. Honored by
   *  EntityRenderer's `LoadedModel` after the GLB has loaded so the
   *  raycast hits the real visible geometry, not a not-yet-mounted
   *  stand-in. */
  pendingTerrainSnap?: boolean;
  /** Per-entity soft-body / particle tuning consumed by the verlet
   *  simulation in `EntityRenderer` for `cloth` / `flag` / `particles`
   *  types. All fields optional — sensible per-type defaults are
   *  applied when unset. See {@link SoftBodyComponent}. */
  softBody?: SoftBodyComponent;
  /** RTS component (faction, unit/building/resource role, HP, carry).
   *  Set on RTS-template entities; ignored by other gamemodes. */
  rts?: RTSComponent;
}

/** Tuning knobs for the lightweight verlet / particle simulation that
 *  drives `cloth` / `flag` / `particles` entities. The simulation is
 *  CPU-side (not Rapier soft-body) and runs both in edit and play mode
 *  so the user can preview the motion as they place the entity. */
export interface SoftBodyComponent {
  /** Per-step velocity damping (0…1, applied each tick). Higher =
   *  drag-heavier, lazier motion. Falls back to `material.drag`
   *  resolved from the kind defaults (Cloth 0.6, Flag 0.4, Particle
   *  0.2) when unset. */
  damping?: number;
  /** Particles only — emit rate in particles/second. Default 20. */
  emitRate?: number;
  /** Particles only — per-particle lifetime in seconds. Default 2. */
  lifetime?: number;
  /** Particles only — initial vertical velocity (m/s, +Y is up).
   *  Positive values produce a smoke-plume; negative looks like
   *  falling debris. Default 1.5. */
  emitVelocity?: number;
  /** Cloth/Flag — verlet grid resolution in the X direction
   *  (segments along width). Default 10 for cloth, 12 for flag. */
  segmentsX?: number;
  /** Cloth/Flag — verlet grid resolution in the Y direction
   *  (segments along height). Default 10 for cloth, 8 for flag. */
  segmentsY?: number;
  /** Cloth pinning. `topCorners` (default) hangs the cloth from its
   *  two top corners (drape over a box / hammock look); `topEdge`
   *  pins the entire top edge (curtain / banner); `none` lets the
   *  cloth fall freely. */
  pin?: "topCorners" | "topEdge" | "none";
  /** Particles emit mode. `continuous` (default) uses {@link emitRate}
   *  to spawn a steady stream. `burst` releases {@link burstCount}
   *  particles every {@link burstInterval} seconds — handy for puff
   *  effects, magic spell flashes, or one-shot impact sparks. */
  mode?: "continuous" | "burst";
  /** Particles burst-mode — particles released per burst. Default 30. */
  burstCount?: number;
  /** Particles burst-mode — seconds between bursts. Default 1. Set
   *  high (e.g. 9999) for an effective one-shot emitter. */
  burstInterval?: number;
  /** Particles only — when true, particles collide with nearby static
   *  scene colliders (boxes / spheres / planes) and slide along the
   *  contact surface. Cheap AABB/sphere approximation, off by default
   *  so existing puff/spark emitters don't change behavior. */
  collideGround?: boolean;
  /** Particles only — bounciness on contact (0…1). 0 zeroes the inward
   *  velocity component (slide along the surface). > 0 reflects the
   *  inward component scaled by this factor (sparks bouncing, rubber
   *  debris). Falls back to the entity's Material kind restitution
   *  when unset (Stone hard, Cloth soft, Particle ~0.2). */
  bounciness?: number;
}

export type CameraMode = "editor" | "rts" | "thirdPerson" | "firstPerson";

export interface Environment {
  skyColor?: string;
  groundColor?: string;
  ambientIntensity?: number;
  sunIntensity?: number;
  gravity?: Vec3;
  /** Active camera controller used in Play Mode. Editor uses orbit always. */
  cameraMode?: CameraMode;
  /** Entity id the play-mode camera should follow (TPS/FPS/RTS focus). */
  cameraTargetEntityId?: string | null;
  /** Template-recommended starting view, applied once when the scene
   *  loads. Snaps the editor's free-orbit camera to (position → target)
   *  and seeds the play-mode controllers' initial yaw / pitch / distance
   *  so pressing Play doesn't fling the camera to a random heading.
   *  After the user starts orbiting / mouselooking the controllers
   *  resume normal behavior — `cameraStart` only fires on the FIRST
   *  frame of each scene load. Both vectors are world-space. */
  cameraStart?: { position: Vec3; target: Vec3 };
  /** Player movement speed in m/s (WASD). */
  playerMoveSpeed?: number;
  /** Mouselook sensitivity (radians per pixel, default 0.0025). */
  mouseSensitivity?: number;
  /** Game mode driving the play HUD. `deathmatch` shows the kill counter,
   *  damage flash, hit indicators, respawn timer, win/lose banner. */
  gameMode?: "sandbox" | "deathmatch" | "rts";
  /** Deathmatch: score required to win (default 10). */
  scoreLimit?: number;
  /** Deathmatch: respawn delay in seconds (default 5). */
  respawnDelay?: number;
  /** Optional linear fog. When unset the viewport falls back to fogging
   *  with the sky color over a long range. AI lighting presets set this
   *  so a "neon night" feels misty without changing the sky. */
  fog?: {
    color?: string;
    /** World-space distance where fog starts (default ~80). */
    near?: number;
    /** World-space distance where fog reaches full density (default ~320). */
    far?: number;
  };
  /** Layer-vs-layer collision matrix. Sparse — missing entries fall back
   *  to {@link DEFAULT_COLLISION_MATRIX}. Pair keys are alphabetically
   *  sorted ("Player|Trigger", never "Trigger|Player"). */
  collisionMatrix?: Partial<Record<`${LayerName}|${LayerName}`, boolean>>;
  /** Layers spawned as Rapier sensors (no contact response, intersection
   *  events only). Defaults to {@link DEFAULT_SENSOR_LAYERS}. */
  sensorLayers?: LayerName[];
  /** Asset id for the baked Recast navmesh blob (a `Uint8Array` produced
   *  by {@link import("@/lib/navmesh").bakeNavmesh}). Stored on the
   *  scene-level R2 asset pipeline; the editor lazily loads it when
   *  agents need it or when the debug overlay is shown. Derived
   *  (FNV-1a) from `navmeshBlobKey` so cross-session reloads land on
   *  the same id. */
  navmeshAssetId?: number;
  /** Server-assigned content-addressed key (16-char hex SHA-1 prefix)
   *  for the persisted navmesh blob — written by `bakeSceneNavmesh`
   *  after `POST /api/navmesh/blob` succeeds. The editor uses this
   *  string to fetch the blob back via `GET /api/navmesh/blob/:id` on
   *  reload, hydrate `window.__navmeshBlobs[navmeshAssetId]`, and let
   *  agents resume pathfinding without a re-bake. Absent during
   *  in-memory-only bakes (e.g. dev environments without R2). */
  navmeshBlobKey?: string;
  /** Per-area palette for the navmesh debug overlay — colour, label,
   *  cost. Sparse; missing entries fall back to per-{@link SurfaceKind}
   *  defaults. */
  navmeshAreas?: Partial<Record<SurfaceKind, { color?: string; cost?: number; label?: string }>>;
  /** Global wind vector applied to soft / particle entities (cloth,
   *  flag, particles) by their verlet/particle simulation. The vector
   *  is the wind force in world space (m/s² acceleration applied to
   *  cloth/flag verts; m/s velocity bias added to spawned particles).
   *  Defaults to {@link DEFAULT_WIND} when unset. */
  wind?: Vec3;
  /** Scene-wide physics tuning. Solver iterations, default
   *  restitution/friction (used when a body's `PhysicsComponent` omits
   *  them), and global linear/angular damping. Read by the play-mode
   *  `<Physics>` rig at boot; per-entity values still override. */
  physics?: PhysicsSettings;
  /** Scene-wide collider defaults + per-layer CCD (continuous collision
   *  detection) opt-in. Templates set this so heavy / fast bodies on
   *  e.g. the Player layer don't tunnel through walls at high speed. */
  colliders?: ColliderSettings;
  /** Recast bake parameters used by `bakeSceneNavmesh`. Centralised so
   *  the editor's bake button, the AI `bake_navmesh` tool, and any
   *  per-template overrides read the same defaults. Bumping any field
   *  invalidates the cached navmesh blob (the bake hash includes
   *  these). */
  navmeshBake?: NavmeshBakeSettings;
  /** Visual / post-FX systems applied to the WebGL renderer + a
   *  drei <EffectComposer>. All fields optional; missing values fall
   *  back to {@link DEFAULT_VISUALS}. The viewport reads this on
   *  every frame so designers can tweak live. */
  visuals?: VisualSettings;
}

/** Scene-wide physics tuning. All optional — missing values fall back
 *  to {@link DEFAULT_PHYSICS}. The play-mode `<Physics>` rig reads
 *  this once at boot to size the Rapier integration step + solver. */
export interface PhysicsSettings {
  /** Fixed-step duration in seconds (default 1/60). Lower = more
   *  accurate, higher CPU. */
  timeStep?: number;
  /** Rapier velocity-solver iterations per step (default 4). */
  solverIterations?: number;
  /** Default coefficient of restitution applied when a
   *  PhysicsComponent omits it (default 0.2). */
  defaultRestitution?: number;
  /** Default coefficient of friction applied when a
   *  PhysicsComponent omits it (default 0.6). */
  defaultFriction?: number;
  /** Global linear damping added to every dynamic body — bleeds off
   *  velocity each step. Default 0 (no extra damping). */
  linearDamping?: number;
  /** Global angular damping (rotational equivalent of the above). */
  angularDamping?: number;
  /** Substep refinement count for Rapier's velocity integrator
   *  (default 1). Bump to 2-4 for high-speed projectiles. */
  maxVelocityIterations?: number;
}

/** Scene-wide collider defaults + CCD (tunneling protection) opt-in
 *  per layer. */
export interface ColliderSettings {
  /** Collider shape used when a freshly-created entity doesn't carry
   *  one (the inspector "Add physics" button reads this). */
  defaultColliderType?: PhysicsComponent["colliderType"];
  /** Layers whose dynamic bodies get continuous collision detection
   *  on. CCD costs perf so it's opt-in — typically `["Player",
   *  "Projectile"]`. */
  ccdEnabledLayers?: LayerName[];
  /** Default V-HACD knobs used when the user clicks "Bake convex
   *  hulls" without first opening the advanced panel. Per-entity
   *  `physics.colliderBakeOptions` still override. */
  convexDecompDefaults?: ColliderBakeOptions;
}

/** Recast / Detour navmesh bake parameters. Mirrors the field names
 *  used by `lib/navmesh.ts → bakeNavmesh`, so any value set here is
 *  passed straight through. The bake hash includes every field, so
 *  changing any of them invalidates the cached blob. */
export interface NavmeshBakeSettings {
  /** Voxel size on the XZ plane in metres (default 0.3). Smaller =
   *  finer mesh, slower bake, larger blob. */
  cellSize?: number;
  /** Voxel size along Y (default 0.2). */
  cellHeight?: number;
  /** Capsule radius the agent body uses for clearance — Recast carves
   *  the navmesh inwards by this amount (default 0.5 m). */
  agentRadius?: number;
  /** Standing height the agent fits under — gates ducking under
   *  overhangs (default 1.8 m). */
  agentHeight?: number;
  /** Maximum walkable slope in degrees (default 45). */
  maxSlope?: number;
  /** Maximum step-up the agent climbs in one frame (default 0.4 m). */
  walkableClimb?: number;
  /** Auto-rebake the navmesh on every scene save when true. Default
   *  false — bakes only on explicit user / AI request. */
  autoBakeOnSave?: boolean;
}

/** Visual / post-FX systems. All optional — missing values fall back
 *  to {@link DEFAULT_VISUALS}. */
export interface VisualSettings {
  /** WebGL tone-mapping operator. ACES is the modern HDR-aware
   *  default; `linear` matches the classic three.js look. */
  toneMapping?: "linear" | "ACES" | "reinhard";
  /** Exposure multiplier applied after tone-mapping (default 1.0). */
  exposure?: number;
  shadows?: {
    enabled?: boolean;
    /** Shadow-map texture resolution in pixels (default 2048). */
    resolution?: number;
    /** Depth bias to prevent shadow acne (default 0.0001). */
    bias?: number;
  };
  postFX?: {
    bloom?: { enabled?: boolean; intensity?: number; threshold?: number };
    ssao?: { enabled?: boolean; intensity?: number; radius?: number };
    vignette?: { enabled?: boolean; intensity?: number };
    colorGrade?: { contrast?: number; saturation?: number; temperature?: number };
  };
  /** Tint colour for the sky-side of the global hemisphere light. */
  hemisphereTint?: string;
  /** Asset id for an HDR / EXR skybox (drives both the sky background
   *  and PBR reflections via `useEnvironment`). */
  skyboxAssetId?: number;
}

/** Gentle default wind — a light breeze blowing in +X. Picked so a
 *  freshly-spawned flag actually ripples in the editor without the
 *  user having to discover the Wind slider first. */
export const DEFAULT_WIND: Vec3 = [1.5, 0, 0];

export interface SceneData {
  entities: SceneEntity[];
  environment: Environment;
}

/** Earth-strength gravity used as the default for new scenes and as the
 *  fallback whenever `Environment.gravity` is unset. Centralised here so
 *  the editor inspector, the AI tools, and the play-mode `<Physics>` rig
 *  all read the same vector — change it once, every fallback updates. */
export const DEFAULT_GRAVITY: Vec3 = [0, -9.81, 0];

/** Default linear-fog distances (world units). The viewport falls back to
 *  these when `Environment.fog` is unset. Bumped from 80→200 near and
 *  320→1500 far after playtest feedback that the fog wall was visibly
 *  closing in around the player on open-world / large-arena scenes
 *  (anything > ~150u). The new range keeps fog as an atmospheric horizon
 *  effect that only kicks in past mid-distance and never visibly blocks
 *  geometry at gameplay range. Designers can still tighten fog per-scene
 *  via `Environment.fog`. */
export const DEFAULT_FOG = {
  near: 200,
  far: 1500,
} as const;

/** Defaults for the new {@link PhysicsSettings} block. Earth gravity is
 *  separate (`DEFAULT_GRAVITY`); these knobs cover the integrator
 *  itself. */
export const DEFAULT_PHYSICS: Required<Omit<PhysicsSettings, never>> = {
  timeStep: 1 / 60,
  solverIterations: 4,
  defaultRestitution: 0.2,
  defaultFriction: 0.6,
  linearDamping: 0,
  angularDamping: 0,
  maxVelocityIterations: 1,
};

/** Defaults for {@link ColliderSettings}. CCD is on for Player +
 *  Projectile by default — those are the layers most prone to
 *  tunneling. Convex-decomp defaults match the inspector's collapsed
 *  defaults so first-click bakes are predictable. */
export const DEFAULT_COLLIDERS: Required<Pick<ColliderSettings,
  "defaultColliderType" | "ccdEnabledLayers"
>> & { convexDecompDefaults: ColliderBakeOptions } = {
  defaultColliderType: "cuboid",
  ccdEnabledLayers: ["Player", "Projectile"],
  convexDecompDefaults: {
    maxHulls: 32,
    minHullVolume: 0.001,
    voxelResolution: 200000,
    maxVerticesPerHull: 64,
    fillMode: "flood",
  },
};

/** Defaults for {@link NavmeshBakeSettings}. Mirrors the values the
 *  bake panel ships with so the schema and UI agree. */
export const DEFAULT_NAVMESH_BAKE: Required<Omit<NavmeshBakeSettings, never>> = {
  cellSize: 0.3,
  cellHeight: 0.2,
  agentRadius: 0.5,
  agentHeight: 1.8,
  maxSlope: 45,
  walkableClimb: 0.4,
  autoBakeOnSave: false,
};

/** Defaults for {@link VisualSettings}. ACES + soft bloom is the modern
 *  hand-drawn / stylised look; templates can override per-scene. */
export const DEFAULT_VISUALS: VisualSettings = {
  toneMapping: "ACES",
  exposure: 1.0,
  shadows: { enabled: true, resolution: 2048, bias: 0.0001 },
  postFX: {
    bloom: { enabled: true, intensity: 0.4, threshold: 0.85 },
    ssao: { enabled: false, intensity: 0.5, radius: 0.4 },
    vignette: { enabled: true, intensity: 0.25 },
    colorGrade: { contrast: 1.0, saturation: 1.0, temperature: 0 },
  },
};

export const DEFAULT_ENV: Environment = {
  skyColor: "#0a0a14",
  groundColor: "#1a1a2e",
  ambientIntensity: 0.4,
  sunIntensity: 1.2,
  gravity: DEFAULT_GRAVITY,
  cameraMode: "editor",
  cameraTargetEntityId: null,
  playerMoveSpeed: 6,
  mouseSensitivity: 0.0025,
  sensorLayers: [...DEFAULT_SENSOR_LAYERS],
  physics: { ...DEFAULT_PHYSICS },
  colliders: {
    defaultColliderType: DEFAULT_COLLIDERS.defaultColliderType,
    ccdEnabledLayers: [...DEFAULT_COLLIDERS.ccdEnabledLayers],
    convexDecompDefaults: { ...DEFAULT_COLLIDERS.convexDecompDefaults },
  },
  navmeshBake: { ...DEFAULT_NAVMESH_BAKE },
  visuals: {
    ...DEFAULT_VISUALS,
    shadows: { ...DEFAULT_VISUALS.shadows! },
    postFX: {
      bloom: { ...DEFAULT_VISUALS.postFX!.bloom! },
      ssao: { ...DEFAULT_VISUALS.postFX!.ssao! },
      vignette: { ...DEFAULT_VISUALS.postFX!.vignette! },
      colorGrade: { ...DEFAULT_VISUALS.postFX!.colorGrade! },
    },
  },
};

/** Infer a default {@link LayerName} for an entity that has no `layer`
 *  field set. Mirrors the rules the editor applies on load:
 *    - planes & entities literally named "Map"/"Terrain"   → "Terrain"
 *    - controllerKind !== "none"                           → "Player"
 *    - behavior starts with "enemy-"                        → "NPC"
 *    - behavior === "spawnpoint"                            → "Trigger"
 *    - everything else                                      → "Default"
 */
export function inferDefaultLayer(e: Pick<SceneEntity,
  "type" | "name" | "controllerKind" | "behavior"
>): LayerName {
  const lower = (e.name ?? "").toLowerCase();
  if (e.type === "plane" || lower === "map" || lower === "terrain") return "Terrain";
  if (e.controllerKind && e.controllerKind !== "none") return "Player";
  if (typeof e.behavior === "string" && e.behavior.startsWith("enemy-")) return "NPC";
  if (e.behavior === "npc-dialog") return "NPC";
  if (e.behavior === "spawnpoint") return "Trigger";
  return "Default";
}

/** Pick the most useful default surface tag for an entity that has no
 *  explicit `surface` set. Prefers the most specific signal: explicit
 *  layer first (Terrain → Walk, Water → Swim), then a name heuristic
 *  for ladders / climb walls, finally `None` so non-environment props
 *  don't pollute the navmesh bake. The sanitizer applies this without
 *  ever overwriting an existing value. */
export function inferDefaultSurface(
  e: Pick<SceneEntity, "type" | "name" | "layer" | "controllerKind" | "behavior">,
): SurfaceKind {
  const lower = (e.name ?? "").toLowerCase();
  if (lower.includes("ladder") || lower.includes("climb")) return "Climb";
  if (lower.includes("water") || lower.includes("pool") || lower.includes("ocean")) return "Swim";
  const fromLayer = layerToSurface(e.layer);
  if (fromLayer !== "None") return fromLayer;
  // Map / terrain naming wins even when the layer hasn't been set yet
  // (sanitizer runs surface-inference before the layer pass for some
  // import paths, e.g. AI-generated scenes).
  if (e.type === "plane" || lower === "map" || lower === "terrain") return "Walk";
  return "None";
}

export const DEFAULT_TRANSFORM = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
