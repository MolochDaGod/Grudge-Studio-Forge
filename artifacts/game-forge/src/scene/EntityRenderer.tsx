import { useAnimations, useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { CapsuleCollider, CylinderCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Suspense, forwardRef, useEffect, useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { resolveBuiltinModel } from "@/lib/builtinModels";
import { extendGltfLoader } from "@/lib/gltfLoaderConfig";
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
  /** Right-click hit. Fires from the same outer wrapper that owns onPick.
   *  The viewport snapshots the entity id into a ref so the surrounding
   *  Radix `<ContextMenu>` can render entity-aware actions. */
  onContext?: () => void;
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
        // Brand-gold wireframe placeholder while the GLB streams in.
        // Color was previously "#444" (dark gray) which blended into the
        // editor's dark background — large maps could spend 5–30 s
        // downloading and the user couldn't tell anything was happening.
        // Gold (#d4af37) reads cleanly against both the lit editor scene
        // and the dark grid pattern, so it actually communicates "loading".
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={SELECTION_COLOR} wireframe />
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
        // Convention: any entity literally named "Map" is treated as
        // an environment / level mesh and drop-aligned to local Y=0
        // so its visible floor sits flush with the invisible Ground
        // plane templates pair it with. Cheap (one bbox per GLB load)
        // and benefits every template that uses the same naming
        // pattern (tps-zombies, fps-arena, all dm-*).
        dropToGround={entity.name?.toLowerCase() === "map"}
        // Map entities get a "walk" surface tag so spatial queries
        // (PlayRuntime → groundProbe) can identify what they hit.
        // Future: extend to read entity.model?.surface for water /
        // ladder / dig zones authored at the template level.
        surfaceTag={entity.name?.toLowerCase() === "map" ? "walk" : undefined}
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

/** Tracks textures whose filtering we've already upgraded so we don't
 *  walk + flag the same shared GLB texture every time another instance
 *  spawns (e.g. cloning a single Map across a level). WeakSet so cached
 *  textures get GC'd normally when the GLB unloads. */
const touchedTextures: WeakSet<THREE.Texture> = new WeakSet();

interface LoadedModelProps {
  url: string;
  clip?: string;
  tint?: string;
  label?: string;
  selected?: boolean;
  onPick?: () => void;
  /** When true, after cloning the GLB scene we measure its local bounding
   *  box and shift the inner scene so its lowest point sits at the
   *  entity's local Y=0. This is what lets large environment maps (whose
   *  GLB origin is often above their visible floor) align flush with the
   *  invisible Ground collision plane at world Y=0 instead of floating
   *  above it / sinking below it. */
  dropToGround?: boolean;
  /** Surface tag stamped onto the cloned root's `userData.surface`, so
   *  spatial-query helpers (see scene/PlayRuntime.ts → `groundProbe`)
   *  can identify what kind of ground a raycast hit. Tag vocabulary:
   *  "walk" | "climb" | "swim" | "dig" | "slip" | "damage" | "nojump".
   *  See `.agents/skills/spatial-queries-and-surfaces/SKILL.md` §3. */
  surfaceTag?: string;
}

function LoadedModel({ url, clip, tint, label, selected, onPick, dropToGround, surfaceTag }: LoadedModelProps) {
  const resolved = useMemo(() => resolveModelUrl(url), [url]);
  // useGLTF(url, useDraco, useMeshOpt, extendLoader). We deliberately pass
  // `false, false` so drei does NOT install its own DRACO/Meshopt
  // decoders — `extendGltfLoader` runs first, then drei's own setters
  // would overwrite our singleton DRACOLoader with a fresh one. Letting
  // our extender be authoritative means every load path in the app
  // (drei `useGLTF` here, the SHARED_LOADER in `glbHierarchy.ts`, and
  // the standalone `useLoader(GLTFLoader, ...)` calls in the model /
  // placeholder surfaces) shares one DRACOLoader + one Meshopt decoder
  // instance — only one worker pool, one ~200KB WASM download per
  // session.
  //
  // Cast: drei's GLTFLoader type narrows ktx2Loader / meshoptDecoder
  // field types differently than three's published .d.ts, but at
  // runtime they're the same class.
  const gltf = useGLTF(
    resolved,
    false,
    false,
    extendGltfLoader as unknown as Parameters<typeof useGLTF>[3],
  );
  // SkeletonUtils.clone preserves bone bindings for skinned meshes (regular
  // .clone() breaks them — would T-pose every instance after the first).
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf]);
  const groupRef = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(gltf.animations, groupRef);

  // Drop-to-ground: lift the inner scene so its world-y min = 0 in local
  // space. We do this on the cloned scene's position (NOT the entity
  // transform) so saved scene data + scripts + physics all keep seeing
  // the original transform — only the visual mesh shifts. useLayoutEffect
  // (not useMemo) because this is a side effect on the cloned object,
  // and we want it applied synchronously before paint so the selection
  // wireframe / label sprite (which both call setFromObject(cloned) of
  // their own) read the already-shifted bounds. Reversible: we restore
  // the original position on cleanup so toggling dropToGround at
  // runtime can't leave a stale offset baked in.
  useLayoutEffect(() => {
    if (!dropToGround) return;
    // Box3.setFromObject walks the subtree applying each node's local
    // matrix, so the result is in `cloned`'s local space — exactly what
    // we want, since the entity's parent group will then apply scale +
    // position on top.
    const box = new THREE.Box3().setFromObject(cloned);
    if (!isFinite(box.min.y)) return;
    const originalY = cloned.position.y;
    cloned.position.y -= box.min.y;
    return () => {
      cloned.position.y = originalY;
    };
  }, [cloned, dropToGround]);

  // ── Surface tagging: stamp the cloned root's userData so a downstream
  // raycast (e.g. PlayRuntime → groundProbe) can read what kind of
  // ground it hit by walking the parent chain to find this tag. The tag
  // lives on the cloned scene rather than on the entity group because
  // `THREE.Raycaster.intersectObjects(scene.children, true)` returns the
  // hit *mesh* — and reading its `userData` chain is cheaper if the tag
  // is on the cloned root rather than several levels up at the entity
  // group. Defaults to "walk" when no explicit tag is provided so any
  // unmarked Map mesh still produces a useful read.
  useLayoutEffect(() => {
    const tag = surfaceTag ?? "walk";
    const prev = (cloned.userData as { surface?: string }).surface;
    (cloned.userData as { surface?: string }).surface = tag;
    return () => {
      if (prev === undefined) {
        delete (cloned.userData as { surface?: string }).surface;
      } else {
        (cloned.userData as { surface?: string }).surface = prev;
      }
    };
  }, [cloned, surfaceTag]);

  // ── Texture quality: bump anisotropic filtering on every texture in the
  // GLB so floor/wall textures stay sharp at oblique camera angles
  // (especially noticeable on the large Map GLBs and their tiled
  // ground textures). We mutate the **original** `gltf.scene` rather
  // than the clone because every cloned instance shares the same
  // cached texture objects (drei `useGLTF` caches by URL); doing it
  // once on the source benefits every spawn. A module-level WeakSet
  // dedupes so re-mounting LoadedModel for a cached GLB does not
  // re-walk textures we already touched.
  //
  // useLayoutEffect (not useEffect): runs synchronously after DOM
  // mutations but **before paint**, so we set anisotropy on textures
  // before the renderer's first upload of this material — avoiding a
  // second GPU upload that would otherwise happen when the post-paint
  // useEffect later flipped `needsUpdate`. We also re-check the value
  // before bumping `needsUpdate` so a re-walk (e.g. somehow missing
  // the WeakSet) is still a no-op when the GPU is already in sync.
  const { gl } = useThree();
  useLayoutEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    if (maxAniso <= 1) return;
    gltf.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        // MeshStandard/Physical/Phong/Basic all share these slot names
        // when present. Reading via index keeps this future-proof for
        // material types we don't explicitly enumerate.
        const slots: string[] = [
          "map", "normalMap", "roughnessMap", "metalnessMap",
          "emissiveMap", "aoMap", "alphaMap",
        ];
        for (const slot of slots) {
          const tex = (m as unknown as Record<string, unknown>)[slot];
          if (!(tex instanceof THREE.Texture)) continue;
          if (touchedTextures.has(tex)) continue;
          if (tex.anisotropy !== maxAniso) {
            tex.anisotropy = maxAniso;
            tex.needsUpdate = true;
          }
          touchedTextures.add(tex);
        }
      }
    });
  }, [gltf, gl]);

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
  const { entity, playMode, children, onContext } = props;
  // Bubble-phase R3F synthetic event. We DO call stopPropagation so the
  // innermost mesh wins — without it a parent EntityRenderer for a GLB
  // root would also fire and overwrite `lastContextEntityIdRef` with the
  // ancestor's id. Note: r3f's `stopPropagation` only halts traversal
  // through the r3f event graph; the underlying DOM `contextmenu` still
  // bubbles up to the surrounding Radix `<ContextMenuTrigger>` div, so
  // the menu opens normally with the correct entity in scope.
  const handleContext = onContext
    ? (e: { stopPropagation?: () => void }) => {
        e.stopPropagation?.();
        onContext();
      }
    : undefined;
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
    //
    // ⚠️ This prop must be conditionally SPREAD (not just set to undefined
    // for the non-player case) — react-three-rapier's `setRigidBodyOptions`
    // checks `if (key in options)` and then destructures the value as
    // `[x, y, z]`. Passing `enabledRotations={undefined}` keeps the key on
    // the props object, so it tries to iterate `undefined` and crashes
    // every render with "undefined is not iterable" inside CanvasImpl,
    // which Replit's runtime-error overlay was eating the stack of.
    const isPlayerControlled =
      !!entity.controllerKind && entity.controllerKind !== "none";
    const playerRotationLockProps: { enabledRotations?: [boolean, boolean, boolean] } =
      isPlayerControlled ? { enabledRotations: [false, true, false] } : {};

    return (
      <RigidBody
        ref={ref as React.Ref<RapierRigidBody>}
        type={ph.bodyType ?? "dynamic"}
        position={tr.position}
        rotation={tr.rotation}
        {...playerRotationLockProps}
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
        {/* `onContextMenu` lives on the inner group rather than on
            RigidBody itself — @react-three/rapier's RigidBody doesn't
            forward DOM-style pointer events. The group catches the same
            r3f synthetic event for the entity's visible geometry. */}
        <group scale={tr.scale} onContextMenu={handleContext}>
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
      onContextMenu={handleContext}
    >
      <MeshBody {...props} />
      {children}
    </group>
  );
});
