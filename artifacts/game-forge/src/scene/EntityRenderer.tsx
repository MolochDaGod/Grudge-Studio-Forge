import { useGLTF } from "@react-three/drei";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Suspense, forwardRef, useMemo, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import type { SceneEntity } from "./types";

interface RenderProps {
  entity: SceneEntity;
  selected?: boolean;
  onPick?: () => void;
  playMode: boolean;
  /** Child entities rendered inside this entity's group so they inherit
   *  its transform (Unity-style hierarchy). */
  children?: ReactNode;
}

const TYPE_GEOMETRY: Record<string, ReactElement> = {
  box: <boxGeometry args={[1, 1, 1]} />,
  sphere: <sphereGeometry args={[0.5, 32, 32]} />,
  cylinder: <cylinderGeometry args={[0.5, 0.5, 1, 32]} />,
  plane: <planeGeometry args={[1, 1, 1, 1]} />,
};

// Brand selection / wireframe color (Grudge Studio gold #d4af37)
const SELECTION_COLOR = "#d4af37";

function MeshBody({ entity, selected, onPick }: RenderProps) {
  const mat = entity.material ?? {};
  const color = mat.color ?? SELECTION_COLOR;
  const emissive = mat.emissive ?? "#000000";

  const meshProps = {
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onPick?.();
    },
    castShadow: true,
    receiveShadow: true,
  };

  if (entity.type === "model") {
    return <ModelEntity entity={entity} selected={selected} onPick={onPick} playMode={false} />;
  }
  if (entity.type === "light") {
    return <LightEntity entity={entity} selected={selected} onPick={onPick} playMode={false} />;
  }
  if (entity.type === "empty") {
    return (
      <mesh {...meshProps}>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <meshBasicMaterial color={selected ? SELECTION_COLOR : "#666"} wireframe />
      </mesh>
    );
  }

  return (
    <mesh {...meshProps}>
      {TYPE_GEOMETRY[entity.type] ?? TYPE_GEOMETRY.box}
      <meshStandardMaterial
        color={color}
        metalness={mat.metalness ?? 0.1}
        roughness={mat.roughness ?? 0.6}
        emissive={emissive}
        emissiveIntensity={emissive !== "#000000" ? 0.6 : 0}
        side={entity.type === "plane" ? THREE.DoubleSide : THREE.FrontSide}
      />
      {selected && (
        <mesh>
          {TYPE_GEOMETRY[entity.type] ?? TYPE_GEOMETRY.box}
          <meshBasicMaterial color={SELECTION_COLOR} wireframe transparent opacity={0.6} />
        </mesh>
      )}
    </mesh>
  );
}

function LightEntity({ entity, selected, onPick }: RenderProps) {
  const lc = entity.light ?? {};
  const color = lc.color ?? "#ffffff";
  const intensity = lc.intensity ?? 4;
  const distance = lc.distance ?? 20;
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
    >
      {lc.kind === "directional" ? (
        <directionalLight color={color} intensity={intensity / 4} castShadow />
      ) : lc.kind === "spot" ? (
        <spotLight color={color} intensity={intensity} distance={distance} angle={0.6} penumbra={0.5} castShadow />
      ) : (
        <pointLight color={color} intensity={intensity} distance={distance} castShadow />
      )}
      <mesh>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshBasicMaterial color={selected ? SELECTION_COLOR : color} />
      </mesh>
      {selected && (
        <mesh>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshBasicMaterial color={SELECTION_COLOR} wireframe />
        </mesh>
      )}
    </group>
  );
}

function ModelEntity({ entity, selected, onPick }: RenderProps) {
  const url = entity.model?.url;
  if (!url) {
    return (
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onPick?.();
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#888" wireframe />
      </mesh>
    );
  }
  return (
    <Suspense
      fallback={
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#444" wireframe />
        </mesh>
      }
    >
      <LoadedModel url={url} selected={selected} onPick={onPick} />
    </Suspense>
  );
}

function LoadedModel({ url, selected, onPick }: { url: string; selected?: boolean; onPick?: () => void }) {
  const gltf = useGLTF(url);
  const cloned = useMemo(() => gltf.scene.clone(true), [gltf]);
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
    >
      <primitive object={cloned} />
      {selected && (
        <mesh>
          <boxGeometry args={[1.2, 1.2, 1.2]} />
          <meshBasicMaterial color={SELECTION_COLOR} wireframe transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  );
}

export const EntityRenderer = forwardRef<THREE.Group | RapierRigidBody, RenderProps>(function EntityRenderer(
  props,
  ref,
) {
  const { entity, playMode, children } = props;
  const tr = entity.transform;
  const usePhysics = playMode && entity.physics && entity.type !== "light" && entity.type !== "camera";

  if (usePhysics) {
    const ph = entity.physics!;
    const colliderShape =
      ph.colliderType ??
      (entity.type === "sphere" ? "ball" : entity.type === "cylinder" ? "cylinder" : "cuboid");

    return (
      <RigidBody
        ref={ref as React.Ref<RapierRigidBody>}
        type={ph.bodyType ?? "dynamic"}
        position={tr.position}
        rotation={tr.rotation}
        colliders={
          colliderShape === "ball"
            ? "ball"
            : colliderShape === "cylinder"
              ? "hull"
              : colliderShape === "trimesh"
                ? "trimesh"
                : "cuboid"
        }
        restitution={ph.restitution ?? 0.4}
        friction={ph.friction ?? 0.6}
        mass={ph.mass ?? 1}
        userData={{ entityId: entity.id, name: entity.name }}
      >
        <group scale={tr.scale}>
          <MeshBody {...props} />
          {children}
        </group>
      </RigidBody>
    );
  }

  return (
    <group
      ref={ref as React.Ref<THREE.Group>}
      position={tr.position}
      rotation={tr.rotation}
      scale={tr.scale}
      userData={{ entityId: entity.id, name: entity.name }}
    >
      <MeshBody {...props} />
      {children}
    </group>
  );
});
