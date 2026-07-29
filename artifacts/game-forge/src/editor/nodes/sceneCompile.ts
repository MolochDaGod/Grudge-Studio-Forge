import { nanoid } from "nanoid";
import type { SceneEntity, EntityType, MaterialComponent, LightComponent } from "@/scene/types";
import type { SceneFlowNode, SceneFlowEdge, SceneNodeKind } from "./types";

interface CompileResult {
  entities: SceneEntity[];
  warnings: string[];
}

const findIncoming = (edges: SceneFlowEdge[], target: string, handle?: string) =>
  edges.filter((e) => e.target === target && (!handle || e.targetHandle === handle));

const nodeById = (nodes: SceneFlowNode[], id: string) =>
  nodes.find((n) => n.id === id);

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" ? v : Number(v) || fallback;

const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : fallback;

const meshTypeForGeom = (kind: SceneNodeKind): EntityType => {
  switch (kind) {
    case "geomBox": return "box";
    case "geomSphere": return "sphere";
    case "geomPlane": return "plane";
    case "geomCylinder": return "cylinder";
    default: return "empty";
  }
};

const scaleForGeom = (geom: SceneFlowNode): [number, number, number] => {
  const p = geom.data.params;
  switch (geom.data.kind) {
    case "geomBox":
      return [num(p.sizeX, 1), num(p.sizeY, 1), num(p.sizeZ, 1)];
    case "geomSphere": {
      const r = num(p.radius, 0.5) * 2;
      return [r, r, r];
    }
    case "geomPlane":
      return [num(p.sizeX, 4), 1, num(p.sizeY, 4)];
    case "geomCylinder": {
      const r = num(p.radius, 0.5) * 2;
      return [r, num(p.height, 1), r];
    }
    default:
      return [1, 1, 1];
  }
};

const materialFromNode = (mat?: SceneFlowNode): MaterialComponent | undefined => {
  if (!mat || mat.data.kind !== "material") return undefined;
  const p = mat.data.params;
  return {
    color: str(p.color, "#d4af37"),
    metalness: num(p.metalness, 0.5),
    roughness: num(p.roughness, 0.4),
  };
};

const lightFromNode = (n: SceneFlowNode): LightComponent => {
  const p = n.data.params;
  const k = str(p.kind, "point");
  return {
    kind: k === "directional" || k === "spot" ? k : "point",
    color: str(p.color, "#ffffff"),
    intensity: num(p.intensity, 1.5),
    distance: num(p.distance, 10),
  };
};

/**
 * Walks the graph starting from the SceneOutput node(s) and produces the
 * SceneEntity list to spawn into the active scene. The graph contract:
 *   geom* ─┐
 *           ├─► mesh ──► sceneOutput
 *   material┘   ▲
 *   transform ──┘
 *   light ─► sceneOutput
 */
export function compileSceneGraph(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
): CompileResult {
  const warnings: string[] = [];
  const entities: SceneEntity[] = [];

  const outputs = nodes.filter((n) => n.data.kind === "sceneOutput");
  if (outputs.length === 0) {
    warnings.push("No Scene Output node — add one and connect meshes to it.");
    return { entities, warnings };
  }

  for (const out of outputs) {
    const incoming = findIncoming(edges, out.id);
    if (incoming.length === 0) {
      warnings.push(`Scene Output "${out.id}" has no inputs.`);
      continue;
    }

    for (const edge of incoming) {
      const src = nodeById(nodes, edge.source);
      if (!src) continue;

      if (src.data.kind === "mesh") {
        const meshIns = findIncoming(edges, src.id);
        const geomEdge = meshIns.find((e) => {
          const n = nodeById(nodes, e.source);
          return n && n.data.kind.startsWith("geom");
        });
        const matEdge = meshIns.find((e) => {
          const n = nodeById(nodes, e.source);
          return n?.data.kind === "material";
        });
        const xfEdge = meshIns.find((e) => {
          const n = nodeById(nodes, e.source);
          return n?.data.kind === "transform";
        });
        const geom = geomEdge ? nodeById(nodes, geomEdge.source) : undefined;
        const mat = matEdge ? nodeById(nodes, matEdge.source) : undefined;
        const xf = xfEdge ? nodeById(nodes, xfEdge.source) : undefined;
        if (!geom) {
          warnings.push(`Mesh "${str(src.data.params.name, "Mesh")}" missing geometry.`);
          continue;
        }
        const xfP = xf?.data.params ?? {};
        const entity: SceneEntity = {
          id: nanoid(),
          name: str(src.data.params.name, "Mesh"),
          type: meshTypeForGeom(geom.data.kind),
          transform: {
            position: [num(xfP.x, 0), num(xfP.y, 1), num(xfP.z, 0)],
            rotation: [num(xfP.rx, 0), num(xfP.ry, 0), num(xfP.rz, 0)],
            scale:
              xf
                ? [num(xfP.sx, 1), num(xfP.sy, 1), num(xfP.sz, 1)]
                : scaleForGeom(geom),
          },
          material: materialFromNode(mat),
        };
        entities.push(entity);
      } else if (src.data.kind === "light") {
        const xfEdge = findIncoming(edges, src.id).find((e) => {
          const n = nodeById(nodes, e.source);
          return n?.data.kind === "transform";
        });
        const xf = xfEdge ? nodeById(nodes, xfEdge.source) : undefined;
        const xfP = xf?.data.params ?? {};
        entities.push({
          id: nanoid(),
          name: `Light (${str(src.data.params.kind, "point")})`,
          type: "light",
          transform: {
            position: [num(xfP.x, 0), num(xfP.y, 4), num(xfP.z, 0)],
            rotation: [num(xfP.rx, 0), num(xfP.ry, 0), num(xfP.rz, 0)],
            scale: [1, 1, 1],
          },
          light: lightFromNode(src),
        });
      } else {
        warnings.push(`Cannot connect ${src.data.kind} directly to Scene Output.`);
      }
    }
  }

  if (entities.length === 0 && warnings.length === 0) {
    warnings.push("Graph compiled but produced no entities.");
  }
  return { entities, warnings };
}
