import type { Node, Edge } from "@xyflow/react";

export type GraphKind = "scene" | "logic" | "shader";

export type SceneNodeKind =
  | "geomBox"
  | "geomSphere"
  | "geomPlane"
  | "geomCylinder"
  | "material"
  | "mesh"
  | "light"
  | "transform"
  | "sceneOutput";

export interface SceneNodeData extends Record<string, unknown> {
  kind: SceneNodeKind;
  label: string;
  params: Record<string, number | string | boolean>;
}

export type SceneFlowNode = Node<SceneNodeData>;
export type SceneFlowEdge = Edge;

export interface NodeGraph {
  kind: GraphKind;
  nodes: SceneFlowNode[];
  edges: SceneFlowEdge[];
}

export const SCENE_NODE_LABELS: Record<SceneNodeKind, string> = {
  geomBox: "Box Geometry",
  geomSphere: "Sphere Geometry",
  geomPlane: "Plane Geometry",
  geomCylinder: "Cylinder Geometry",
  material: "Standard Material",
  mesh: "Mesh",
  light: "Light",
  transform: "Transform",
  sceneOutput: "Scene Output",
};

export const SCENE_NODE_DEFAULTS: Record<SceneNodeKind, Record<string, number | string | boolean>> = {
  geomBox: { sizeX: 1, sizeY: 1, sizeZ: 1 },
  geomSphere: { radius: 0.5 },
  geomPlane: { sizeX: 4, sizeY: 4 },
  geomCylinder: { radius: 0.5, height: 1 },
  material: { color: "#d4af37", metalness: 0.5, roughness: 0.4 },
  mesh: { name: "Mesh" },
  light: { kind: "point", color: "#ffffff", intensity: 1.5, distance: 10 },
  transform: { x: 0, y: 1, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
  sceneOutput: {},
};
