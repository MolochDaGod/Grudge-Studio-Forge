/**
 * Super Terrain heightfield mesh — same bake as create_world / mapGen.
 * Edit + play share this geometry; play RigidBody uses trimesh on it.
 * Albedo: Poly Haven 1K (shaderPreset) or Super Terrain channel canvas —
 * never autoload 15–85 MB Ground_N.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import * as THREE from "three";
import type { MaterialComponent, SceneEntity } from "@workspace/scene-schema";
import {
  BIOME_GROUND,
  ISLAND_BIOMES,
  SUPER_TERRAIN_CHANNELS,
} from "@/lib/superTerrainWorld";
import { useMaterialTextures } from "@/lib/useMaterialTextures";
import { fetchPresetMaterial } from "@/lib/polyHavenShader";

export function buildHeightfieldGeometry(entity: SceneEntity): THREE.BufferGeometry | null {
  const hf = entity.heightfield;
  if (!hf || hf.cols < 2 || hf.rows < 2 || hf.heights.length < hf.cols * hf.rows) return null;
  const cols = hf.cols;
  const rows = hf.rows;
  const extentX = (cols - 1) * hf.cellSize;
  const extentZ = (rows - 1) * hf.cellSize;
  const pos = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const color = new THREE.Color(entity.material?.color ?? "#3d6b2e");
  const tileM = 8;
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = iz * cols + ix;
      const h01 = hf.heights[i] ?? 0;
      const wx = (ix / (cols - 1) - 0.5) * extentX;
      const wz = (iz / (rows - 1) - 0.5) * extentZ;
      pos[i * 3] = wx;
      pos[i * 3 + 1] = h01 * hf.maxHeight;
      pos[i * 3 + 2] = wz;
      uvs[i * 2] = wx / tileM;
      uvs[i * 2 + 1] = wz / tileM;
      const biome = hf.biomes?.[i];
      const hex =
        biome != null && ISLAND_BIOMES[biome]
          ? BIOME_GROUND[ISLAND_BIOMES[biome]]
          : entity.material?.color ?? "#3d6b2e";
      color.set(hex);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
  }
  const indices: number[] = [];
  for (let iz = 0; iz < rows - 1; iz++) {
    for (let ix = 0; ix < cols - 1; ix++) {
      const a = iz * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setAttribute("uv2", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return [80, 110, 50];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Super Terrain Grass/Rock/Soil/Snow channels as a tiled detail map (no Ground_N). */
function makeChannelDetailTexture(seed = 1): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (!ctx) return tex;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const pal = SUPER_TERRAIN_CHANNELS.map((c) => hexToRgb(c.color));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const n =
        Math.sin((nx * 17.1 + seed) * 12.9898 + ny * 78.233) * 43758.5453;
      const f = n - Math.floor(n);
      const n2 =
        Math.sin((nx * 9.4 + ny * 5.2 + seed * 0.17) * 23.13) * 23421.13;
      const f2 = n2 - Math.floor(n2);
      const band = f2 < 0.18 ? 1 : f2 < 0.38 ? 2 : f2 > 0.92 ? 3 : 0;
      const [r, g, b] = pal[band] ?? pal[0]!;
      const d = 0.82 + f * 0.28;
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, r * d);
      data[i + 1] = Math.min(255, g * d);
      data[i + 2] = Math.min(255, b * d);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;
  return tex;
}

function useSuperTerrainMaps(material: MaterialComponent | undefined) {
  const resolved = material?.mapUrl
    ? material
    : {
        ...material,
        mapUrl: SUPER_TERRAIN_CHANNELS[0].albedo,
        mapRepeat: material?.mapRepeat ?? ([1, 1] as [number, number]),
      };
  const local = useMaterialTextures(resolved);
  const [presetMat, setPresetMat] = useState<MaterialComponent | undefined>();
  const preset = material?.shaderPreset;
  useEffect(() => {
    if (!preset || material?.mapUrl || resolved.mapUrl) {
      setPresetMat(undefined);
      return;
    }
    let live = true;
    fetchPresetMaterial(preset)
      .then((patch) => {
        if (live) setPresetMat({ ...material, ...patch, mapRepeat: material?.mapRepeat ?? [1, 1] });
      })
      .catch(() => {
        if (live) setPresetMat(undefined);
      });
    return () => {
      live = false;
    };
  }, [preset, material?.mapUrl]);
  const fromPreset = useMaterialTextures(presetMat);
  return local.map ? local : fromPreset;
}

export function HeightfieldTerrainMesh({
  entity,
  selected,
  onPick,
}: {
  entity: SceneEntity;
  selected?: boolean;
  onPick?: () => void;
}): ReactElement | null {
  const geom = useMemo(
    () => buildHeightfieldGeometry(entity),
    [entity.heightfield, entity.material?.color],
  );
  const maps = useSuperTerrainMaps(entity.material);
  const fallback = useMemo(() => makeChannelDetailTexture(entity.heightfield?.cols ?? 1), [entity.heightfield?.cols]);
  useEffect(() => () => geom?.dispose(), [geom]);
  useEffect(() => () => fallback.dispose(), [fallback]);
  if (!geom) return null;
  const albedo = maps.map ?? fallback;
  return (
    <>
      <mesh
        geometry={geom}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onPick?.();
        }}
      >
        <meshStandardMaterial
          vertexColors
          color="#ffffff"
          map={albedo}
          normalMap={maps.normalMap ?? undefined}
          roughnessMap={maps.roughnessMap ?? undefined}
          aoMap={maps.aoMap ?? undefined}
          roughness={entity.material?.roughness ?? 0.92}
          metalness={entity.material?.metalness ?? 0.02}
        />
      </mesh>
      {selected && (
        <mesh geometry={geom} scale={[1, 1.01, 1]} renderOrder={999}>
          <meshBasicMaterial color="#d4af37" wireframe transparent opacity={0.45} depthTest={false} />
        </mesh>
      )}
    </>
  );
}
