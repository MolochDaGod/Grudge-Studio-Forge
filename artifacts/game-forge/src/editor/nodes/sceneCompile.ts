import { nanoid } from "nanoid";
import type {
  SceneEntity,
  EntityType,
  MaterialComponent,
  LightComponent,
  SystemsComponent,
} from "@/scene/types";
import type { SceneFlowNode, SceneFlowEdge, SceneNodeKind } from "./types";

interface CompileResult {
  entities: SceneEntity[];
  warnings: string[];
}

const findIncoming = (edges: SceneFlowEdge[], target: string, handle?: string) =>
  edges.filter((e) => e.target === target && (!handle || e.targetHandle === handle));

const findOutgoing = (edges: SceneFlowEdge[], source: string) =>
  edges.filter((e) => e.source === source);

const nodeById = (nodes: SceneFlowNode[], id: string) => nodes.find((n) => n.id === id);

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" ? v : Number(v) || fallback;

const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : fallback;

const bool = (v: unknown, fallback = false) =>
  typeof v === "boolean" ? v : fallback;

const meshTypeForGeom = (kind: SceneNodeKind): EntityType => {
  switch (kind) {
    case "geomBox":
      return "box";
    case "geomSphere":
      return "sphere";
    case "geomPlane":
      return "plane";
    case "geomCylinder":
      return "cylinder";
    default:
      return "empty";
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

/** Deterministic mulberry32 PRNG for generative / instance placement. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple value noise 0..1 for generative density. */
function valueNoise2(x: number, z: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 43.758) * 43758.5453;
  return n - Math.floor(n);
}

function fbm2(x: number, z: number, seed: number, octaves: number, scale: number): number {
  let amp = 0.5;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < Math.max(1, octaves); i++) {
    sum += amp * valueNoise2(x * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / (norm || 1);
}

type Xf = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

function transformFromNode(xf?: SceneFlowNode, fallbackY = 0): Xf {
  const p = xf?.data.params ?? {};
  return {
    position: [num(p.x, 0), num(p.y, fallbackY), num(p.z, 0)],
    rotation: [num(p.rx, 0), num(p.ry, 0), num(p.rz, 0)],
    scale: [num(p.sx, 1), num(p.sy, 1), num(p.sz, 1)],
  };
}

function findConnected(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  hostId: string,
  pred: (n: SceneFlowNode) => boolean,
): SceneFlowNode | undefined {
  for (const e of findIncoming(edges, hostId)) {
    const n = nodeById(nodes, e.source);
    if (n && pred(n)) return n;
  }
  return undefined;
}

function collectIk(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  hostId: string,
): SystemsComponent["ik"] | undefined {
  const chains: NonNullable<SystemsComponent["ik"]>["chains"] = [];
  for (const e of findIncoming(edges, hostId)) {
    const n = nodeById(nodes, e.source);
    if (!n) continue;
    if (n.data.kind === "twoBoneIk") {
      const p = n.data.params;
      // Optional target transform → world offset stored on the chain
      const targetXf = findConnected(nodes, edges, n.id, (x) => x.data.kind === "transform");
      const t = targetXf ? transformFromNode(targetXf, 1.2) : null;
      chains.push({
        type: "twoBone",
        bones: [str(p.rootBone), str(p.midBone), str(p.tipBone)],
        targetOffset: t ? t.position : [0.4, 1.2, 0.2],
        weight: num(p.weight, 1),
      });
    } else if (n.data.kind === "lookAtIk") {
      const p = n.data.params;
      const targetXf = findConnected(nodes, edges, n.id, (x) => x.data.kind === "transform");
      const t = targetXf ? transformFromNode(targetXf, 1.6) : null;
      chains.push({
        type: "lookAt",
        bones: [str(p.bone, "head")],
        targetOffset: t ? t.position : [0, 1.6, 2],
        weight: num(p.weight, 0.8),
      });
    }
  }
  return chains.length ? { chains } : undefined;
}

function collectAnimClip(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  hostId: string,
): string | undefined {
  const anim = findConnected(
    nodes,
    edges,
    hostId,
    (n) => n.data.kind === "animClip" || n.data.kind === "harvestAnim",
  );
  if (!anim) return undefined;
  return str(anim.data.params.clip, "idle");
}

function collectHarvestAnim(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  hostId: string,
): { clip: string; swingTime: number; impactAt: number; handBone: string } | undefined {
  const n = findConnected(nodes, edges, hostId, (x) => x.data.kind === "harvestAnim");
  if (!n) return undefined;
  const p = n.data.params;
  return {
    clip: str(p.clip, "attack"),
    swingTime: num(p.swingTime, 0.45),
    impactAt: num(p.impactAt, 0.28),
    handBone: str(p.handBone, "R_Hand"),
  };
}

function collectNoise(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  hostId: string,
): { seed: number; scale: number; octaves: number } | undefined {
  const n = findConnected(nodes, edges, hostId, (x) => x.data.kind === "noise");
  if (!n) return undefined;
  return {
    seed: num(n.data.params.seed, 1),
    scale: num(n.data.params.scale, 0.15),
    octaves: num(n.data.params.octaves, 3),
  };
}

function collectScatter(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  hostId: string,
): { count: number; radius: number; seed: number } | undefined {
  const n = findConnected(nodes, edges, hostId, (x) => x.data.kind === "scatter");
  if (!n) return undefined;
  return {
    count: Math.max(1, Math.floor(num(n.data.params.count, 16))),
    radius: num(n.data.params.radius, 10),
    seed: num(n.data.params.seed, 7),
  };
}

/** Generate instance positions (best-effort density for deploy). */
function generatePositions(
  mode: string,
  count: number,
  radius: number,
  seed: number,
  base: [number, number, number],
  noise?: { seed: number; scale: number; octaves: number },
  spacing = 1.5,
): Array<[number, number, number]> {
  const rnd = mulberry32(seed);
  const out: Array<[number, number, number]> = [];
  const max = Math.min(count, 256);

  if (mode === "grid") {
    const side = Math.ceil(Math.sqrt(max));
    const half = ((side - 1) * spacing) / 2;
    for (let i = 0; i < max; i++) {
      const gx = (i % side) * spacing - half;
      const gz = Math.floor(i / side) * spacing - half;
      out.push([base[0] + gx, base[1], base[2] + gz]);
    }
    return out;
  }

  if (mode === "ring") {
    for (let i = 0; i < max; i++) {
      const a = (i / max) * Math.PI * 2 + rnd() * 0.05;
      const r = radius * (0.85 + rnd() * 0.15);
      out.push([base[0] + Math.cos(a) * r, base[1], base[2] + Math.sin(a) * r]);
    }
    return out;
  }

  // scatter (default) — optional noise density rejection
  let attempts = 0;
  while (out.length < max && attempts < max * 20) {
    attempts++;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const x = base[0] + Math.cos(a) * r;
    const z = base[2] + Math.sin(a) * r;
    if (noise) {
      const d = fbm2(x, z, noise.seed, noise.octaves, noise.scale);
      if (d < 0.35) continue; // sparse where noise is low
    }
    // crude min-distance
    let ok = true;
    for (const p of out) {
      const dx = p[0] - x;
      const dz = p[2] - z;
      if (dx * dx + dz * dz < spacing * spacing * 0.25) {
        ok = false;
        break;
      }
    }
    if (ok) out.push([x, base[1], z]);
  }
  return out;
}

function compileMesh(
  src: SceneFlowNode,
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  warnings: string[],
): SceneEntity | null {
  const meshIns = findIncoming(edges, src.id);
  const geomEdge = meshIns.find((e) => {
    const n = nodeById(nodes, e.source);
    return n && String(n.data.kind).startsWith("geom");
  });
  const matEdge = meshIns.find((e) => nodeById(nodes, e.source)?.data.kind === "material");
  const xfEdge = meshIns.find((e) => nodeById(nodes, e.source)?.data.kind === "transform");
  const geom = geomEdge ? nodeById(nodes, geomEdge.source) : undefined;
  const mat = matEdge ? nodeById(nodes, matEdge.source) : undefined;
  const xf = xfEdge ? nodeById(nodes, xfEdge.source) : undefined;
  if (!geom) {
    warnings.push(`Mesh "${str(src.data.params.name, "Mesh")}" missing geometry.`);
    return null;
  }
  const t = transformFromNode(xf, 1);
  const clip = collectAnimClip(nodes, edges, src.id);
  const ik = collectIk(nodes, edges, src.id);
  const entity: SceneEntity = {
    id: nanoid(),
    name: str(src.data.params.name, "Mesh"),
    type: meshTypeForGeom(geom.data.kind),
    transform: {
      position: t.position,
      rotation: t.rotation,
      scale: xf ? t.scale : scaleForGeom(geom),
    },
    material: materialFromNode(mat),
  };
  if (clip) entity.model = { ...(entity.model ?? {}), clip };
  if (ik) entity.systems = { ...(entity.systems ?? {}), ik };
  return entity;
}

function compileAsset(
  src: SceneFlowNode,
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
): SceneEntity {
  const p = src.data.params;
  const xf = findConnected(nodes, edges, src.id, (n) => n.data.kind === "transform");
  const t = transformFromNode(xf, 0);
  const clip =
    collectAnimClip(nodes, edges, src.id) ??
    (str(p.clip, "idle") || undefined);
  const ik = collectIk(nodes, edges, src.id);
  const entity: SceneEntity = {
    id: nanoid(),
    name: str(p.name, "Asset"),
    type: "model",
    transform: t,
    model: {
      url: str(p.url, "builtin:character"),
      tint: str(p.tint, "#ffffff"),
      clip,
    },
    layer: "Default",
  };
  if (ik) entity.systems = { ik };
  return entity;
}

function compileHarvest(
  src: SceneFlowNode,
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
): SceneEntity[] {
  const p = src.data.params;
  const xf = findConnected(nodes, edges, src.id, (n) => n.data.kind === "transform");
  const asset = findConnected(nodes, edges, src.id, (n) => n.data.kind === "assetModel");
  const t = transformFromNode(xf, 0);
  const hAnim = collectHarvestAnim(nodes, edges, src.id);
  const resource = str(p.resource, "wood");
  const harvest: NonNullable<SystemsComponent["harvest"]> = {
    resource,
    harvestTime: num(p.harvestTime, 2),
    yieldAmount: num(p.yieldAmount, 3),
    respawn: num(p.respawn, 30),
    maxHits: num(p.maxHits, 5),
    animClip: hAnim?.clip ?? "attack",
  };
  const entity: SceneEntity = {
    id: nanoid(),
    name: str(p.name, `Harvest_${resource}`),
    type: asset ? "model" : "cylinder",
    transform: {
      position: t.position,
      rotation: t.rotation,
      scale: asset ? t.scale : [0.8, 1.6, 0.8],
    },
    material: asset
      ? undefined
      : {
          color:
            resource === "wood"
              ? "#5a3a1a"
              : resource === "stone"
                ? "#888888"
                : resource === "ore"
                  ? "#6b7280"
                  : resource === "crystal"
                    ? "#4ecdc4"
                    : "#4a7c3f",
          roughness: 0.85,
          metalness: resource === "ore" || resource === "crystal" ? 0.4 : 0.05,
        },
    layer: "Item",
    surface: "None",
    systems: {
      harvest,
      ...(hAnim
        ? {
            generative: {
              seed: 0,
              sourceNodeIds: [src.id],
            },
          }
        : {}),
    },
    // Resource-node style interaction via neutral + npcLine payload
    behavior: "neutral",
    npcLine: JSON.stringify({
      kind: "harvest",
      ...harvest,
      handBone: hAnim?.handBone,
      swingTime: hAnim?.swingTime,
      impactAt: hAnim?.impactAt,
    }),
  };
  if (asset) {
    entity.model = {
      url: str(asset.data.params.url, "builtin:character"),
      tint: str(asset.data.params.tint, "#ffffff"),
      clip: hAnim?.clip ?? str(asset.data.params.clip, "idle"),
      label: resource,
    };
  }
  return [entity];
}

function compileInstanceDeploy(
  src: SceneFlowNode,
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  warnings: string[],
): SceneEntity[] {
  const p = src.data.params;
  const count = Math.max(1, Math.floor(num(p.count, 24)));
  const mode = str(p.mode, "scatter");
  const radius = num(p.radius, 12);
  const seed = num(p.seed, 42);
  const maxDraw = Math.max(1, Math.floor(num(p.maxDraw, 64)));
  const spacing = num(p.spacing, 1.5);

  const asset = findConnected(nodes, edges, src.id, (n) => n.data.kind === "assetModel");
  const mesh = findConnected(nodes, edges, src.id, (n) => n.data.kind === "mesh");
  const xf = findConnected(nodes, edges, src.id, (n) => n.data.kind === "transform");
  const noise = collectNoise(nodes, edges, src.id);
  const scatter = collectScatter(nodes, edges, src.id);

  const base = transformFromNode(xf, 0).position;
  const nCount = scatter?.count ?? count;
  const nRadius = scatter?.radius ?? radius;
  const nSeed = scatter?.seed ?? seed;

  const positions = generatePositions(
    mode,
    Math.min(nCount, maxDraw),
    nRadius,
    nSeed,
    base,
    noise,
    spacing,
  );

  if (!asset && !mesh) {
    warnings.push(`Instance Deploy "${src.id}" needs an assetModel or mesh input.`);
    return [];
  }

  const entities: SceneEntity[] = [];
  const templateSystems: SystemsComponent = {
    instance: {
      count: positions.length,
      mode: mode === "grid" || mode === "ring" ? mode : "scatter",
      radius: nRadius,
      seed: nSeed,
      maxDraw,
      spacing,
    },
    generative: {
      seed: nSeed,
      noiseScale: noise?.scale,
      sourceNodeIds: [src.id],
    },
  };

  if (asset) {
    const url = str(asset.data.params.url, "builtin:character");
    const tint = str(asset.data.params.tint, "#ffffff");
    const clip = collectAnimClip(nodes, edges, asset.id) ?? str(asset.data.params.clip, "idle");
    const ik = collectIk(nodes, edges, asset.id);
    positions.forEach((pos, i) => {
      entities.push({
        id: nanoid(),
        name: `${str(asset.data.params.name, "Inst")}_${i}`,
        type: "model",
        transform: {
          position: pos,
          rotation: [0, (i * 0.7) % (Math.PI * 2), 0],
          scale: [1, 1, 1],
        },
        model: { url, tint, clip },
        layer: "Terrain",
        surface: "None",
        systems: {
          ...templateSystems,
          ...(ik ? { ik } : {}),
        },
        physics: {
          bodyType: "fixed",
          colliderType: "cuboid",
          mass: 0,
          restitution: 0.05,
          friction: 0.8,
        },
      });
    });
  } else if (mesh) {
    const compiled = compileMesh(mesh, nodes, edges, warnings);
    if (!compiled) return [];
    positions.forEach((pos, i) => {
      entities.push({
        ...compiled,
        id: nanoid(),
        name: `${compiled.name}_${i}`,
        transform: {
          ...compiled.transform,
          position: pos,
        },
        systems: {
          ...(compiled.systems ?? {}),
          ...templateSystems,
        },
      });
    });
  }

  return entities;
}

function compileMerge(
  src: SceneFlowNode,
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  warnings: string[],
  depth = 0,
): SceneEntity[] {
  if (depth > 8) {
    warnings.push("Merge nesting too deep.");
    return [];
  }
  const out: SceneEntity[] = [];
  for (const e of findIncoming(edges, src.id)) {
    const n = nodeById(nodes, e.source);
    if (!n) continue;
    out.push(...compileNode(n, nodes, edges, warnings, depth + 1));
  }
  if (out.length === 0) {
    warnings.push(`Merge "${str(src.data.params.name, "Merged")}" has no inputs.`);
  }
  return out;
}

function compileNode(
  src: SceneFlowNode,
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
  warnings: string[],
  depth = 0,
): SceneEntity[] {
  switch (src.data.kind) {
    case "mesh": {
      const e = compileMesh(src, nodes, edges, warnings);
      return e ? [e] : [];
    }
    case "light": {
      const xf = findConnected(nodes, edges, src.id, (n) => n.data.kind === "transform");
      const t = transformFromNode(xf, 4);
      return [
        {
          id: nanoid(),
          name: `Light (${str(src.data.params.kind, "point")})`,
          type: "light",
          transform: t,
          light: lightFromNode(src),
        },
      ];
    }
    case "assetModel":
      return [compileAsset(src, nodes, edges)];
    case "harvestNode":
      return compileHarvest(src, nodes, edges);
    case "instancedDeploy":
      return compileInstanceDeploy(src, nodes, edges, warnings);
    case "merge":
      return compileMerge(src, nodes, edges, warnings, depth);
    // Pure generative nodes don't spawn alone
    case "noise":
    case "scatter":
    case "random":
    case "animClip":
    case "harvestAnim":
    case "twoBoneIk":
    case "lookAtIk":
    case "transform":
    case "material":
      return [];
    default:
      if (String(src.data.kind).startsWith("geom")) return [];
      warnings.push(`Cannot connect ${src.data.kind} directly to Scene Output.`);
      return [];
  }
}

/**
 * Walks the graph from SceneOutput (ThreeNodes-style) and produces SceneEntity[].
 *
 * Contract:
 *   geom* + material + transform → mesh → sceneOutput
 *   assetModel (+ anim / ik / transform) → sceneOutput
 *   harvestNode (+ harvestAnim + asset + transform) → sceneOutput
 *   instancedDeploy ← asset|mesh + noise|scatter → sceneOutput
 *   merge ← * → sceneOutput
 */
export function compileSceneGraph(
  nodes: SceneFlowNode[],
  edges: SceneFlowEdge[],
): CompileResult {
  const warnings: string[] = [];
  const entities: SceneEntity[] = [];

  const outputs = nodes.filter((n) => n.data.kind === "sceneOutput");
  if (outputs.length === 0) {
    warnings.push("No Scene Output node — add one and connect meshes/assets to it.");
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
      entities.push(...compileNode(src, nodes, edges, warnings));
    }
  }

  if (entities.length === 0 && warnings.length === 0) {
    warnings.push("Graph compiled but produced no entities.");
  }
  return { entities, warnings };
}

// silence unused if tree-shaken
void findOutgoing;
