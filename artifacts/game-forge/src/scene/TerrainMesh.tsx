/**
 * TerrainMesh — renders a `terrain` SceneEntity as a noise-displaced
 * grid mesh with vertex-colored biomes. Lives inside the outer
 * EntityRenderer's RigidBody wrapper, so the trimesh collider that
 * RigidBody auto-generates from this geometry IS the walkable surface.
 *
 * Why a dedicated component (vs a special case in MeshBody):
 *   - the geometry is expensive to build (O(segments²)) so we cache it
 *     in useMemo keyed on the terrain knobs;
 *   - the mesh needs `vertexColors` enabled on its material, which the
 *     standard MeshBody flow doesn't expose.
 */
import { useMemo } from "react";
import * as THREE from "three";
import type { SceneEntity } from "@workspace/scene-schema";
import { buildTerrainGeometry } from "@/lib/proceduralTerrain";

const SELECTION_COLOR = "#d4af37";
const FALLBACK: NonNullable<SceneEntity["terrain"]> = {
  size: 200,
  segments: 64,
  heightAmp: 6,
  heightSeed: 1,
};

export function TerrainMesh({
  entity,
  selected,
  onPick,
}: {
  entity: SceneEntity;
  selected?: boolean;
  onPick?: () => void;
}) {
  const t = entity.terrain ?? FALLBACK;
  const geometry = useMemo(
    () =>
      buildTerrainGeometry({
        size: t.size,
        segments: t.segments,
        heightAmp: t.heightAmp,
        heightSeed: t.heightSeed,
        noiseScale: t.noiseScale,
      }),
    [t.size, t.segments, t.heightAmp, t.heightSeed, t.noiseScale],
  );

  return (
    <>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onPick?.();
        }}
      >
        <meshStandardMaterial
          vertexColors
          metalness={0}
          roughness={0.95}
          side={THREE.FrontSide}
        />
      </mesh>
      {selected && (
        <mesh geometry={geometry} renderOrder={999}>
          <meshBasicMaterial
            color={SELECTION_COLOR}
            wireframe
            transparent
            opacity={0.5}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}
    </>
  );
}
