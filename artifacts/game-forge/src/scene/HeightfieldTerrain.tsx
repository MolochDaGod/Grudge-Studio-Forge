/**
 * Super Terrain heightfield mesh — same bake as create_world / mapGen.
 * Edit + play share this geometry; play RigidBody uses trimesh on it.
 */
import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { SceneEntity } from "@workspace/scene-schema";
import { BIOME_GROUND, ISLAND_BIOMES } from "@/lib/superTerrainWorld";

export function buildHeightfieldGeometry(entity: SceneEntity): THREE.BufferGeometry | null {
  const hf = entity.heightfield;
  if (!hf || hf.cols < 2 || hf.rows < 2 || hf.heights.length < hf.cols * hf.rows) return null;
  const cols = hf.cols;
  const rows = hf.rows;
  const extentX = (cols - 1) * hf.cellSize;
  const extentZ = (rows - 1) * hf.cellSize;
  const pos = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const color = new THREE.Color(entity.material?.color ?? "#3d6b2e");
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = iz * cols + ix;
      const h01 = hf.heights[i] ?? 0;
      pos[i * 3] = (ix / (cols - 1) - 0.5) * extentX;
      pos[i * 3 + 1] = h01 * hf.maxHeight;
      pos[i * 3 + 2] = (iz / (rows - 1) - 0.5) * extentZ;
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
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
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
  const geom = useMemo(() => buildHeightfieldGeometry(entity), [entity.heightfield, entity.material?.color]);
  useEffect(() => () => geom?.dispose(), [geom]);
  if (!geom) return null;
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
        <meshStandardMaterial vertexColors roughness={0.92} metalness={0.02} />
      </mesh>
      {selected && (
        <mesh geometry={geom} scale={[1, 1.01, 1]} renderOrder={999}>
          <meshBasicMaterial color="#d4af37" wireframe transparent opacity={0.45} depthTest={false} />
        </mesh>
      )}
    </>
  );
}
