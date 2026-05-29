/**
 * AI Graph Generator — converts natural-language prompts into wired
 * scene node graphs. Used by the Nodes tab's AI prompt bar.
 *
 * This is a pattern-matching generator (not an LLM call) so it works
 * fully offline with zero latency. It detects keywords in the prompt
 * and assembles the appropriate nodes + edges.
 *
 * For complex prompts, the user can use the inline AI prompt bar
 * (which calls the full AI Worker pipeline). This generator handles
 * the common fast-path cases.
 */
import { nanoid } from "nanoid";
import type {
  SceneFlowNode,
  SceneFlowEdge,
  SceneNodeKind,
} from "./types";
import { SCENE_NODE_LABELS, SCENE_NODE_DEFAULTS } from "./types";

interface GeneratedGraph {
  nodes: SceneFlowNode[];
  edges: SceneFlowEdge[];
  description: string;
}

function mkNode(
  kind: SceneNodeKind,
  x: number,
  y: number,
  params?: Record<string, number | string | boolean>,
): SceneFlowNode {
  return {
    id: nanoid(6),
    type: kind,
    position: { x, y },
    data: {
      kind,
      label: SCENE_NODE_LABELS[kind],
      params: { ...SCENE_NODE_DEFAULTS[kind], ...params },
    },
  };
}

function mkEdge(source: string, target: string, sourceHandle?: string, targetHandle?: string): SceneFlowEdge {
  return {
    id: `e-${nanoid(4)}`,
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    targetHandle: targetHandle ?? undefined,
  };
}

// ── Pattern matchers ─────────────────────────────────────────────────

function detectColors(prompt: string): string {
  const colorMap: Record<string, string> = {
    red: "#ff3333", blue: "#3366ff", green: "#33cc33", yellow: "#ffcc00",
    orange: "#ff8833", purple: "#9933ff", pink: "#ff66aa", white: "#ffffff",
    black: "#111111", gold: "#d4af37", cyan: "#00cccc", magenta: "#cc33cc",
    brown: "#8b4513", gray: "#888888", grey: "#888888",
  };
  const lower = prompt.toLowerCase();
  for (const [name, hex] of Object.entries(colorMap)) {
    if (lower.includes(name)) return hex;
  }
  // Check for hex codes
  const hexMatch = prompt.match(/#[0-9a-fA-F]{3,6}/);
  if (hexMatch) return hexMatch[0];
  return "#d4af37"; // default gold
}

function detectGeometry(prompt: string): { kind: SceneNodeKind; params: Record<string, number | string | boolean> } {
  const lower = prompt.toLowerCase();
  if (lower.includes("sphere") || lower.includes("ball") || lower.includes("orb")) {
    const radiusMatch = lower.match(/radius\s*[:=]?\s*([\d.]+)/);
    return { kind: "geomSphere", params: { radius: radiusMatch ? parseFloat(radiusMatch[1]) : 0.5 } };
  }
  if (lower.includes("plane") || lower.includes("floor") || lower.includes("ground")) {
    return { kind: "geomPlane", params: { sizeX: 10, sizeY: 10 } };
  }
  if (lower.includes("cylinder") || lower.includes("pillar") || lower.includes("column")) {
    return { kind: "geomCylinder", params: { radius: 0.5, height: 2 } };
  }
  // Default: box/cube
  return { kind: "geomBox", params: { sizeX: 1, sizeY: 1, sizeZ: 1 } };
}

function detectLight(prompt: string): { kind: string; color: string; intensity: number } {
  const lower = prompt.toLowerCase();
  const color = detectColors(prompt);
  const intensityMatch = lower.match(/intensity\s*[:=]?\s*([\d.]+)/);
  const intensity = intensityMatch ? parseFloat(intensityMatch[1]) : 4;
  if (lower.includes("spot")) return { kind: "spot", color, intensity };
  if (lower.includes("directional") || lower.includes("sun")) return { kind: "directional", color, intensity };
  return { kind: "point", color, intensity };
}

function detectPosition(prompt: string): { x: number; y: number; z: number } {
  const lower = prompt.toLowerCase();
  const posMatch = lower.match(/(?:at|position)\s*\(?\s*([-\d.]+)\s*[,\s]\s*([-\d.]+)\s*[,\s]\s*([-\d.]+)/);
  if (posMatch) {
    return { x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]), z: parseFloat(posMatch[3]) };
  }
  if (lower.includes("above") || lower.includes("high") || lower.includes("top")) return { x: 0, y: 4, z: 0 };
  if (lower.includes("center") || lower.includes("origin")) return { x: 0, y: 0, z: 0 };
  return { x: 0, y: 1, z: 0 };
}

