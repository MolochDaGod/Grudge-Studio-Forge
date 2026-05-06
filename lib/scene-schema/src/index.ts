export * from "./layers";
import type { LayerName } from "./layers";
import { DEFAULT_SENSOR_LAYERS } from "./layers";

export type Vec3 = [number, number, number];

export type EntityType =
  | "box"
  | "sphere"
  | "cylinder"
  | "plane"
  | "light"
  | "camera"
  | "model"
  | "empty";

export type BodyType = "fixed" | "dynamic" | "kinematicPosition" | "kinematicVelocity";

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface PhysicsComponent {
  bodyType?: BodyType;
  colliderType?: "cuboid" | "ball" | "cylinder" | "trimesh";
  mass?: number;
  restitution?: number;
  friction?: number;
}

export interface MaterialComponent {
  color?: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
}

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
}

export type ControllerKind = "none" | "thirdPerson" | "firstPerson";

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
  | "pickup-trigger";

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
   *  damage flash, hit indicators, respawn timer, win/lose banner. */
  gameMode?: "sandbox" | "deathmatch";
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
}

export interface SceneData {
  entities: SceneEntity[];
  environment: Environment;
}

export const DEFAULT_ENV: Environment = {
  skyColor: "#0a0a14",
  groundColor: "#1a1a2e",
  ambientIntensity: 0.4,
  sunIntensity: 1.2,
  gravity: [0, -9.81, 0],
  cameraMode: "editor",
  cameraTargetEntityId: null,
  playerMoveSpeed: 6,
  mouseSensitivity: 0.0025,
  sensorLayers: [...DEFAULT_SENSOR_LAYERS],
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
  if (e.behavior === "spawnpoint") return "Trigger";
  return "Default";
}

export const DEFAULT_TRANSFORM = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
