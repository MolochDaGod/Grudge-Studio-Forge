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
}

export type ControllerKind = "none" | "thirdPerson" | "firstPerson";

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
};

export const DEFAULT_TRANSFORM = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