function detectCount(prompt: string): number {
  const lower = prompt.toLowerCase();
  const countWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    pair: 2, couple: 2, few: 3, several: 4, many: 6,
  };
  for (const [word, n] of Object.entries(countWords)) {
    if (lower.includes(word)) return n;
  }
  const numMatch = lower.match(/(\d+)\s*(?:x\s)?(?:box|sphere|cube|light|mesh|object|item|thing)/);
  if (numMatch) return Math.min(parseInt(numMatch[1], 10), 12);
  return 1;
}

// ── Main generator ───────────────────────────────────────────────────

export function generateGraphFromPrompt(prompt: string): GeneratedGraph {
  const lower = prompt.toLowerCase();
  const nodes: SceneFlowNode[] = [];
  const edges: SceneFlowEdge[] = [];
  const descriptions: string[] = [];

  const hasLight = lower.includes("light") || lower.includes("lamp") || lower.includes("torch") || lower.includes("glow");
  const hasGeom = lower.includes("box") || lower.includes("sphere") || lower.includes("cube") ||
    lower.includes("plane") || lower.includes("floor") || lower.includes("cylinder") ||
    lower.includes("pillar") || lower.includes("ground") || lower.includes("ball") ||
    lower.includes("object") || lower.includes("mesh") || lower.includes("create") ||
    lower.includes("make") || lower.includes("add") || lower.includes("spawn");

  // Always have a scene output
  const outputNode = mkNode("sceneOutput", 800, 300);
  nodes.push(outputNode);

  const count = detectCount(prompt);

  if (hasGeom || (!hasLight && !hasGeom)) {
    const geom = detectGeometry(prompt);
    const color = detectColors(prompt);
    const pos = detectPosition(prompt);

    for (let i = 0; i < count; i++) {
      const yOffset = i * 200;
      const xSpread = i * 2;

      // Geometry node
      const geomNode = mkNode(geom.kind, 50, 100 + yOffset, geom.params);
      nodes.push(geomNode);

      // Material node
      const matNode = mkNode("material", 50, 200 + yOffset, {
        color,
        metalness: lower.includes("metal") || lower.includes("shiny") ? 0.8 : 0.3,
        roughness: lower.includes("smooth") || lower.includes("shiny") ? 0.2 : 0.6,
      });
      nodes.push(matNode);

      // Transform node
      const transformNode = mkNode("transform", 300, 100 + yOffset, {
        x: pos.x + xSpread, y: pos.y, z: pos.z + (i * 2),
        rx: 0, ry: 0, rz: 0,
        sx: 1, sy: 1, sz: 1,
      });
      nodes.push(transformNode);

      // Mesh node (connects geom + material + transform)
      const meshNode = mkNode("mesh", 550, 150 + yOffset, {
        name: count > 1 ? `${geom.kind.replace("geom", "")} ${i + 1}` : geom.kind.replace("geom", ""),
      });
      nodes.push(meshNode);

      // Wire: geom → mesh, material → mesh, transform → mesh, mesh → output
      edges.push(mkEdge(geomNode.id, meshNode.id, "geometry", "geometry"));
      edges.push(mkEdge(matNode.id, meshNode.id, "material", "material"));
      edges.push(mkEdge(transformNode.id, meshNode.id, "transform", "transform"));
      edges.push(mkEdge(meshNode.id, outputNode.id, "mesh", "input"));

      descriptions.push(`${SCENE_NODE_LABELS[geom.kind]} (${color})`);
    }
  }

  if (hasLight) {
    const light = detectLight(prompt);
    const pos = detectPosition(prompt);
    const lightCount = hasGeom ? 1 : count;

    for (let i = 0; i < lightCount; i++) {
      const yBase = hasGeom ? (count * 200 + 100) : (i * 180 + 100);
      const lightNode = mkNode("light", 550, yBase, {
        kind: light.kind,
        color: light.color,
        intensity: light.intensity,
        distance: 15,
      });
      nodes.push(lightNode);

      const lightTransform = mkNode("transform", 300, yBase, {
        x: pos.x + (i * 3), y: pos.y + 2, z: pos.z,
        rx: 0, ry: 0, rz: 0,
        sx: 1, sy: 1, sz: 1,
      });
      nodes.push(lightTransform);

      edges.push(mkEdge(lightTransform.id, lightNode.id, "transform", "transform"));
      edges.push(mkEdge(lightNode.id, outputNode.id, "light", "input"));

      descriptions.push(`${light.kind} light (${light.color})`);
    }
  }

  return {
    nodes,
    edges,
    description: descriptions.length > 0
      ? `Generated ${descriptions.join(", ")}`
      : "Generated empty scene with output node",
  };
}
