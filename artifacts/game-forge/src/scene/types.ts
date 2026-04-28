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
}

export interface Environment {
  skyColor?: string;
  groundColor?: string;
  ambientIntensity?: number;
  sunIntensity?: number;
  gravity?: Vec3;
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
};

export const DEFAULT_TRANSFORM = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
