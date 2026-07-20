export * from "./layers";
export * from "./materials";
export * from "./inheritance";
export * from "./stats";
import type { LayerName } from "./layers";
import { DEFAULT_SENSOR_LAYERS } from "./layers";
import type { MaterialComponent } from "./materials";
import type { StatsComponent } from "./stats";

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
  /** Continuous collision detection — enable for fast projectiles / thin
   *  colliders so they don't tunnel through walls at high speed. */
  ccd?: boolean;
  /** Override linear damping (falls back to material.drag when unset). */
  linearDamping?: number;
  /** Angular damping — high values stop props from spinning forever. */
  angularDamping?: number;
  /** When `colliderType === "convex-decomp"`, points to the asset id
   *  holding the precomputed hull set (array of Vec3 vertex arrays). */
  collidersAssetId?: number;
  /** Persisted V-HACD knobs used the last time this entity's hulls were
   *  baked. Saved so the Inspector "Re-bake" button and the AI
   *  `bake_convex_hulls` tool can reproduce the same decomposition. See
   *  `lib/colliderBaker.ts → BuildHullsOptions`. */
  colliderBakeOptions?: ColliderBakeOptions;
  /** Character capsule half-height (m). Default 0.85 for humanoids. */
  capsuleHalfHeight?: number;
  /** Character capsule radius (m). Default 0.35. */
  capsuleRadius?: number;
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
  /** Combat ally — fights hostiles (enemy-deathmatch, enemy-rpg, boss), never targets Player. Layer NPC. */
  | "ally"
  /** Neutral civilian — wanders; only fights after taking damage. Layer NPC. */
  | "neutral"
  /** Vendor merchant — interact (E via player-rpg) opens vendor HUD from npcLine stock. Layer NPC. */
  | "vendor"
  /** Boss enemy — high HP, heavy damage, no flee, enrages under 30 percent HP. Layer NPC. */
  | "boss"
  /** RTS worker — gathers gold/wood under orders (or auto when idle). */
  | "rts-peon"
  /** RTS melee combatant — engages hostiles under orders (or auto when idle). */
  | "rts-footman"
  /** RTS ranged combatant — engages at range under orders. */
  | "rts-archer"
  /** RTS neutral creep — guards nearby resource, aggro on approach. */
  | "rts-creep"
  /** RTS production / town building — selectable, trains units, has HP. */
  | "rts-building"
  /** RTS defensive tower — auto-attacks nearby hostiles. */
  | "rts-tower"
  /** RTS match controller — selection, orders, economy, production, win/lose. */
  | "gamemode-rts";

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
  /** Per-entity soft-body / particle tuning consumed by the verlet
   *  simulation in `EntityRenderer` for `cloth` / `flag` / `particles`
   *  types. All fields optional — sensible per-type defaults are
   *  applied when unset. See {@link SoftBodyComponent}. */
  softBody?: SoftBodyComponent;
  /** Per-entity RPG stats (8 primary attributes + level + xp). When set,
   *  the play-mode {@link StatsEngine} builds a resolved stat block
   *  (derived stats with diminishing returns) and exposes it through
   *  `ctx.stats` in the script API. */
  stats?: StatsComponent;
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
  /** Player movement speed in m/s (WASD). */
  playerMoveSpeed?: number;
  /** Mouselook sensitivity (radians per pixel, default 0.0025). */
  mouseSensitivity?: number;
  /** Game mode driving the play HUD. `deathmatch` shows the kill counter,
   *  damage flash, hit indicators, respawn timer, win/lose banner.
   *  `rts` shows gold + resource strip and town-hall win/lose. */
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
  /**
   * Professional game HUD / UI kit theme for Play mode.
   * Design source of truth: https://ui.grudge-studio.com
   * (Fantasy / Cyberpunk / FPS / RPG kits — theme, layers, export).
   */
  uiKit?: {
    /** Kit theme matching ui.grudge-studio.com genres. */
    theme?: "fantasy" | "cyberpunk" | "fps" | "rpg";
    /**
     * Enabled HUD layer stack (bottom → top). Known ids:
     * hud-root, unit-frame, action-bar, minimap, chat, quest-tracker,
     * inventory, shop, skill-tree, notifications, crosshair, scoreboard.
     */
    layers?: string[];
    /** Relative font scale (1 = default). */
    fontScale?: number;
    /** Accent / brand color (hex). */
    accent?: string;
    /** Optional deep link back to a saved design on the UI kit site. */
    designUrl?: string;
  };
  /**
   * Equirectangular skybox / panorama texture URL (https, data:, or R2).
   * When set, CelestialSky samples it as a background dome.
   */
  skyTexture?: string;
  /**
   * Procedural celestial dome: gradient sky, stars, sun, moon, aurora.
   * When unset the viewport falls back to a solid skyColor background.
   */
  celestial?: {
    /** Master enable. Default true when the object is present. */
    enabled?: boolean;
    /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1 = midnight. */
    timeOfDay?: number;
    /** Star density / brightness (0–1). Auto-boosted at night. */
    stars?: number;
    /** Show sun disc + directional glow. Default true. */
    sun?: boolean;
    /** Show moon disc when night. Default true. */
    moon?: boolean;
    /** Aurora ribbon intensity 0–1 (polar night look). Default 0. */
    aurora?: number;
    /** Sky dome radius in world units. Default 800. */
    radius?: number;
    /** Top zenith color override (hex). */
    zenithColor?: string;
    /** Horizon color override (hex). */
    horizonColor?: string;
  };
  /**
   * Volumetric / particle weather FX (rain, snow, dust, storm, fog bank).
   */
  weather?: {
    /** Preset type. `clear` disables particles. */
    type?: "clear" | "rain" | "snow" | "dust" | "storm" | "fog";
    /** Effect intensity 0–1 (density, opacity, wind bias). Default 0.55. */
    intensity?: number;
    /** Wind push for precipitation [x,y,z]. Falls back to Environment.wind. */
    wind?: Vec3;
    /** Particle count scale (1 = preset default). */
    density?: number;
  };
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
 *  these when `Environment.fog` is unset. Sized for the current ~120u arena
 *  scale so the fog wall sits on the horizon, not behind the player. */
export const DEFAULT_FOG = {
  near: 80,
  far: 320,
} as const;

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
  /** Procedural sky enabled by default so new scenes get stars/sun/gradient. */
  celestial: {
    enabled: true,
    timeOfDay: 0.55,
    stars: 0.7,
    sun: true,
    moon: true,
    aurora: 0,
    radius: 900,
  },
  weather: {
    type: "clear",
    intensity: 0.55,
    density: 1,
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
  if (
    e.behavior === "npc-dialog" ||
    e.behavior === "ally" ||
    e.behavior === "neutral" ||
    e.behavior === "vendor" ||
    e.behavior === "boss"
  ) {
    return "NPC";
  }
  if (e.behavior === "spawnpoint" || e.behavior === "pickup-trigger") return "Trigger";
  if (e.behavior === "player-deathmatch" || e.behavior === "player-rpg") return "Player";
  // RTS peon/footman/archer/building keep authored layer (Player vs NPC).
  if (e.behavior === "rts-creep") return "NPC";
  if (e.behavior === "rts-tower") return "NPC";
  if (e.behavior === "gamemode-rts") return "Default";
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
