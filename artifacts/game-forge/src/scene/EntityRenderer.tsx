import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CapsuleCollider,
  ConvexHullCollider,
  CylinderCollider,
  RigidBody,
  type IntersectionEnterPayload,
  type IntersectionExitPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { deserializeHullSet, type ConvexHullSet } from "@/lib/colliderBaker";
import { getPlaySession } from "./playSession";
import type { TriggerEvent } from "./GameBus";
import { Suspense, forwardRef, useEffect, useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { resolveBuiltinModel, resolveModelUrl, BUILTIN_MODEL_YAW_OFFSETS } from "@/lib/builtinModels";
import { synthesizeBipedClips, getBipedProfile } from "@/lib/proceduralBipedAnimations";
import { extendGltfLoader } from "@/lib/gltfLoaderConfig";
import {
  DEFAULT_SENSOR_LAYERS,
  rapierCollisionGroups,
  resolveMaterialDefaults,
  resolveInheritedFields,
  indexEntitiesById,
  type LayerName,
  type MaterialKind,
  type MaterialComponent,
} from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";
import type { SceneEntity } from "./types";
import { ClothEntity, FlagEntity, ParticlesEntity } from "./SoftBodies";

interface RenderProps {
  entity: SceneEntity;
  selected?: boolean;
  onPick?: () => void;
  /** Effective MaterialComponent after parent-chain inheritance. */
  effectiveMaterial?: MaterialComponent;
  /** Right-click hit. Fires from the same outer wrapper that owns onPick.
   *  The viewport snapshots the entity id into a ref so the surrounding
   *  Radix `<ContextMenu>` can render entity-aware actions. */
  onContext?: () => void;
  /** Pointer hovering this entity's group. Fired with `true` on enter and
   *  `false` on leave. Enter events forward the pointer's client coords so
   *  the viewport's hover chip can appear immediately without waiting for
   *  the next pointer-move tick. Only wired in edit mode. */
  onHover?: (hovering: boolean, clientX?: number, clientY?: number) => void;
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
  // Soft / dynamic Material entity types render as simple gizmo
  // primitives — visual stand-ins until a custom GLB is wired up.
  // Cloth = a draped 1×1 plane, Flag = a vertical plane on a thin
  // pole, Particles = a small instanced sprite cloud (sphere proxy
  // here for cheapness).
  cloth: <planeGeometry args={[1, 1, 4, 4]} />,
  flag: <planeGeometry args={[1, 0.6, 4, 2]} />,
  particles: <sphereGeometry args={[0.3, 8, 8]} />,
};

// Brand selection / wireframe color (Grudge Studio gold #d4af37)
const SELECTION_COLOR = "#d4af37";

function MeshBody({ entity, selected, onPick, effectiveMaterial }: RenderProps) {
  // Inherited material > local material. Lets a child without local
  // material pick up its parent's color/metalness/roughness/etc.
  const mat = effectiveMaterial ?? entity.material ?? {};
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
    return <ModelEntity entity={entity} selected={selected} onPick={onPick} playMode={false} effectiveMaterial={effectiveMaterial} />;
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

  // Soft / particle entity types route to dedicated simulators that
  // run in both edit and play mode so the user can preview the motion
  // as they tune the wind / damping / emit-rate sliders.
  if (entity.type === "flag") {
    return <FlagEntity entity={entity} selected={selected} onPick={onPick} effectiveMaterial={effectiveMaterial} />;
  }
  if (entity.type === "cloth") {
    return <ClothEntity entity={entity} selected={selected} onPick={onPick} effectiveMaterial={effectiveMaterial} />;
  }
  if (entity.type === "particles") {
    return <ParticlesEntity entity={entity} selected={selected} onPick={onPick} effectiveMaterial={effectiveMaterial} />;
  }

  // Selection overlay is a SIBLING (not a child) and slightly inflated so it
  // is never coplanar with the underlying mesh — coplanar surfaces z-fight as
  // the camera moves and looks like flicker. depthTest=false also means the
  // wireframe renders cleanly on top regardless of view angle.
  // Cloth / flag / particles already returned above (delegated to
  // dedicated soft-body simulators) — only the static primitives reach
  // this branch, so we don't need the legacy `isSoft` flag here.
  const matKind = mat.kind;
  const resolved = matKind ? resolveMaterialDefaults(mat) : null;
  const transparent = resolved && resolved.opacity < 1;
  const opacity = mat.opacity ?? resolved?.opacity ?? 1;
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
          transparent={!!transparent}
          opacity={opacity}
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

function ModelEntity({ entity, selected, onPick, effectiveMaterial }: RenderProps) {
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
        entityId={entity.id}
        clip={entity.model?.clip}
        tint={entity.model?.tint}
        material={effectiveMaterial ?? entity.material}
        label={entity.model?.label}
        selected={selected}
        onPick={onPick}
        yawOffset={entity.model?.yawOffset}
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
        surfaceTag={
          // Prefer the explicit surface tag set on the entity (drives
          // pathfinding + the agent FSM via userData lookups). Fall
          // back to the legacy name="Map"→walk heuristic so older
          // scenes that pre-date the surface field still spatially
          // probe the same way.
          entity.surface && entity.surface !== "None"
            ? entity.surface.toLowerCase()
            : entity.name?.toLowerCase() === "map"
              ? "walk"
              : undefined
        }
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

/** Per-entity desired clip name published by the agent FSM (Viewport.tsx
 *  refreshes it each play-mode tick). When present it overrides the
 *  static `entity.model.clip` so the renderer can crossfade in response
 *  to FSM transitions without coupling to agentRuntime. */
function readAgentClip(entityId: string): string | undefined {
  const w = window as unknown as { __agentClips?: Map<string, string> };
  return w.__agentClips?.get(entityId);
}

interface LoadedModelProps {
  /** Entity id — required so the animation manager can pull the FSM's
   *  current clip override out of `window.__agentClips`. */
  entityId: string;
  url: string;
  clip?: string;
  tint?: string;
  /** Effective MaterialComponent applied to GLB submesh materials
   *  (color/metalness/roughness/emissive/opacity). `tint` wins over
   *  `material.color` for legacy team-color flows. */
  material?: MaterialComponent;
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
  /** Optional Y-axis rotation override (radians) applied to a child group
   *  inside groupRef so the visual mesh faces the same direction the
   *  physics body's "forward" already points (-Z in three.js convention).
   *  Resolution: this prop > `BUILTIN_MODEL_YAW_OFFSETS[builtinKey]` > 0. */
  yawOffset?: number;
}

function LoadedModel({ entityId, url, clip, tint, material, label, selected, onPick, dropToGround, surfaceTag, yawOffset }: LoadedModelProps) {
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
    // reason: drei's useGLTF expects its own (three-stdlib) GLTFLoader
    // extender shape; runtime is identical, the .d.ts files diverge.
    extendGltfLoader as unknown as Parameters<typeof useGLTF>[3],
  );
  // SkeletonUtils.clone preserves bone bindings for skinned meshes (regular
  // .clone() breaks them — would T-pose every instance after the first).
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf]);
  const groupRef = useRef<THREE.Group>(null);
  // Augment the GLB's clip list with procedural idle/walk/run/attack
  // when the rig is a Max biped (`Bip001 …` bones) AND no clips were
  // baked in. This is what brings the toon-rts character pack to life
  // — those GLBs ship with `gltf.animations.length === 0` and the
  // separate `animationsweapons/male_locomotion/` URLs in the manifest
  // 404 today, so we synthesize against the shared skeleton at load
  // time. Cached per source scene inside `synthesizeBipedClips`, so
  // every clone of the same race shares the same `AnimationClip[]`
  // and drei's per-clone `useAnimations` binding stays cheap.
  // Per-race profile picker: scene JSON references each race rig as
  // `builtin:race:<id>`; we extract the id directly from the prop URL
  // (LoadedModel receives the raw key, not the resolved CDN URL — see
  // `resolveModelUrl` in the wrapper above) so the synthesizer can
  // build per-race-tuned tracks. Non-race / user-imported bipeds fall
  // back to `DEFAULT_BIPED_PROFILE` inside `getBipedProfile`.
  const profile = useMemo(() => {
    const raceId = url.startsWith("builtin:race:") ? url.slice("builtin:race:".length) : null;
    return getBipedProfile(raceId);
  }, [url]);
  const animations = useMemo(() => {
    if (gltf.animations.length > 0) return gltf.animations;
    const synth = synthesizeBipedClips(gltf.scene, profile);
    return synth.length > 0 ? synth : gltf.animations;
  }, [gltf, profile]);
  const { actions, names } = useAnimations(animations, groupRef);

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
          // reason: three.js Material slot names vary by subtype; probe
          // each named slot via an indexed view, then runtime-check it's
          // a Texture before mutating.
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

  // ── Animation: agent FSM clip override > explicit `clip` prop > idle/loop heuristic.
  //
  // `useFrame` polls the per-entity clip published by Viewport's agent
  // bridge each render tick. When the desired clip changes we crossfade
  // (0.2s) into it and stop the prior action with a matching fade-out
  // — driven entirely by drei's `useAnimations` actions, so the mixer
  // (which `useAnimations` already updates on every frame) handles the
  // blend without us calling `mixer.update` ourselves.
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentClipNameRef = useRef<string | null>(null);
  const pickClipName = (): string | null => {
    if (!names.length) return null;
    const fsmClip = readAgentClip(entityId);
    if (fsmClip && names.includes(fsmClip)) return fsmClip;
    if (clip && names.includes(clip)) return clip;
    return (
      names.find((n) => /idle/i.test(n)) ??
      names.find((n) => /loop/i.test(n)) ??
      names[0] ??
      null
    );
  };
  useFrame(() => {
    const desired = pickClipName();
    if (!desired || desired === currentClipNameRef.current) return;
    const next = actions[desired];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.2);
    next.reset();
    // The procedural "death" clip is a one-shot collapse. We switch
    // the AnimationAction to LoopOnce + clampWhenFinished so the body
    // holds the final fetal pose instead of springing back to T-pose.
    // Other clips (idle/walk/run/attack) keep the default LoopRepeat
    // so the existing crossfade behavior is preserved.
    if (desired === "death") {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.fadeIn(0.2).play();
    currentActionRef.current = next;
    currentClipNameRef.current = desired;
  });
  useEffect(() => {
    return () => {
      currentActionRef.current?.fadeOut(0.2);
      currentActionRef.current = null;
      currentClipNameRef.current = null;
    };
  }, []);

  // Material + Tint: clone GLB materials per-instance so coloring
  // one entity doesn't bleed across cached siblings. Applies both
  // legacy `tint` (team color) and the effective MaterialComponent
  // (color / metalness / roughness / emissive / opacity). `tint`
  // wins over material.color for legacy flows.
  const matColor = material?.color;
  const matMetalness = material?.metalness;
  const matRoughness = material?.roughness;
  const matEmissive = material?.emissive;
  const matOpacity = material?.opacity;
  useEffect(() => {
    const hasMaterial =
      matColor !== undefined ||
      matMetalness !== undefined ||
      matRoughness !== undefined ||
      matEmissive !== undefined ||
      matOpacity !== undefined;
    if (!tint && !hasMaterial) return;
    const colorOverride = tint ?? matColor;
    const colorObj = colorOverride ? new THREE.Color(colorOverride) : null;
    const emissiveObj = matEmissive ? new THREE.Color(matEmissive) : null;
    const restorers: Array<() => void> = [];
    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const apply = (m: THREE.Material): THREE.Material => {
        const isStd =
          m instanceof THREE.MeshStandardMaterial ||
          m instanceof THREE.MeshPhongMaterial ||
          m instanceof THREE.MeshBasicMaterial;
        if (!isStd) return m;
        const cm = m.clone();
        if (colorObj && "color" in cm) (cm as THREE.MeshStandardMaterial).color.copy(colorObj);
        if (cm instanceof THREE.MeshStandardMaterial) {
          if (matMetalness !== undefined) cm.metalness = matMetalness;
          if (matRoughness !== undefined) cm.roughness = matRoughness;
          if (emissiveObj) {
            cm.emissive.copy(emissiveObj);
            cm.emissiveIntensity = 0.6;
          }
        }
        if (matOpacity !== undefined && matOpacity < 1) {
          cm.transparent = true;
          cm.opacity = matOpacity;
        }
        cm.needsUpdate = true;
        return cm;
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
  }, [cloned, tint, matColor, matMetalness, matRoughness, matEmissive, matOpacity]);

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

  // ── Yaw offset: some asset packs author their characters facing +Z while
  // three.js' (and our physics yaw + camera forward) convention is -Z. We
  // apply the corrective rotation on a CHILD group nested INSIDE
  // `groupRef` so that:
  //   • bone animations on the cloned scene still play in the model's
  //     own local frame (the action's tracks reference the cloned root,
  //     not our wrapper group),
  //   • selection, label, picking, and userData stamping continue to
  //     read off `groupRef` / `cloned` exactly as before,
  //   • the rigidbody / entity transform stays untouched — only the
  //     visual mesh spins.
  // Resolution order: explicit per-entity `entity.model.yawOffset`
  // (handled by the renderer caller via the `clip`/`tint` style of prop
  // drilling — see EntityRenderer below where it forwards
  // `entity.model.yawOffset` as the `yawOffset` prop) > registry default
  // for the stripped builtin key > 0.
  const builtinKey = url.startsWith("builtin:") ? url.slice("builtin:".length) : null;
  const registryYaw = builtinKey ? BUILTIN_MODEL_YAW_OFFSETS[builtinKey] ?? 0 : 0;
  const effectiveYaw = (typeof yawOffset === "number" ? yawOffset : registryYaw);

  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
    >
      <group rotation={[0, effectiveYaw, 0]}>
        <primitive object={cloned} />
        {selected && <ModelSelectionBox target={cloned} />}
      </group>
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
  const { entity, playMode, children, onContext, onHover } = props;
  // Pointer enter/leave on the entity's group. We stopPropagation on
  // enter so the most-specific (deepest) entity wins — without that a
  // hover on a child mesh inside a parent GLB would also fire on the
  // parent's wrapper and the chip would jitter between them.
  const handlePointerOver = onHover
    ? (e: { stopPropagation?: () => void; clientX?: number; clientY?: number }) => {
        e.stopPropagation?.();
        onHover(true, e.clientX, e.clientY);
      }
    : undefined;
  const handlePointerOut = onHover
    ? (e: { stopPropagation?: () => void }) => {
        e.stopPropagation?.();
        onHover(false);
      }
    : undefined;
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

  // Layer-driven collision filtering. Subscribe to env so toggling the
  // collision matrix in the Layers panel re-renders bodies live during Play.
  const env = useEditor((s) => s.sceneData.environment);
  // Subscribe to the entity list once and resolve all three inherited
  // axes (layer / surface / materialKind) by walking the persisted
  // parentId chain. Re-tagging a parent rerenders children.
  const allEntities = useEditor((s) => s.sceneData.entities);
  const inherited = useMemo(
    () => resolveInheritedFields(entity, indexEntitiesById(allEntities)),
    [entity, allEntities],
  );
  const layer: LayerName = ((entity.layer as LayerName | undefined) ??
    (inherited.layer as LayerName | undefined) ??
    "Default") as LayerName;
  const sensorLayers = env.sensorLayers ?? DEFAULT_SENSOR_LAYERS;
  const isSensor = sensorLayers.includes(layer);
  // Default the soft / dynamic entity types into their natural Material
  // slot so a freshly-spawned cloth/flag/particles entity already has
  // sensible physics + occlusion flags without a separate set_material
  // call. Explicit `material.kind` always wins.
  const localKind: MaterialKind | undefined =
    entity.material?.kind ??
    (entity.type === "cloth"
      ? "Cloth"
      : entity.type === "flag"
        ? "Flag"
        : entity.type === "particles"
          ? "Particle"
          : undefined);
  // Effective MaterialKind: explicit > type-inferred > parent-inherited > Solid.
  const inferredKind: MaterialKind = (localKind ?? inherited.materialKind ?? "Solid") as MaterialKind;
  // Per-field-merged effective material (own > ancestor > kind
  // defaults). Used by visuals, physics defaults, and userData stamping.
  const effectiveMaterial = useMemo(
    () => ({ ...(inherited.material ?? {}), kind: inferredKind }),
    [inherited.material, inferredKind],
  );
  const matResolved = useMemo(
    () => resolveMaterialDefaults(effectiveMaterial),
    [effectiveMaterial],
  );
  const collisionGroups = useMemo(
    () => rapierCollisionGroups(layer, env.collisionMatrix),
    [layer, env.collisionMatrix],
  );

  // ── Trigger event dispatch ────────────────────────────────────────────────
  // Rapier fires `onIntersectionEnter` / `onIntersectionExit` independently
  // on EACH body in a sensor pair, so attaching the handler on every
  // RigidBody already gives both participants their own callback — we
  // therefore dispatch ONLY to `entity.id` and let the other side's
  // EntityRenderer dispatch to its own id. Mirror-firing here would
  // double every event (each entity would receive its callback both
  // from its own RigidBody firing AND from the other body's firing).
  // The userData stamped on `<RigidBody userData={…}>` below shows up
  // on `payload.other.rigidBodyObject?.userData`.
  const buildTriggerEvent = useMemo(() => {
    return (payload: IntersectionEnterPayload | IntersectionExitPayload): TriggerEvent | null => {
      const otherUd = (payload.other.rigidBodyObject?.userData ?? {}) as {
        entityId?: string;
        name?: string;
        layer?: string;
      };
      if (!otherUd.entityId) return null;
      return {
        otherId: otherUd.entityId,
        otherName: otherUd.name ?? "",
        otherLayer: otherUd.layer ?? "Default",
      };
    };
  }, []);

  const handleIntersectionEnter = useMemo(() => {
    return (payload: IntersectionEnterPayload) => {
      const ev = buildTriggerEvent(payload);
      if (!ev) return;
      getPlaySession().triggers.fireEnter(entity.id, ev);
    };
  }, [entity.id, buildTriggerEvent]);

  const handleIntersectionExit = useMemo(() => {
    return (payload: IntersectionExitPayload) => {
      const ev = buildTriggerEvent(payload);
      if (!ev) return;
      getPlaySession().triggers.fireExit(entity.id, ev);
    };
  }, [entity.id, buildTriggerEvent]);

  // Clear this entity's trigger handlers when the renderer unmounts (the
  // entity was despawned mid-play, or play mode stopped). The wider
  // `resetPlaySession()` already wipes everything on play stop, but mid-
  // play despawns would otherwise leave stale closures lingering in the
  // session for the rest of the play-through.
  useEffect(() => {
    const id = entity.id;
    return () => {
      getPlaySession().triggers.clear(id);
    };
  }, [entity.id]);

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

    // Convex-decomp: read the serialized hull set from the
    // window-scoped Map populated by `bake_convex_hulls` and emit
    // one ConvexHullCollider per hull. Missing cache falls through
    // to the regular collider switch.
    const useConvexDecomp =
      colliderShape === "convex-decomp" && ph.collidersAssetId !== undefined;
    let hullSet: ConvexHullSet | null = null;
    if (useConvexDecomp) {
      const w = window as unknown as {
        __colliderHullSets?: Map<
          number,
          { hulls: { vertices: number[]; indices?: number[] }[]; totalVerts: number }
        >;
      };
      const raw = w.__colliderHullSets?.get(ph.collidersAssetId!);
      if (raw) hullSet = deserializeHullSet(raw);
    }
    const renderConvexHulls = useConvexDecomp && !!hullSet;

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
    // which would crash every render with "undefined is not iterable".
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
        sensor={isSensor}
        onIntersectionEnter={handleIntersectionEnter}
        onIntersectionExit={handleIntersectionExit}
        collisionGroups={collisionGroups}
        solverGroups={collisionGroups}
        colliders={
          explicitForModel || renderConvexHulls
            ? false
            : colliderShape === "ball"
              ? "ball"
              : colliderShape === "cylinder"
                ? "hull"
                : colliderShape === "trimesh"
                  ? "trimesh"
                  : "cuboid"
        }
        restitution={ph.restitution ?? matResolved.restitution}
        friction={ph.friction ?? matResolved.friction}
        mass={ph.mass ?? matResolved.density / 1000}
        linearDamping={matResolved.drag}
        userData={{
          entityId: entity.id,
          name: entity.name,
          // Tri-axis tagging stamped from effective values
          // (own > inherited > default). Always present so
          // raycast/ground-probe payloads are coherent without
          // walking the chain again at query time.
          layer,
          surface: entity.surface ?? inherited.surface,
          material: matResolved.kind,
          materialDensity: matResolved.density,
          materialBlocksLineOfSight: matResolved.blocksLineOfSight,
          materialBlocksProjectiles: matResolved.blocksProjectiles,
          materialBlocksAudio: matResolved.blocksAudio,
        }}
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
        {/* convex-decomp: one ConvexHullCollider per baked hull. The
            collider takes a flat `Float32Array` of XYZ vertices —
            Rapier internally builds the hull from the point cloud,
            so we don't need to forward the index buffer. */}
        {renderConvexHulls &&
          hullSet!.hulls.map((h, i) => (
            <ConvexHullCollider key={i} args={[h.vertices]} />
          ))}
        {/* `onContextMenu` lives on the inner group rather than on
            RigidBody itself — @react-three/rapier's RigidBody doesn't
            forward DOM-style pointer events. The group catches the same
            r3f synthetic event for the entity's visible geometry. */}
        <group
          scale={tr.scale}
          onContextMenu={handleContext}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <MeshBody {...props} effectiveMaterial={effectiveMaterial} />
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
      userData={{
        entityId: entity.id,
        name: entity.name,
        layer,
        surface: entity.surface ?? inherited.surface,
        material: matResolved.kind,
        materialDensity: matResolved.density,
        materialBlocksLineOfSight: matResolved.blocksLineOfSight,
        materialBlocksProjectiles: matResolved.blocksProjectiles,
        materialBlocksAudio: matResolved.blocksAudio,
      }}
      onContextMenu={handleContext}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <MeshBody {...props} effectiveMaterial={effectiveMaterial} />
      {children}
    </group>
  );
});
