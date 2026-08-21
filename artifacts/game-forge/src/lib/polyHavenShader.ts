/**
 * Poly Haven PBR shader presets — same CC0 set as the Forge Asset Browser.
 *
 * WebGL canvas: MeshPhysicalMaterial (look-matched to the catalog).
 * WebGPU / TSL: MeshStandardNodeMaterial with texture() nodes
 * (three.js NodeMaterial — https://threejs.org/docs/#NodeMaterial).
 *
 * Do not invent a second texture CDN. 1K maps. Tile via mapRepeat.
 */

import * as THREE from "three";
import type { MaterialComponent, MaterialKind } from "@workspace/scene-schema";
import { fetchPolyHavenFiles, type PolyHavenFiles } from "./polyhaven";

export interface PolyHavenShaderPreset {
  id: string;
  label: string;
  kind: MaterialKind;
  /** Tile so 1K maps stay sharp on SI floors/walls. */
  repeat: [number, number];
  roughness: number;
  metalness: number;
  color: string;
}

/** Curated slugs verified on api.polyhaven.com (1K PBR). */
export const POLYHAVEN_SHADER_PRESETS: readonly PolyHavenShaderPreset[] = [
  { id: "brick_wall_001", label: "Brick wall", kind: "Stone", repeat: [4, 4], roughness: 0.86, metalness: 0, color: "#c4b8a8" },
  { id: "cobblestone_floor_01", label: "Cobblestone", kind: "Stone", repeat: [6, 6], roughness: 0.9, metalness: 0, color: "#9a9084" },
  { id: "rock_wall", label: "Rock wall", kind: "Stone", repeat: [3, 3], roughness: 0.92, metalness: 0, color: "#8a8076" },
  { id: "concrete_wall_008", label: "Concrete", kind: "Stone", repeat: [3, 3], roughness: 0.88, metalness: 0.02, color: "#b0aaa4" },
  { id: "wood_planks", label: "Wood planks", kind: "Wood", repeat: [4, 4], roughness: 0.78, metalness: 0, color: "#8a6a45" },
  { id: "wood_floor", label: "Wood floor", kind: "Wood", repeat: [4, 4], roughness: 0.72, metalness: 0, color: "#7a5a38" },
  { id: "metal_plate", label: "Metal plate", kind: "Metal", repeat: [3, 3], roughness: 0.38, metalness: 0.92, color: "#8c9196" },
  { id: "rusty_metal_02", label: "Rusty metal", kind: "Metal", repeat: [3, 3], roughness: 0.7, metalness: 0.55, color: "#6b4a3a" },
  { id: "dirt", label: "Dirt ground", kind: "Solid", repeat: [8, 8], roughness: 0.95, metalness: 0, color: "#6b5a44" },
  { id: "sand_01", label: "Sand", kind: "Solid", repeat: [8, 8], roughness: 0.94, metalness: 0, color: "#cbb892" },
  { id: "roof_09", label: "Roof tiles", kind: "Solid", repeat: [4, 4], roughness: 0.82, metalness: 0, color: "#7a4a3a" },
  { id: "leather_red_02", label: "Leather", kind: "Cloth", repeat: [2, 2], roughness: 0.62, metalness: 0, color: "#6a2a24" },
];

export function presetById(id: string): PolyHavenShaderPreset | undefined {
  return POLYHAVEN_SHADER_PRESETS.find((p) => p.id === id);
}

export function presetsForKind(kind: MaterialKind | undefined): PolyHavenShaderPreset[] {
  if (!kind) return [...POLYHAVEN_SHADER_PRESETS];
  const hit = POLYHAVEN_SHADER_PRESETS.filter((p) => p.kind === kind);
  return hit.length ? hit : [...POLYHAVEN_SHADER_PRESETS];
}

export function materialPatchFromFiles(
  files: PolyHavenFiles,
  preset?: PolyHavenShaderPreset,
): MaterialComponent {
  const t = files.texture;
  return {
    kind: preset?.kind,
    color: preset?.color ?? "#ffffff",
    roughness: preset?.roughness ?? 0.7,
    metalness: preset?.metalness ?? 0,
    mapUrl: t?.diffuse?.url,
    normalMapUrl: t?.normal?.url,
    roughnessMapUrl: t?.roughness?.url,
    metalnessMapUrl: t?.metalness?.url,
    aoMapUrl: t?.ao?.url,
    displacementMapUrl: t?.displacement?.url,
    mapRepeat: preset?.repeat ?? [1, 1],
    shaderPreset: files.slug,
    shaderModel: "standard",
  };
}

export async function fetchPresetMaterial(id: string): Promise<MaterialComponent> {
  const preset = presetById(id);
  if (!preset) throw new Error(`Unknown Poly Haven preset: ${id}`);
  const files = await fetchPolyHavenFiles(preset.id);
  if (!files.texture?.diffuse && !files.texture?.normal) {
    throw new Error(`Poly Haven ${preset.id} has no PBR maps`);
  }
  return materialPatchFromFiles(files, preset);
}

export interface PolyHavenMaps {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  metalnessMap: THREE.Texture | null;
  aoMap: THREE.Texture | null;
  displacementMap: THREE.Texture | null;
}

/** Copy uv → uv2 so aoMap samples (MeshStandard/Physical). */
export function ensureAoUv2(geom: THREE.BufferGeometry): void {
  if (geom.getAttribute("uv2") || !geom.getAttribute("uv")) return;
  geom.setAttribute("uv2", geom.getAttribute("uv"));
}

/**
 * TSL NodeMaterial using the same Poly Haven maps.
 * Only attach when the renderer is WebGPU (NodeMaterial is not WebGL).
 */
export async function createPolyHavenNodeMaterial(
  maps: PolyHavenMaps,
  opts: { roughness: number; metalness: number; color: string; repeat: [number, number]; displacementScale?: number },
): Promise<THREE.Material | null> {
  try {
    const webgpu = await import("three/webgpu");
    const tsl = await import("three/tsl");
    const NodeMat = webgpu.MeshStandardNodeMaterial;
    if (!NodeMat) return null;
    const mat = new NodeMat({
      color: opts.color,
      roughness: opts.roughness,
      metalness: opts.metalness,
    }) as InstanceType<typeof NodeMat> & {
      colorNode?: unknown;
      normalNode?: unknown;
      roughnessNode?: unknown;
      metalnessNode?: unknown;
      aoNode?: unknown;
      positionNode?: unknown;
    };
    const u = tsl.uv().mul(tsl.vec2(opts.repeat[0], opts.repeat[1]));
    if (maps.map) mat.colorNode = tsl.texture(maps.map, u);
    if (maps.normalMap) mat.normalNode = tsl.texture(maps.normalMap, u);
    if (maps.roughnessMap) mat.roughnessNode = tsl.texture(maps.roughnessMap, u).r;
    if (maps.metalnessMap) mat.metalnessNode = tsl.texture(maps.metalnessMap, u).r;
    if (maps.aoMap) mat.aoNode = tsl.texture(maps.aoMap, u).r;
    if (maps.displacementMap) {
      const h = tsl.texture(maps.displacementMap, u).r.mul(opts.displacementScale ?? 0.04);
      mat.positionNode = tsl.positionLocal.add(tsl.normalLocal.mul(h));
    }
    mat.userData.polyHavenNode = true;
    return mat;
  } catch {
    return null;
  }
}
