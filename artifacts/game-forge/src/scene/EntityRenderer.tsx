import { useAnimations, useGLTF } from "@react-three/drei";
import { CapsuleCollider, CylinderCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Suspense, forwardRef, useEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { resolveBuiltinModel } from "@/lib/builtinModels";
import type { SceneEntity } from "./types";

/** Resolve a model URL. Order:
 *   1. `builtin:<key>` → bundled Vite asset URL (works in dev + prod)
 *   2. absolute http(s)/data/blob → returned as-is
 *   3. anything else → treated as relative to the artifact BASE_URL */
function resolveModelUrl(url: string): string {
  const builtin = resolveBuiltinModel(url);
  if (builtin) return builtin;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${url.replace(/^\/+/, "")}`;
}

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
    // Proxy locators (created by "Expose Children" on a parent GLB) are
    // transform-only — the parent already renders the geometry. Show a small
    // wireframe gizmo only when the proxy is selected so the user can find it
    // in the viewport; otherwise render nothing visual.
    if (entity.model?.proxy) {
      if (!selected) return null;
      return (
        <mesh {...meshProps}>
          <boxGeometry args={[0.25, 0.25, 0.25]} />
          <meshBasicMaterial color={SELECTION_COLOR} wireframe />
        </mesh>
      );
    }
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

  // Selection overlay is a SIBLING (not a child) and slightly inflated so it
  // is never coplanar with the underlying mesh — coplanar surfaces z-fight as
  // the camera moves and looks like flicker. depthTest=false also means the
  // wireframe renders cleanly on top regardless of view angle.
  return (
    <>
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
      </mesh>
      {selected && (
        <mesh scale={1.04} renderOrder={999}>
          {TYPE_GEOMETRY[entity.type] ?? TYPE_GEOMETRY.box}
          <meshBasicMaterial
            color={SELECTION_COLOR}
            wireframe
            transparent
            opacity={0.85}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}
    </>
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
        <mesh renderOrder={999}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshBasicMaterial
            color={SELECTION_COLOR}
            wireframe
            transparent
            opacity={0.85}
            depthTest={false}
            depthWrite={false}
          />
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
      <LoadedModel
        url={url}
        clip={entity.model?.clip}
        tint={entity.model?.tint}
        label={entity.model?.label}
        selected={selected}
        onPick={onPick}
      />
    </Suspense>
  );
}

/** Build a billboard sprite that renders a name-tag canvas above an entity.
 *  Mirrors the PlayerImporter._createNameLabel pattern (rounded pill, white
 *  text, depthTest off so it never gets occluded). */
function buildLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  // Pill background
  ctx.fillStyle = "rgba(10, 10, 20, 0.78)";
  const r = 24;
  const w = canvas.width - 8;
  const h = canvas.height - 8;
  ctx.beginPath();
  ctx.moveTo(4 + r, 4);
  ctx.lineTo(4 + w - r, 4);
  ctx.quadraticCurveTo(4 + w, 4, 4 + w, 4 + r);
  ctx.lineTo(4 + w, 4 + h - r);
  ctx.quadraticCurveTo(4 + w, 4 + h, 4 + w - r, 4 + h);
  ctx.lineTo(4 + r, 4 + h);
  ctx.quadraticCurveTo(4, 4 + h, 4, 4 + h - r);
  ctx.lineTo(4, 4 + r);
  ctx.quadraticCurveTo(4, 4, 4 + r, 4);
  ctx.closePath();
  ctx.fill();
  // Gold border (brand)
  ctx.strokeStyle = "rgba(212, 175, 55, 0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();
  // Text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px 'Cinzel', 'Spectral SC', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.5, 0.625, 1);
  return sprite;
}

interface LoadedModelProps {
  url: string;
  clip?: string;
  tint?: string;
  label?: string;
  selected?: boolean;
  onPick?: () => void;
}

function LoadedModel({ url, clip, tint, label, selected, onPick }: LoadedModelProps) {
  const resolved = useMemo(() => resolveModelUrl(url), [url]);
  const gltf = useGLTF(resolved);
  // SkeletonUtils.clone preserves bone bindings for skinned meshes (regular
  // .clone() breaks them — would T-pose every instance after the first).
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf]);
  const groupRef = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(gltf.animations, groupRef);

  // ── Animation: explicit `clip` wins; otherwise fall back to idle/loop heuristic.
  useEffect(() => {
    if (!names.length) return;
    const requested = clip && names.includes(clip) ? clip : null;
    const chosen =
      requested ??
      names.find((n) => /idle/i.test(n)) ??
      names.find((n) => /loop/i.test(n)) ??
      names[0];
    const action = actions[chosen];
    if (!action) return;
    action.reset().fadeIn(0.2).play();
    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, names, clip]);

  // ── Tint: clone materials so coloring one entity doesn't bleed across
  // every spawned copy that shares the cached GLB material instances.
  // Inspired by PlayerImporter._applyTint (team color / variant differentiation).
  useEffect(() => {
    if (!tint) return;
    const tintColor = new THREE.Color(tint);
    const restorers: Array<() => void> = [];
    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const apply = (m: THREE.Material): THREE.Material => {
        if (
          m instanceof THREE.MeshStandardMaterial ||
          m instanceof THREE.MeshPhongMaterial ||
          m instanceof THREE.MeshBasicMaterial
        ) {
          const cm = m.clone();
          cm.color.copy(tintColor);
          cm.needsUpdate = true;
          return cm;
        }
        return m;
      };
      const orig = child.material;
      child.material = Array.isArray(orig) ? orig.map(apply) : apply(orig);
      restorers.push(() => {
        child.material = orig;
      });
    });
    return () => {
      for (const r of restorers) r();
    };
  }, [cloned, tint]);

  // ── Label: floating sprite above the model. Repositioned each frame would
  // be ideal but a static "above bbox" placement covers 95% of cases.
  const labelRef = useRef<THREE.Sprite | null>(null);
  useEffect(() => {
    if (!label || !groupRef.current) return;
    const sprite = buildLabelSprite(label);
    // Position at the top of the model's local bounding box.
    const box = new THREE.Box3().setFromObject(cloned);
    const top = isFinite(box.max.y) ? box.max.y + 0.3 : 1.8;
    sprite.position.set(0, top, 0);
    groupRef.current.add(sprite);
    labelRef.current = sprite;
    return () => {
      sprite.parent?.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      labelRef.current = null;
    };
  }, [label, cloned]);

  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
    >
      <primitive object={cloned} />
      {selected && <ModelSelectionBox target={cloned} />}
    </group>
  );
}

/** A wireframe box sized to the model's actual bounding box, rendered on top
 *  with depthTest off so it never z-fights with the model surfaces. */
function ModelSelectionBox({ target }: { target: THREE.Object3D }) {
  const { center, size } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(target);
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    box.getCenter(c);
    box.getSize(s);
    if (!isFinite(s.x) || s.x === 0) s.set(1, 1, 1);
    return { center: c, size: s };
  }, [target]);
  return (
    <mesh position={center} renderOrder={999}>
      <boxGeometry args={[size.x * 1.05, size.y * 1.05, size.z * 1.05]} />
      <meshBasicMaterial
        color={SELECTION_COLOR}
        wireframe
        transparent
        opacity={0.6}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
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

    // For model entities we never want auto-generated colliders that wrap the
    // mesh (a humanoid like Blake would produce a wonky convex hull). Instead,
    // when the user picks a primitive collider type we attach an explicit
    // primitive collider sized for a typical character, and for everything
    // else we fall back to a coarse cuboid hull.
    const isModel = entity.type === "model";
    const explicitForModel = isModel && (colliderShape === "cylinder" || colliderShape === "ball");

    // Player-controlled bodies must yaw freely but never tip over from a
    // sideways collision impulse. Allowing only Y-axis rotation gives us
    // physics-friendly characters without needing a full kinematic-character
    // controller. Non-player rigid bodies keep their default (full) rotation
    // axes so prop physics looks natural.
    const isPlayerControlled =
      !!entity.controllerKind && entity.controllerKind !== "none";

    return (
      <RigidBody
        ref={ref as React.Ref<RapierRigidBody>}
        type={ph.bodyType ?? "dynamic"}
        position={tr.position}
        rotation={tr.rotation}
        enabledRotations={isPlayerControlled ? [false, true, false] : undefined}
        colliders={
          explicitForModel
            ? false
            : colliderShape === "ball"
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
        {/* Capsule for character-shaped models, sphere for round ones.
            Half-height 0.85, radius 0.4 ≈ a 1.7m-tall humanoid sitting on
            its feet (matches Blake). Position offset puts the collider center
            at y=0.85 so the capsule's base aligns with the model's pivot. */}
        {explicitForModel && colliderShape === "cylinder" && (
          <CapsuleCollider args={[0.85, 0.4]} position={[0, 0.85, 0]} />
        )}
        {explicitForModel && colliderShape === "ball" && (
          <CylinderCollider args={[0.5, 0.5]} position={[0, 0.5, 0]} />
        )}
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
