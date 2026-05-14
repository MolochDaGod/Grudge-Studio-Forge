import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, Stats, TransformControls } from "@react-three/drei";
import { EffectsRig } from "@/scene/EffectsRig";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useListScripts, getListScriptsQueryKey } from "@workspace/api-client-react";
import { EntityRenderer } from "@/scene/EntityRenderer";
import { NavmeshDebugOverlay } from "@/scene/NavmeshDebugOverlay";
import { groundProbe } from "@/scene/PlayRuntime";
import { PlayScriptRuntime } from "@/scene/PlayScriptRuntime";
import {
  resolveInheritedFields,
  indexEntitiesById,
  resolveMaterialDefaults,
  type SurfaceKind,
} from "@workspace/scene-schema";
import { computeFramingPose } from "@/lib/framing";
import {
  recommendedCameraFar,
  recommendedSnapMaxDistance,
} from "@/lib/scaleHelpers";
import {
  applyGroundSnap,
  DEFAULT_WALKABLE_SURFACES,
  getEntitySurfaceTag,
  isGroundSnapModifierHeld,
  shouldGroundSnap,
} from "@/lib/groundSnap";
import { PlayCameraController } from "@/scene/CameraControllers";
import { buildTree } from "@/lib/hierarchy";
import type { SceneEntity, EntityType } from "@/scene/types";
import { DEFAULT_GRAVITY, DEFAULT_FOG } from "@workspace/scene-schema";
import { getPlaySession, resetPlaySession } from "@/scene/playSession";
import { PlayHUD } from "@/editor/PlayHUD";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Hotbar } from "@/editor/Hotbar";
import { gizmoDragGate, isGizmoSwallowingClick } from "@/editor/gizmoDragGate";
import { DevtoolsBridge } from "@/scene/DevtoolsBridge";
import { ViewportBridge } from "@/scene/viewportBridge";
import { BestPracticesSubMenu } from "@/editor/BestPracticesMenu";
import { Box as BoxIcon, Circle as CircleIcon, Cylinder as CylinderIcon, Square as SquareIcon, Lightbulb as LightIcon, Plus, Wand2, X } from "lucide-react";
import {
  useListPrefabs,
  getListPrefabsQueryKey,
  useListTemplates,
  type Prefab,
} from "@workspace/api-client-react";
import type { PrefabPayload } from "@/scene/prefabPayload";
import { TemplateLoadingDialog } from "@/editor/TemplateLoadingDialog";
import { useTemplateLoader } from "@/editor/useTemplateLoader";

interface RenderNodeProps {
  entity: SceneEntity;
  childrenByParent: Map<string | null, SceneEntity[]>;
  selectedId: string | null;
  onPick: (id: string) => void;
  /** Right-click hit on a specific entity. Optional so play-mode trees
   *  (where the context menu is unused) don't have to forward anything. */
  onContext?: (id: string) => void;
  /** Pointer hover. Fires with `(id, true, clientX, clientY)` on enter
   *  and `(id, false)` on leave. Only forwarded in edit mode (the play
   *  tree leaves it undefined so no overlay logic kicks in during play). */
  onHover?: (id: string, hovering: boolean, clientX?: number, clientY?: number) => void;
  groupRefs?: React.MutableRefObject<Map<string, THREE.Group>>;
  bodyRefs?: React.MutableRefObject<Map<string, RapierRigidBody | THREE.Group>>;
  playMode: boolean;
}

/** Renders an entity + recursively all of its children inside its group, so
 *  child transforms compose with the parent's (Unity-style hierarchy).
 *
 *  IMPORTANT: We forward refs to EntityRenderer's *actual transformed group*
 *  (not a separate wrapper). If we wrapped in a tracking group, TransformControls
 *  would mutate the wrapper while EntityRenderer kept its inner group anchored
 *  to entity.transform — the gizmo and the visual mesh would diverge after the
 *  first drag. Forwarding directly keeps the gizmo, mesh, and store in sync. */
function RenderNode({
  entity,
  childrenByParent,
  selectedId,
  onPick,
  onContext,
  onHover,
  groupRefs,
  bodyRefs,
  playMode,
}: RenderNodeProps) {
  const kids = childrenByParent.get(entity.id) ?? [];
  const childNodes = kids.map((c) => (
    <RenderNode
      key={c.id}
      entity={c}
      childrenByParent={childrenByParent}
      selectedId={selectedId}
      onPick={onPick}
      onContext={onContext}
      onHover={onHover}
      groupRefs={groupRefs}
      bodyRefs={bodyRefs}
      playMode={playMode}
    />
  ));

  return (
    <EntityRenderer
      entity={entity}
      selected={selectedId === entity.id}
      onPick={() => onPick(entity.id)}
      onContext={onContext ? () => onContext(entity.id) : undefined}
      onHover={
        onHover
          ? (h: boolean, x?: number, y?: number) => onHover(entity.id, h, x, y)
          : undefined
      }
      playMode={playMode}
      ref={(el) => {
        if (groupRefs) {
          // In edit mode the ref is always a THREE.Group (no physics).
          if (el) groupRefs.current.set(entity.id, el as THREE.Group);
          else groupRefs.current.delete(entity.id);
        }
        if (bodyRefs) {
          if (el) bodyRefs.current.set(entity.id, el as RapierRigidBody | THREE.Group);
          else bodyRefs.current.delete(entity.id);
        }
      }}
    >
      {childNodes}
    </EntityRenderer>
  );
}

/** Module-scope flag set while a gizmo (TransformControls) drag is in
 *  progress, plus a short trailing-edge window AFTER the drag ends.
 *
 *  Why: when the user releases the mouse over the gizmo, three.js still
 *  fires a synthetic `click` against whatever mesh is under the cursor —
 *  almost always the ground. That used to trigger `selectEntity(ground)`
 *  immediately after every gizmo move/rotate/scale, kicking the user
 *  out of their selection. We gate both the per-mesh `onPick` and the
 *  Canvas-wide `onPointerMissed` against this flag and ignore the
 *  trailing click.
 *
 *  150 ms is empirically enough to swallow the trailing event without
 *  noticeably delaying a real follow-up click on a different entity.  */
// Gate moved to ./gizmoDragGate so Viewport.tsx exports only its React
// component (Fast Refresh requires consistent component exports — a
// non-component named export here was breaking HMR).

function SceneEditMode({
  data,
  onContextEntity,
  onHoverEntity,
}: {
  data?: { entities: SceneEntity[] };
  /** Records the entity hit by the most recent right-click so the
   *  surrounding Radix `<ContextMenu>` can render entity-aware items. */
  onContextEntity?: (id: string) => void;
  /** Records the entity currently under the pointer for the floating
   *  Material info chip. Fires `(id, true, clientX, clientY)` on enter /
   *  `(id, false)` on leave. The pointer coords let the chip appear
   *  immediately on first hover instead of waiting for the next move. */
  onHoverEntity?: (id: string, hovering: boolean, clientX?: number, clientY?: number) => void;
}) {
  const liveData = useEditor((s) => s.sceneData);
  const sceneData = data ?? liveData;
  const selectedId = useEditor((s) => s.selectedId);
  const selectEntity = useEditor((s) => s.selectEntity);
  // Use the command-dispatching wrapper so a TransformControls drag becomes
  // a single undo step (the command coalesces same-axis edits within ~800ms).
  const cmdSetEntityTransform = useEditor((s) => s.cmdSetEntityTransform);
  const transformMode = useEditor((s) => s.transformMode);

  const groupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const selectedRef = selectedId ? groupRefs.current.get(selectedId) : undefined;
  const transformControlsRef = useRef<THREE.Object3D & {
    addEventListener: (type: string, fn: (e: { value: boolean }) => void) => void;
    removeEventListener: (type: string, fn: (e: { value: boolean }) => void) => void;
  } | null>(null);

  // Live modifier state — read inside `onObjectChange` (which has no
  // KeyboardEvent context) to decide whether the dragged entity should
  // ground-snap. Updated on every keydown/keyup/blur so a modifier
  // released mid-drag immediately stops snapping.
  const modKeysRef = useRef({ shift: false, ctrl: false });
  useEffect(() => {
    const update = (e: KeyboardEvent) => {
      modKeysRef.current.shift = e.shiftKey;
      modKeysRef.current.ctrl = e.ctrlKey || e.metaKey;
    };
    const reset = () => {
      modKeysRef.current.shift = false;
      modKeysRef.current.ctrl = false;
    };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", reset);
    };
  }, []);

  // The whole r3f scene — needed for the ground-snap raycast.
  const { scene: threeScene } = useThree();

  // Listen for TransformControls' `dragging-changed` event so we know
  // exactly when a gizmo drag begins and ends. The drei wrapper forwards
  // the underlying three.js event verbatim — `e.value` is the new
  // dragging boolean.
  useEffect(() => {
    const ctl = transformControlsRef.current;
    if (!ctl) return;
    const handler = (e: { value: boolean }) => {
      if (e.value) {
        gizmoDragGate.active = true;
      } else {
        gizmoDragGate.active = false;
        gizmoDragGate.releasedAt = performance.now();
      }
    };
    ctl.addEventListener("dragging-changed", handler);
    return () => ctl.removeEventListener("dragging-changed", handler);
  }, [selectedRef]);

  const childrenByParent = useMemo(() => buildTree(sceneData.entities), [sceneData.entities]);
  const roots = childrenByParent.get(null) ?? [];

  return (
    <>
      {roots.map((entity) => (
        <RenderNode
          key={entity.id}
          entity={entity}
          childrenByParent={childrenByParent}
          selectedId={selectedId}
          onPick={(id: string) => {
            // Trailing click after a gizmo drag — ignore so we don't
            // bounce the selection onto the ground/wall under the cursor.
            if (isGizmoSwallowingClick()) return;
            selectEntity(id);
          }}
          onContext={onContextEntity}
          onHover={onHoverEntity}
          groupRefs={groupRefs}
          playMode={false}
        />
      ))}
      {selectedRef && (
        <TransformControls
          ref={transformControlsRef as never}
          object={selectedRef}
          mode={transformMode}
          onObjectChange={() => {
            if (!selectedId || !selectedRef) return;
            const o = selectedRef;
            if (transformMode === "translate") {
              // Shift+Ctrl (or Shift+Meta) ground-snap: continuously
              // override the dragged entity's Y to whatever ground
              // surface lies beneath its current XZ. Skip the dragged
              // entity itself so it can't snap to its own collider.
              // The cmdSetEntityTransform call below uses the snapped
              // value, so the undo step records the snapped pose
              // (still coalesced into a single drag). See
              // .agents/skills/spatial-queries-and-surfaces/SKILL.md
              // for the underlying probe pattern.
              if (
                isGroundSnapModifierHeld({
                  shiftKey: modKeysRef.current.shift,
                  ctrlKey: modKeysRef.current.ctrl,
                })
              ) {
                // Don't snap terrain TO terrain — if the dragged
                // entity itself carries a walkable surface tag
                // (typically stamped on a DESCENDANT, e.g. the cloned
                // model root for a Map entity), the user is
                // repositioning the ground and shouldn't have it
                // teleport onto whatever lies beneath. We early-out
                // before raycasting so terrain drags stay free-Y and
                // we don't waste a probe per frame.
                const draggedSurface = getEntitySurfaceTag(o);
                const draggedIsTerrain =
                  !!draggedSurface && DEFAULT_WALKABLE_SURFACES.includes(draggedSurface);
                if (!draggedIsTerrain) {
                  const hit = groundProbe(
                    threeScene,
                    [o.position.x, o.position.y, o.position.z],
                    {
                      // Drop the probe from above the highest possible
                      // peak and reach all the way to the deepest valley
                      // so a 5km/+10km/-5m terrain snap still lands.
                      originOffset: recommendedSnapMaxDistance() * 0.5,
                      maxDistance: recommendedSnapMaxDistance(),
                      excludeEntityIds: [selectedId],
                    },
                  );
                  if (shouldGroundSnap({ hit, draggedEntitySurface: draggedSurface })) {
                    applyGroundSnap(o, hit);
                  }
                }
              }
              cmdSetEntityTransform(selectedId, "position", [o.position.x, o.position.y, o.position.z]);
            } else if (transformMode === "rotate") {
              cmdSetEntityTransform(selectedId, "rotation", [o.rotation.x, o.rotation.y, o.rotation.z]);
            } else {
              cmdSetEntityTransform(selectedId, "scale", [o.scale.x, o.scale.y, o.scale.z]);
            }
          }}
        />
      )}
    </>
  );
}


function ScenePlayMode() {
  const envGravity = useEditor((s) => s.sceneData.environment.gravity);
  const projectId = useEditor((s) => s.projectId);
  // Memoise so <Physics> doesn't tear down + recreate the world (and orphan
  // every RigidBody ref) every time a parent re-renders. The `?? [...]` would
  // otherwise allocate a fresh tuple on every render → new prop reference →
  // forced remount of the entire physics tree.
  const gravity = useMemo<[number, number, number]>(
    () => (envGravity ?? DEFAULT_GRAVITY) as [number, number, number],
    [envGravity],
  );
  const bodyRefs = useRef<Map<string, RapierRigidBody | THREE.Group>>(new Map());
  // Source scripts via react-query in the editor; the standalone player
  // passes its own pre-loaded `scripts` array into PlayScriptRuntime.
  const { data: scripts } = useListScripts(projectId ?? 0, {
    query: { queryKey: getListScriptsQueryKey(projectId ?? 0), enabled: !!projectId },
  });

  return (
    <Physics gravity={gravity}>
      <PlayScriptRuntime bodyRefs={bodyRefs} scripts={scripts} />
      <PlayCameraController bodyRefs={bodyRefs} />
    </Physics>
  );
}

function Lights() {
  const env = useEditor((s) => s.sceneData.environment);
  // Hemisphere light fills the scene with a natural sky-above / ground-below
  // gradient so that GLB maps with mostly-Standard materials read clearly
  // even when the directional sun is weak (cyberpunk neon, overcast winter,
  // covered interiors). Inspired by Mugen87/dive's lighting setup. We tie
  // it to env.skyColor / env.groundColor / env.ambientIntensity so that
  // tuning the environment in the inspector still works as before — the
  // hemisphere just rides on top of the existing ambient + sun pair.
  const ambient = env.ambientIntensity ?? 0.4;
  const sky = env.skyColor ?? "#0a0a14";
  const ground = env.groundColor ?? "#1a1a2e";
  const sunIntensity = env.sunIntensity ?? 1.2;
  return (
    <>
      <ambientLight intensity={ambient} />
      <hemisphereLight args={[sky, ground, ambient * 0.85]} />
      {/*
        Key (sun) light. Previously a 1024² shadow map covering the
        renderer-default ortho frustum (~10 units across) with no
        bias — gave both shadow acne (flickering speckle on every
        lit surface) and shadows that vanished a few meters from the
        origin on the new ~120-unit arena scale.

        Fixes:
          • 2048² map so per-texel area is small enough to avoid
            staircase aliasing on character feet.
          • Explicit ortho bounds covering ±60 units (matches the
            new arena scale) at far=120 → shadow texels stay dense.
          • bias=-0.0005 + normalBias=0.04 eliminates the
            speckle/acne while the small negative bias keeps contact
            shadows tight under feet.
      */}
      <directionalLight
        position={[10, 12, 8]}
        intensity={sunIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
        shadow-camera-near={0.5}
        shadow-camera-far={120}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      {/*
        Cool back/rim fill from the opposite side at ~25% sun
        intensity — gives geometry edge definition without flatness
        and prevents the "muddy unlit back-side" look on characters
        and props. Does NOT cast shadows (would double the shadow
        cost and produce conflicting shadows from two suns).
      */}
      <directionalLight
        position={[-8, 10, -6]}
        intensity={sunIntensity * 0.25}
        color="#9eb8ff"
      />
    </>
  );
}

function ClickToDeselect() {
  const selectEntity = useEditor((s) => s.selectEntity);
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Only clear if click didn't hit a mesh (handled via stopPropagation in EntityRenderer)
      // We attach this to the canvas itself; meshes call stopPropagation.
    };
    el.addEventListener("pointerdown", handler);
    return () => el.removeEventListener("pointerdown", handler);
  }, [gl]);
  return null;
}

/**
 * Universal pointer-lock bridge for play mode.
 *
 * Mounted inside the R3F Canvas (so it can grab `gl.domElement`) and only
 * during play. Requests pointer-lock on click, tracks the lock state via
 * the native `pointerlockchange` event, and pushes that state up via
 * `onChange` so a sibling DOM overlay can render the "Click to capture ·
 * ESC to release" hint when unlocked.
 *
 * Browser semantics:
 *   - Pressing ESC natively releases the lock — no manual ESC handler.
 *   - The lock survives until ESC, tab blur, or `document.exitPointerLock()`.
 *   - Each click while unlocked re-requests the lock; the browser may
 *     ratelimit re-requests after a manual user release within ~1.5s
 *     (the "user-initiated" cooldown). We swallow the resulting
 *     `SecurityError` so the editor doesn't spam the console.
 */
function PointerLockBridge({ onChange }: { onChange: (locked: boolean) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const onClick = () => {
      if (document.pointerLockElement === el) return;
      try {
        const p = el.requestPointerLock?.();
        // Modern browsers return a Promise; older ones return undefined.
        if (p && typeof (p as Promise<void>).catch === "function") {
          (p as Promise<void>).catch(() => {
            /* user-initiated cooldown or denied — handled by overlay state */
          });
        }
      } catch {
        /* same as above */
      }
    };
    const onLockChange = () => {
      onChange(document.pointerLockElement === el);
    };
    el.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    // Sync once on mount in case we re-mounted while already locked.
    onLockChange();
    return () => {
      el.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === el) {
        document.exitPointerLock?.();
      }
      onChange(false);
    };
  }, [gl, onChange]);
  return null;
}

/** Smoothly tween the editor camera + orbit target onto the selected
 *  entity whenever the user presses F (or picks "Focus camera" from a
 *  context menu). We bump `focusToken` in the store and the effect
 *  below re-runs.
 *
 *  Behavior:
 *   - Distance is computed from the entity's WORLD-SPACE AABB so a
 *     10-unit plane backs the camera up further than a unit cube.
 *   - View direction is preserved (we only change distance + target
 *     position), so repeated F presses are idempotent and the user
 *     doesn't lose their current orbit angle.
 *   - The pose change is interpolated over ~250ms via useFrame
 *     (ease-out cubic) instead of teleporting.
 *
 *  Pure framing math lives in `@/lib/framing` and is unit-tested. */
/** Tiny R3F-side helper that copies the live THREE.Scene reference up
 *  to a parent ref so DOM-level event handlers (which can't use
 *  `useThree`) can reach it. Identical pattern to capturing camera /
 *  controls; we only need scene for raycast-to-terrain. */
function SceneCapture({ sceneRef }: { sceneRef: React.MutableRefObject<THREE.Scene | null> }) {
  const { scene } = useThree();
  useEffect(() => {
    sceneRef.current = scene;
    return () => {
      if (sceneRef.current === scene) sceneRef.current = null;
    };
  }, [scene, sceneRef]);
  return null;
}

function FocusCameraController() {
  const focusToken = useEditor((s) => s.focusToken);
  const { camera, controls, scene, size } = useThree();

  // Active tween bookkeeping. Null means "no tween in flight"; useFrame
  // bails immediately. The effect populates this when focusToken bumps.
  //
  // Note (intentional design): F is "go to selection", NOT "lock orbit
  // to selection". We tween the camera to frame the entity and we
  // update the camera's look direction to centre the entity, but at
  // tween end we push the OrbitControls pivot OFF the entity, along
  // the new view direction at the user's original orbit radius. That
  // way subsequent middle-mouse orbit revolves around a pivot in
  // free space (just like before pressing F) instead of feeling
  // "stuck" on the entity, which is what users complained about.
  const tweenRef = useRef<{
    startTime: number;
    duration: number;
    startCam: THREE.Vector3;
    startTarget: THREE.Vector3;
    endCam: THREE.Vector3;
    /** Where the entity sits in world space — what the camera should
     *  look at during and at the end of the tween. NOT the orbit
     *  pivot; see `endPivotDistance` below. */
    lookAt: THREE.Vector3;
    /** User's pre-focus orbit radius. At tween end we place
     *  controls.target this far along the camera's forward ray, so
     *  the orbit feel is preserved (same orbit speed, same dolly
     *  range) but the pivot is no longer pinned to the entity. */
    endPivotDistance: number;
  } | null>(null);

  useEffect(() => {
    if (focusToken === 0) return; // initial mount, don't snap
    const { selectedId } = useEditor.getState();
    if (!selectedId) return;

    // Find the entity's actual three.js group via `userData.entityId`
    // (stamped by EntityRenderer). Traversing the scene means we don't
    // need cross-component group ref plumbing.
    let target: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if (target) return;
      const ud = o.userData as { entityId?: string } | undefined;
      if (ud?.entityId === selectedId) target = o;
    });
    if (!target) return;

    // Force a world-matrix update so Box3 reads post-transform bounds.
    (target as THREE.Object3D).updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) {
      // Empties / lights have no geometry — fall back to a unit AABB at
      // the object's world position so we at least frame SOMETHING
      // sensible.
      const wp = new THREE.Vector3();
      (target as THREE.Object3D).getWorldPosition(wp);
      box.setFromCenterAndSize(wp, new THREE.Vector3(1, 1, 1));
    }

    const persp = camera as THREE.PerspectiveCamera;
    const fov = persp.fov ?? 45;
    const aspect = persp.aspect ?? (size.width > 0 ? size.width / size.height : 1);
    // reason: drei's `useThree().controls` is typed as `EventDispatcher`;
    // narrow to the OrbitControls-shaped subset we actually touch.
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    const curTarget = c?.target?.clone() ?? new THREE.Vector3();

    const pose = computeFramingPose({
      bbox: {
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
      },
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      currentTarget: [curTarget.x, curTarget.y, curTarget.z],
      fovDegrees: fov,
      aspect,
    });

    // Preserve the user's orbit radius so the post-focus pivot lands
    // at the same dolly distance — orbit feel is unchanged.
    const endPivotDistance = Math.max(0.5, camera.position.distanceTo(curTarget));

    tweenRef.current = {
      startTime: performance.now(),
      duration: 250,
      startCam: camera.position.clone(),
      startTarget: curTarget,
      endCam: new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2]),
      lookAt: new THREE.Vector3(pose.target[0], pose.target[1], pose.target[2]),
      endPivotDistance,
    };
  }, [focusToken, camera, controls, scene, size]);

  useFrame(() => {
    const t = tweenRef.current;
    if (!t) return;
    const now = performance.now();
    const k = Math.min(1, (now - t.startTime) / t.duration);
    // Ease-out cubic — fast departure, soft arrival; feels responsive
    // without overshooting the entity.
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(t.startCam, t.endCam, e);
    // reason: see above — narrow drei's loosely-typed `controls` to the
    // OrbitControls subset.
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (c?.target) {
      // Throughout the tween: keep the pivot AT the look-at point so
      // OrbitControls aims the camera at the entity (it derives
      // camera.quaternion from `target - position` every frame).
      c.target.lerpVectors(t.startTarget, t.lookAt, e);
    }
    c?.update?.();

    if (k >= 1) {
      // Tween done — park the orbit pivot AT the entity center.
      //
      // Earlier we pushed the pivot OFF the entity along the camera's
      // forward ray at the user's pre-F orbit radius (to avoid feeling
      // "locked" on the entity). The downside: when the pre-F radius
      // was much larger than the new camera→entity distance, the pivot
      // landed far PAST the entity, so mouse-wheel dolly (which moves
      // along the camera→pivot ray) zoomed straight through the
      // focused thing instead of toward it. Net result: wheel-zoom
      // felt broken right after pressing F.
      //
      // Parking the pivot at `lookAt` makes the wheel naturally dolly
      // toward / away from the focused entity, which is what users
      // expect from "frame this thing". The user can still re-anchor
      // the pivot at any time with middle-mouse pan, the same way they
      // would in Blender / Unity.
      if (c?.target) {
        c.target.copy(t.lookAt);
        c.update?.();
      }
      tweenRef.current = null;
    }
  });

  return null;
}

/**
 * Catches render-time exceptions from anything inside the 3D viewport (the
 * `<Canvas>`, scripts, post-processing, GLB loaders, etc.) and shows a
 * contained fallback in the viewport pane instead of letting the whole editor
 * shell — toolbar, hierarchy, inspector — go down with it. The "Reload
 * viewport" button bumps a key so the boundary remounts the entire subtree.
 *
 * React requires class components for error boundaries; there is no hook
 * equivalent.
 */
interface ViewportErrorBoundaryState {
  error: Error | null;
}
interface ViewportErrorBoundaryProps {
  children: ReactNode;
  /** User-initiated remount (button click). Resets the auto-retry budget too. */
  onReset: () => void;
  /**
   * Whether the parent still has an auto-retry attempt available. When true,
   * the boundary swallows the first error and asks the parent to remount the
   * subtree silently; if the same render crashes a second time we fall back
   * to the manual UI so the user knows something is genuinely wrong.
   *
   * Why parent-owned: the boundary itself is unmounted+remounted on each
   * `onAutoRetry` (the parent bumps a key), so any per-instance flag would
   * reset to "available" forever and cause an infinite retry loop on a
   * deterministic crash. The parent keeps the latch.
   */
  autoRetryAvailable: boolean;
  /** Silent recovery hook — parent should bump the viewport epoch. */
  onAutoRetry: () => void;
}
class ViewportErrorBoundary extends Component<
  ViewportErrorBoundaryProps,
  ViewportErrorBoundaryState
> {
  state: ViewportErrorBoundaryState = { error: null };
  /** True once we've requested an auto-retry for the current boundary instance,
   *  so we don't fire it twice if React calls componentDidCatch redundantly. */
  private autoRetryRequested = false;

  static getDerivedStateFromError(error: Error): ViewportErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to dev console; the editor's own log panel doesn't see render
    // errors because they happen above the React tree the panel reads from.
    // eslint-disable-next-line no-console
    console.error("[Viewport] render error:", error, info.componentStack);

    // Most viewport crashes we've actually observed in the wild are transient
    // init-races inside R3F / @react-three/postprocessing / Rapier — a fresh
    // mount of the Canvas subtree clears them. Try once silently before
    // surfacing the manual "Viewport crashed" UI so the user doesn't have to
    // babysit a one-shot HMR / context-restore glitch.
    if (this.props.autoRetryAvailable && !this.autoRetryRequested) {
      this.autoRetryRequested = true;
      // Defer one task so React finishes flushing its commit phase before we
      // ask the parent to swap the boundary key.
      setTimeout(() => this.props.onAutoRetry(), 0);
    }
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.error) {
      // We've asked the parent to remount us; render nothing so the user sees
      // a brief blank instead of a flash of the crash UI before recovery.
      // Gate on `autoRetryRequested` (not `autoRetryAvailable`) so we only
      // suppress the UI once componentDidCatch has actually scheduled the
      // retry — otherwise the brief window between getDerivedStateFromError
      // and componentDidCatch could render null without a recovery path.
      if (this.autoRetryRequested) {
        return null;
      }
      return (
        <div className="w-full h-full flex items-center justify-center bg-background grid-pattern p-6">
          <div className="max-w-md text-center space-y-3 p-6 rounded-md bg-card/90 border border-card-border shadow-lg">
            <h3 className="text-base font-semibold text-destructive">
              Viewport crashed
            </h3>
            <p className="text-xs text-muted-foreground font-mono break-words">
              {this.state.error.message}
            </p>
            <p className="text-xs text-muted-foreground">
              The rest of the editor is still usable — open the console for the
              full stack, then reload the viewport once you've fixed the issue.
            </p>
            <button
              type="button"
              onClick={this.reset}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-accent-foreground hover:opacity-90"
              data-testid="button-reload-viewport"
            >
              Reload viewport
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const VIEWPORT_PRIMITIVES: { type: EntityType; label: string; Icon: typeof BoxIcon }[] = [
  { type: "box", label: "Box", Icon: BoxIcon },
  { type: "sphere", label: "Sphere", Icon: CircleIcon },
  { type: "cylinder", label: "Cylinder", Icon: CylinderIcon },
  { type: "plane", label: "Plane", Icon: SquareIcon },
  { type: "light", label: "Light", Icon: LightIcon },
];

/**
 * Probe whether the browser tab can actually acquire a WebGL context BEFORE
 * we hand off to R3F. Without this, a momentary GPU failure (Replit iframe
 * sandbox throttling, the "too many active WebGL contexts" limit some
 * browsers enforce, etc.) throws synchronously inside `new THREE.WebGLRenderer`
 * and the @replit/vite-plugin-runtime-error-modal overlays the entire app —
 * the user can't dismiss it without reloading. A tiny probe + graceful
 * fallback keeps the editor shell usable and lets the user retry.
 */
function probeWebGL(): { ok: true } | { ok: false; reason: string } {
  if (typeof document === "undefined") return { ok: false, reason: "No document" };
  try {
    const probe = document.createElement("canvas");
    const gl =
      (probe.getContext("webgl2") as WebGLRenderingContext | null) ??
      (probe.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return { ok: false, reason: "WebGL is not supported by this browser context." };
    // Release the probe context immediately so we don't burn one of the
    // browser's per-page WebGL slots before R3F gets to allocate the real one.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? "Unknown WebGL error" };
  }
}

function WebGLUnavailable({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-background grid-pattern p-6">
      <div className="max-w-md text-center space-y-4 p-6 rounded-md bg-card/90 border border-card-border shadow-lg">
        <h3 className="text-base font-semibold text-destructive">3D viewport unavailable</h3>
        <p className="text-xs text-muted-foreground font-mono break-words">{reason}</p>
        <p className="text-xs text-muted-foreground">
          Your browser couldn't acquire a WebGL context. This usually clears up
          on its own — try the retry button. If it persists, close other tabs
          using 3D / video, or reload the page.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs rounded-md bg-accent text-accent-foreground hover:opacity-90"
          data-testid="button-webgl-retry"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export function Viewport() {
  const env = useEditor((s) => s.sceneData.environment);
  const isPlaying = useEditor((s) => s.isPlaying);
  const renderQuality = useEditor((s) => s.renderQuality);
  const showStats = useEditor((s) => s.showStats);
  const selectEntity = useEditor((s) => s.selectEntity);
  const cmdAddEntity = useEditor((s) => s.cmdAddEntity);
  const cmdAddEmptyChild = useEditor((s) => s.cmdAddEmptyChild);
  const cmdRemoveEntity = useEditor((s) => s.cmdRemoveEntity);
  const cmdDuplicateEntity = useEditor((s) => s.cmdDuplicateEntity);
  const cmdRenameEntity = useEditor((s) => s.cmdRenameEntity);
  const cmdSetEntityTransform = useEditor((s) => s.cmdSetEntityTransform);
  const requestFocus = useEditor((s) => s.requestFocus);
  const projectId = useEditor((s) => s.projectId);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const hotbar = useEditor((s) => s.hotbar);
  const spawnPrefabEntities = useEditor((s) => s.spawnPrefabEntities);
  const pushLog = useEditor((s) => s.pushLog);
  const cameraMode = env.cameraMode ?? "editor";
  // Empty-scene overlay (T004): show a "pick a template" panel when the
  // user opens the editor onto a scene with no entities. Hidden during
  // play mode and inside the prefab sub-scene to avoid covering the
  // intended content.
  const sceneEntitiesCount = useEditor((s) => s.sceneData.entities.length);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);
  // Dismissable picker — user can X-out the "Pick a starting template"
  // overlay if they want to build from scratch instead. Auto-resets the
  // moment the scene becomes non-empty (so loading a template, adding a
  // primitive, etc.) and re-arms when the scene goes empty again — that
  // way "File → New" still surfaces the picker on a fresh scene.
  const [pickerDismissed, setPickerDismissed] = useState(false);
  useEffect(() => {
    if (sceneEntitiesCount > 0 && pickerDismissed) setPickerDismissed(false);
  }, [sceneEntitiesCount, pickerDismissed]);
  const showEmptySceneOverlay =
    !isPlaying &&
    !prefabSubScene &&
    sceneEntitiesCount === 0 &&
    !pickerDismissed;

  // Pull the manifest from the api-server (cached after the first call
  // by React Query, so the Toolbar dropdown and this overlay share the
  // same response). The streaming loader then handles the actual scene
  // download with its own progress dialog.
  //
  // See Toolbar.tsx for the rationale on the Array.isArray coercion: it
  // protects the overlay from a transient non-array `data` shape (e.g.
  // proxy intercepting and returning an HTML body) so the first-run
  // landing page degrades to "no templates yet" instead of crashing the
  // entire viewport.
  const tplQuery = useListTemplates();
  const templateManifest = Array.isArray(tplQuery.data) ? tplQuery.data : [];
  const templateLoader = useTemplateLoader();
  const onPickTemplate = (key: string) => {
    const tpl = templateManifest.find((t) => t.key === key);
    if (!tpl) return;
    templateLoader.start(tpl.key, tpl.label);
  };

  // (No auto-load on first boot — opens straight into the empty-scene
  // picker so the user chooses what to play instead of being dropped into
  // a hard-coded demo. Manual triggers stay available via the picker
  // overlay and the Toolbar / File menu.)

  // Right-click bookkeeping. R3F dispatches `onContextMenu` to the topmost
  // intersected entity DURING the same browser event that Radix later opens
  // the menu from. We snapshot the hit id into a ref (no re-render on hover),
  // then move it into React state via Radix's `onOpenChange` so the menu
  // content can render entity-aware items at open time. The capture-phase
  // listener on the trigger DIV resets the ref BEFORE r3f raycasts, so a
  // right-click on empty space starts from null and stays null.
  const lastContextEntityIdRef = useRef<string | null>(null);
  const [contextEntityId, setContextEntityId] = useState<string | null>(null);
  // Derive from the LIVE entities array so a Delete-then-reopen doesn't
  // surface a stale name. Subscribed via store so it stays reactive.
  const contextEntity = useEditor((s) =>
    contextEntityId
      ? s.sceneData.entities.find((x) => x.id === contextEntityId) ?? null
      : null,
  );

  // Hover bookkeeping for the floating Material info chip. We track the
  // hovered entity id in state (the chip re-renders on change) and the
  // pointer's screen position in a ref + state so the chip follows the
  // cursor without re-rendering 60×/sec when nothing is hovered.
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const allEntitiesForHover = useEditor((s) => s.sceneData.entities);
  const hoverInfo = useMemo(() => {
    if (!hoveredEntityId) return null;
    const entitiesById = indexEntitiesById(allEntitiesForHover);
    const entity = entitiesById.get(hoveredEntityId);
    if (!entity) return null;
    const inherited = resolveInheritedFields(entity, entitiesById);
    // Type-inferred kind mirrors EntityRenderer's logic: cloth/flag/
    // particles auto-default into their natural Material slot when no
    // explicit override is set.
    const typeKind =
      entity.type === "cloth"
        ? "Cloth"
        : entity.type === "flag"
          ? "Flag"
          : entity.type === "particles"
            ? "Particle"
            : undefined;
    const ownKind = entity.material?.kind;
    const effectiveKind = ownKind ?? typeKind ?? inherited.materialKind ?? "Solid";
    const resolved = resolveMaterialDefaults({
      ...(inherited.material ?? {}),
      kind: effectiveKind,
    });
    // Walk up the parent chain to find which ancestor the kind came
    // from when neither an own nor a type-inferred kind is set. Mirrors
    // resolveInheritedFields' walk so the source label stays in sync.
    let inheritedFrom: { id: string; name: string } | null = null;
    if (!ownKind && !typeKind) {
      let cur = entity.parentId ? entitiesById.get(entity.parentId) ?? null : null;
      for (let depth = 0; cur && depth < 64; depth++) {
        if (cur.material?.kind) {
          inheritedFrom = { id: cur.id, name: cur.name };
          break;
        }
        cur = cur.parentId ? entitiesById.get(cur.parentId) ?? null : null;
      }
    }
    return {
      entityName: entity.name,
      kind: resolved.kind,
      blocksLineOfSight: resolved.blocksLineOfSight,
      blocksProjectiles: resolved.blocksProjectiles,
      blocksAudio: resolved.blocksAudio,
      isOwn: !!ownKind,
      isTypeDefault: !ownKind && !!typeKind,
      inheritedFrom,
    };
  }, [hoveredEntityId, allEntitiesForHover]);

  // Bumping `viewportEpoch` after a crash forces React to discard the old
  // <Canvas> tree (with its broken WebGL context, dangling refs, half-mounted
  // post-processing passes, etc.) and rebuild it from scratch.
  const [viewportEpoch, setViewportEpoch] = useState(0);
  // Tracks whether we've already spent the boundary's silent auto-retry budget
  // for the current page session. Without this latch a deterministic crash
  // inside the Canvas tree would loop forever: boundary catches → onAutoRetry
  // → key bump → fresh boundary (autoRetryRequested resets) → catches again →
  // repeat. We grant exactly one silent retry per page load; the user's
  // explicit "Reload viewport" click re-grants it (treated as a fresh attempt
  // because the user has had a chance to fix something — typically by editing
  // a script or removing a problematic entity).
  const [autoRetryUsed, setAutoRetryUsed] = useState(false);
  const [webgl, setWebgl] = useState(() => probeWebGL());
  // Tracks whether the canvas currently holds pointer-lock during play.
  // Drives the dive-style "Click to capture · ESC to release" overlay below.
  // Reset to false on play stop via the effect further down.
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  useEffect(() => {
    if (!isPlaying) setIsPointerLocked(false);
  }, [isPlaying]);

  const { data: prefabs = [] } = useListPrefabs(projectId ?? 0, {
    query: { queryKey: getListPrefabsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const prefabsById = useMemo(() => {
    const m = new Map<number, Prefab>();
    for (const p of prefabs) m.set(p.id, p);
    return m;
  }, [prefabs]);

  const hint = !isPlaying
    ? "Edit Mode — drag the gizmo · right-click for menu · F to focus selection"
    : cameraMode === "rts"
      ? "▶ RTS — WASD or edge of screen to pan · wheel to zoom"
      : cameraMode === "thirdPerson"
        ? "▶ Third-person — drag to orbit · WASD to move · Shift to sprint"
        : cameraMode === "firstPerson"
          ? "▶ First-person — click to lock pointer · WASD + mouselook · Shift to sprint · Esc to release"
          : "▶ PLAY MODE — physics & scripts running";

  const spawnFromHotbar = (slotIndex: number) => {
    const id = hotbar[slotIndex];
    if (id == null) return;
    const p = prefabsById.get(id);
    if (!p) return;
    const data = p.data as PrefabPayload;
    if (!data?.entities?.length) return;
    spawnPrefabEntities(data.entities, p.id);
    pushLog("info", `Spawned "${p.name}" via slot ${slotIndex + 1}.`);
  };

  if (!webgl.ok) {
    return (
      <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
        <WebGLUnavailable
          reason={webgl.reason}
          onRetry={() => {
            const next = probeWebGL();
            setWebgl(next);
            // If the retry succeeded, also bump the viewport epoch so any
            // stale boundary state from a prior crash is cleared.
            if (next.ok) setViewportEpoch((n) => n + 1);
          }}
        />
      </div>
    );
  }

  const onEntityFocus = (id: string) => {
    selectEntity(id);
    requestFocus();
  };
  const onEntityRename = (id: string, currentName: string) => {
    const next = window.prompt("Rename entity", currentName);
    if (next == null) return; // user cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentName) return;
    cmdRenameEntity(id, trimmed);
  };
  // ──────────────────────────────────────────────────────────────────────
  // Hierarchy → Viewport bridge: "Move to ▸ Terrain / Pathfinding"
  // ──────────────────────────────────────────────────────────────────────
  // The Hierarchy context-menu fires `gameforge:moveTo` for the two
  // operations that need a live THREE scene (downward raycast for
  // Terrain) or the cached recast navmesh (nearest-poly for
  // Pathfinding). We keep the listener up here in the wrapper
  // component so we can call cmdSetEntityTransform (the same store
  // action the gizmo drag uses) and emit a pushLog on failure.
  useEffect(() => {
    const handler = async (ev: Event) => {
      const detail = (ev as CustomEvent<{ entityId?: string; target?: "terrain" | "navmesh" }>).detail;
      const id = detail?.entityId;
      const target = detail?.target;
      if (!id || !target) return;
      const scene = sceneRef.current;
      if (!scene) {
        pushLog("warn", "Move-to: scene not ready.");
        return;
      }
      // Find the entity's three.js group via the same `userData.entityId`
      // tag the FocusCameraController and click-pick rely on.
      let obj: THREE.Object3D | null = null;
      scene.traverse((o) => {
        if (obj) return;
        const ud = o.userData as { entityId?: string } | undefined;
        if (ud?.entityId === id) obj = o;
      });
      if (!obj) {
        pushLog("warn", "Move-to: entity not in scene.");
        return;
      }
      const o3d = obj as THREE.Object3D;
      o3d.updateWorldMatrix(true, false);
      const worldPos = new THREE.Vector3();
      o3d.getWorldPosition(worldPos);

      if (target === "terrain") {
        // Cast straight down from a point well above the entity. We
        // walk THREE meshes filtered by `userData.layer === "Terrain"`
        // so we don't snap onto random props underneath. Falls back to
        // ANY visible mesh if no Terrain-tagged geometry is hit (so
        // the action still works on simple scenes that haven't tagged
        // their ground).
        const start = worldPos.clone();
        start.y += 100;
        const ray = new THREE.Raycaster(start, new THREE.Vector3(0, -1, 0), 0, 1000);
        // Collect candidate meshes once: skip the entity's own subtree
        // (don't snap to yourself) and skip helper / gizmo objects.
        const ownIds = new Set<THREE.Object3D>();
        o3d.traverse((c) => ownIds.add(c));
        const meshes: THREE.Mesh[] = [];
        // Walk the parent chain looking for gizmos, TransformControls,
        // helpers, drei <Grid>, or anything else that's not real scene
        // geometry. We can't just check `userData.helper` because the
        // selection gizmo's own meshes don't carry that tag — they live
        // under a `TransformControls` ancestor instead.
        const isHelperLike = (c: THREE.Object3D): boolean => {
          let cur: THREE.Object3D | null = c;
          while (cur) {
            const t = cur.type;
            if (
              t === "TransformControls" ||
              t === "TransformControlsPlane" ||
              t === "TransformControlsGizmo" ||
              t === "GridHelper" ||
              t === "AxesHelper" ||
              t === "BoxHelper" ||
              t === "Line" ||
              t === "LineSegments"
            ) return true;
            const ud = cur.userData as { helper?: boolean; isTransformControls?: boolean } | undefined;
            if (ud?.helper || ud?.isTransformControls) return true;
            cur = cur.parent;
          }
          return false;
        };
        scene.traverse((c) => {
          if (!(c as THREE.Mesh).isMesh) return;
          if (!c.visible) return;
          if (ownIds.has(c)) return;
          if (isHelperLike(c)) return;
          meshes.push(c as THREE.Mesh);
        });
        const hits = ray.intersectObjects(meshes, false);
        // Prefer Terrain-layer hits; fall back to any hit.
        let hit = hits.find((h) => {
          let cur: THREE.Object3D | null = h.object;
          while (cur) {
            const ud = cur.userData as { layer?: string } | undefined;
            if (ud?.layer === "Terrain") return true;
            cur = cur.parent;
          }
          return false;
        }) ?? hits[0];
        if (!hit) {
          pushLog("warn", "Move-to terrain: no ground beneath entity.");
          return;
        }
        // Convert the world-space hit point into the entity's PARENT
        // space (cmdSetEntityTransform writes local position). For root
        // entities parent is the scene → identity → world == local.
        const local = hit.point.clone();
        if (o3d.parent && o3d.parent !== scene) {
          o3d.parent.updateWorldMatrix(true, false);
          local.applyMatrix4(o3d.parent.matrixWorld.clone().invert());
        }
        cmdSetEntityTransform(id, "position", [local.x, local.y, local.z]);
        pushLog("info", `Snapped "${o3d.name || id}" to ground.`);
        return;
      }

      if (target === "navmesh") {
        // Snap to the nearest navmesh poly. Requires a baked navmesh —
        // we read from the session-scoped `__navmeshBlobs` map the
        // bake flow populates.
        try {
          const blobs = (window as unknown as {
            __navmeshBlobs?: Map<number, Uint8Array>;
          }).__navmeshBlobs;
          const env = useEditor.getState().sceneData.environment;
          const assetId = env?.navmeshAssetId;
          const blob = assetId ? blobs?.get(assetId) : undefined;
          if (!blob) {
            pushLog("warn", "Move-to pathfinding: no navmesh baked yet (use AI tool or bake panel).");
            return;
          }
          const { loadNavmesh, sampleNavmesh } = await import("@/lib/navmesh");
          const loaded = await loadNavmesh(blob, assetId);
          // sampleNavmesh defaults to a tight ±2m XZ × ±4m Y search
          // box, which is right for "snap an agent already standing on
          // the mesh". For an editor "Move to ▸ Pathfinding" command
          // the user expects global search, so we expand outward in
          // exponentially larger boxes until we find a poly (or give
          // up at ±256m).
          let sampled: ReturnType<typeof sampleNavmesh> = null;
          for (const extent of [4, 16, 64, 256]) {
            sampled = sampleNavmesh(
              loaded,
              [worldPos.x, worldPos.y, worldPos.z],
              [extent, Math.max(extent, 8), extent],
            );
            if (sampled) break;
          }
          if (!sampled) {
            pushLog("warn", "Move-to pathfinding: no navmesh poly within range.");
            return;
          }
          const local = new THREE.Vector3(sampled.point[0], sampled.point[1], sampled.point[2]);
          if (o3d.parent && o3d.parent !== scene) {
            o3d.parent.updateWorldMatrix(true, false);
            local.applyMatrix4(o3d.parent.matrixWorld.clone().invert());
          }
          cmdSetEntityTransform(id, "position", [local.x, local.y, local.z]);
          pushLog("info", `Snapped "${o3d.name || id}" onto navmesh.`);
        } catch (err) {
          pushLog("error", `Move-to pathfinding failed: ${(err as Error).message}`);
        }
      }
    };
    window.addEventListener("gameforge:moveTo", handler);
    return () => window.removeEventListener("gameforge:moveTo", handler);
  }, [cmdSetEntityTransform, pushLog]);

  const onEntityResetTransform = (id: string) => {
    cmdSetEntityTransform(id, "position", [0, 0, 0]);
    cmdSetEntityTransform(id, "rotation", [0, 0, 0]);
    cmdSetEntityTransform(id, "scale", [1, 1, 1]);
  };

  return (
    <>
    <TemplateLoadingDialog
      open={templateLoader.isLoading}
      label={templateLoader.activeLabel}
      progress={templateLoader.progress}
      onCancel={templateLoader.cancel}
    />
    <ContextMenu
      onOpenChange={(open) => {
        if (open) {
          // Snapshot the ref into state so ContextMenuContent can render
          // entity-aware items. The ref was either set by an EntityRenderer's
          // r3f onContextMenu or cleared by the capture-phase reset below.
          setContextEntityId(lastContextEntityIdRef.current);
        } else {
          // Optional cleanup so a stale id doesn't bleed into a follow-up
          // open if the next right-click misses everything.
          setContextEntityId(null);
        }
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={wrapperRef}
          className="relative w-full h-full bg-background grid-pattern overflow-hidden"
          // Capture phase: runs BEFORE r3f's bubble-phase raycast on the
          // <canvas>. Resets the hover snapshot so a right-click on empty
          // space (no intersection → no per-entity handler fires) opens
          // the empty-space menu instead of acting on the previous hit.
          onContextMenuCapture={() => {
            lastContextEntityIdRef.current = null;
          }}
          onPointerMove={(e) => {
            // Track the pointer in container-local coords so the hover
            // chip can render at an offset from the cursor without
            // straying outside the viewport. Only updated while
            // hovering an entity to avoid pointless 60Hz re-renders.
            if (!hoveredEntityId) return;
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
        >
          <ViewportErrorBoundary
            key={viewportEpoch}
            autoRetryAvailable={!autoRetryUsed}
            onAutoRetry={() => {
              setAutoRetryUsed(true);
              setViewportEpoch((n) => n + 1);
            }}
            onReset={() => {
              setAutoRetryUsed(false);
              setViewportEpoch((n) => n + 1);
            }}
          >
            {/* Camera `far` bumped from the three.js default (1000)
              * to 5000 so distant terrain, skybox geometry, and large
              * open-world scenes don't get clipped at the horizon.
              * Near stays at the default 0.1 — small enough to walk
              * up to props without near-plane clipping. The 50000:1
              * far/near ratio is well within float32 depth-buffer
              * precision for an editor camera. */}
            <Canvas
              shadows="soft"
              camera={{
                position: [8, 8, 12],
                fov: 45,
                near: 0.1,
                far: recommendedCameraFar(),
              }}
              onPointerMissed={
                isPlaying
                  ? undefined
                  : () => {
                      if (isGizmoSwallowingClick()) return;
                      selectEntity(null);
                    }
              }
              gl={{
                /*
                 * Stable-rendering preset. Previously ran with
                 * antialias:false + relied solely on SMAA inside
                 * EffectsRig — in low-quality / transition states
                 * this produced visible edge shimmer ("blinking").
                 * MSAA + sRGB output + explicit PCFSoft shadow map
                 * gives a solid baseline regardless of post-FX state.
                 *
                 * Tone mapping stays NoToneMapping at the renderer
                 * because EffectsRig applies ACES via the <ToneMapping>
                 * effect; setting both would double-tone the image.
                 */
                antialias: true,
                powerPreference: "high-performance",
                toneMapping: THREE.NoToneMapping,
                outputColorSpace: THREE.SRGBColorSpace,
                stencil: false,
              }}
              dpr={[1, 2]}
              style={isPlaying ? { cursor: "none" } : undefined}
            >
              {isPlaying && <PointerLockBridge onChange={setIsPointerLocked} />}
              <DevtoolsBridge label="Forge · Scene" />
              <ViewportBridge />
              <color attach="background" args={[env.skyColor ?? "#0a0a14"]} />
              {/*
                Fog far plane was 80 units — at the new 2.5–3× map
                scale (arenas span ~120 units) that wall of fog
                started right behind the player and hid the entire
                map. Pushed near→far to 80→320 so fog only kisses the
                horizon instead of swallowing the playable area.
              */}
              <fog
                attach="fog"
                args={[
                  env.fog?.color ?? env.skyColor ?? "#0a0a14",
                  env.fog?.near ?? DEFAULT_FOG.near,
                  env.fog?.far ?? DEFAULT_FOG.far,
                ]}
              />
              <Lights />
              <Suspense fallback={null}>
                {isPlaying ? (
                  <ScenePlayMode />
                ) : (
                  <SceneEditMode
                    onContextEntity={(id) => {
                      lastContextEntityIdRef.current = id;
                    }}
                    onHoverEntity={(id, hovering, clientX, clientY) => {
                      // Use a functional update so a stale leave from a
                      // previous entity (which can fire AFTER the next
                      // entity's enter when the pointer slides between
                      // adjacent meshes) doesn't clobber the active id.
                      if (hovering) {
                        setHoveredEntityId(id);
                        // Seed the chip position from the enter event so
                        // it renders on the first frame instead of
                        // waiting for the next pointer-move tick.
                        if (clientX !== undefined && clientY !== undefined) {
                          const rect = wrapperRef.current?.getBoundingClientRect();
                          if (rect) {
                            setHoverPos({
                              x: clientX - rect.left,
                              y: clientY - rect.top,
                            });
                          }
                        }
                      } else {
                        setHoveredEntityId((prev) => (prev === id ? null : prev));
                      }
                    }}
                  />
                )}
              </Suspense>
              <NavmeshDebugOverlay />
              <EffectsRig highQuality={renderQuality === "high"} />
              {showStats && <Stats className="!left-auto !right-3 !top-3" />}
              {!isPlaying && (
                <>
                  {/*
                    Grid was at y=-0.001 which is well inside the
                    float32 depth-fight zone for any ground plane
                    sitting at y=0 — the visible "blink" on map
                    ground was the grid texels and the ground
                    fragment alternating per-frame as the camera
                    moved. Dropped to y=-0.02 (still imperceptible
                    against any solid ground) which is past the
                    fight zone at editor camera distances.
                  */}
                  <Grid
                    args={[40, 40]}
                    cellSize={1}
                    cellThickness={0.5}
                    cellColor="#2a2a3e"
                    sectionSize={5}
                    sectionThickness={1}
                    sectionColor="#d4af37"
                    fadeDistance={40}
                    fadeStrength={1.4}
                    infiniteGrid
                    position={[0, -0.02, 0]}
                  />
                  <OrbitControls makeDefault />
                  <FocusCameraController />
                  {/* Captures the live THREE.Scene out of the R3F
                    * tree into the parent component's ref so the
                    * `gameforge:moveTo` listener (which lives outside
                    * Canvas) can run raycasts against it without
                    * needing a render-tree-spanning context. */}
                  <SceneCapture sceneRef={sceneRef} />
                </>
              )}
              <ClickToDeselect />
            </Canvas>
          </ViewportErrorBoundary>

          <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-card/80 backdrop-blur border border-card-border text-xs font-mono text-muted-foreground pointer-events-none">
            <span className={isPlaying ? "text-accent" : ""}>{hint}</span>
          </div>

          {/* Floating Material info chip — appears in edit mode while
              hovering an entity. Shows the resolved Material kind, the
              three occlusion flags (sight / projectiles / audio), and
              the inheritance source when the kind came from an ancestor.
              pointer-events-none so it never steals clicks from the
              <canvas> underneath. */}
          {!isPlaying && hoverInfo && hoverPos && (
            <div
              className="pointer-events-none absolute z-30 rounded-md border border-card-border bg-card/90 backdrop-blur px-2.5 py-1.5 text-[11px] font-mono text-foreground shadow-lg max-w-[260px]"
              style={{
                left: Math.min(hoverPos.x + 14, (wrapperRef.current?.clientWidth ?? 0) - 270),
                top: Math.min(hoverPos.y + 14, (wrapperRef.current?.clientHeight ?? 0) - 80),
              }}
              data-testid="material-hover-chip"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-accent font-semibold">{hoverInfo.kind}</span>
                <span className="text-muted-foreground truncate">
                  {hoverInfo.entityName}
                </span>
              </div>
              <div className="text-muted-foreground">
                {[
                  hoverInfo.blocksLineOfSight ? "blocks sight" : "lets sight through",
                  hoverInfo.blocksProjectiles
                    ? "blocks bullets"
                    : "lets bullets through",
                  hoverInfo.blocksAudio ? "blocks audio" : "lets audio through",
                ].join(" · ")}
              </div>
              <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                {hoverInfo.isOwn
                  ? "Own material"
                  : hoverInfo.isTypeDefault
                    ? "From entity type default"
                    : hoverInfo.inheritedFrom
                      ? `Inherited from ${hoverInfo.inheritedFrom.name}`
                      : "Default (Solid)"}
              </div>
            </div>
          )}

          {isPlaying && <PlayHUD bus={getPlaySession().bus} />}

          {/* Click-to-capture overlay — appears whenever play is active and the
              pointer isn't currently locked. Dive-style: a thin centered card
              with the keybind hint. The Canvas underneath catches the click
              via PointerLockBridge, so this overlay is purely decorative
              (pointer-events: none). */}
          {isPlaying && !isPointerLocked && (
            <div
              className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
              data-testid="pointer-lock-prompt"
            >
              <div className="rounded-md border border-white/20 bg-black/70 px-5 py-3 text-center font-mono text-white shadow-xl backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-widest">
                  Click to capture mouse
                </div>
                <div className="mt-1 text-[11px] text-white/60">
                  ESC to release · WASD to move · LMB to fire · RMB to aim
                </div>
              </div>
            </div>
          )}

          {showEmptySceneOverlay && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              data-testid="empty-scene-overlay"
            >
              <div className="pointer-events-auto relative max-w-md w-[420px] rounded-xl border border-card-border bg-card/95 backdrop-blur shadow-xl p-5">
                <button
                  type="button"
                  onClick={() => setPickerDismissed(true)}
                  aria-label="Close template picker"
                  className="absolute top-2 right-2 w-7 h-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 border border-transparent hover:border-card-border transition-colors"
                  data-testid="empty-scene-overlay-close"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="text-[11px] font-heading uppercase tracking-[0.18em] text-accent mb-1">
                  New Scene
                </div>
                <h2 className="text-lg font-heading mb-1 pr-7">
                  Pick a starting template
                </h2>
                <p className="text-xs text-muted-foreground mb-4">
                  Each template ships with players, AI, lighting, and a level
                  ready to play. You can edit anything afterwards.
                </p>
                {tplQuery.isError ||
                (tplQuery.data !== undefined &&
                  !Array.isArray(tplQuery.data)) ? (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
                    data-testid="empty-scene-templates-error"
                  >
                    <div className="text-destructive font-medium mb-1">
                      Couldn't load templates from the server.
                    </div>
                    <div className="text-muted-foreground mb-2">
                      The template list will refresh automatically — or you can
                      retry now.
                    </div>
                    <button
                      type="button"
                      onClick={() => void tplQuery.refetch()}
                      className="px-2 py-1 rounded border border-card-border hover:border-accent hover:bg-accent/5 text-xs"
                      data-testid="empty-scene-templates-retry"
                    >
                      Retry
                    </button>
                  </div>
                ) : templateManifest.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">
                    Loading templates…
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {templateManifest.map((t) => (
                      <li key={t.key}>
                        <button
                          type="button"
                          onClick={() => onPickTemplate(t.key)}
                          className="w-full text-left px-3 py-2 rounded-md border border-card-border hover:border-accent hover:bg-accent/5 transition-colors group"
                          data-testid={`empty-scene-template-${t.key}`}
                        >
                          <div className="text-sm font-medium group-hover:text-accent">
                            {t.label}
                          </div>
                          <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                            {t.description}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-[10px] text-muted-foreground mt-3">
                  Or right-click the viewport to add primitives manually.
                </div>
              </div>
            </div>
          )}

          <Hotbar />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[220px]">
        {contextEntity && (
          <>
            <div
              className="px-2 py-1.5 text-[10px] font-heading uppercase tracking-[0.18em] text-accent flex items-center gap-2"
              data-testid="context-menu-entity-header"
            >
              <span className="opacity-60">Entity</span>
              <span className="text-foreground normal-case font-mono tracking-normal text-[11px] truncate max-w-[160px]">
                {contextEntity.name}
              </span>
            </div>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onEntityFocus(contextEntity.id)}
              data-testid="context-menu-entity-focus"
            >
              Focus camera
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => selectEntity(contextEntity.id)}
              data-testid="context-menu-entity-select"
            >
              Open in Inspector
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onEntityRename(contextEntity.id, contextEntity.name)}
              data-testid="context-menu-entity-rename"
            >
              Rename…
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => cmdDuplicateEntity(contextEntity.id)}
              data-testid="context-menu-entity-duplicate"
            >
              Duplicate
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onEntityResetTransform(contextEntity.id)}
              data-testid="context-menu-entity-reset"
            >
              Reset transform
            </ContextMenuItem>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => cmdRemoveEntity(contextEntity.id)}
              data-testid="context-menu-entity-delete"
            >
              Delete entity
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Plus className="size-3.5 mr-2" /> Add primitive
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {VIEWPORT_PRIMITIVES.map((p) => (
              <ContextMenuItem key={p.type} onClick={() => cmdAddEntity(p.type)}>
                <p.Icon className="size-3.5 mr-2" /> {p.label}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => cmdAddEmptyChild(null)}>
              <SquareIcon className="size-3.5 mr-2 opacity-60" /> Empty
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={hotbar.every((s) => s == null)}>
            <Plus className="size-3.5 mr-2" /> Spawn from hotbar
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {hotbar.map((slotId, idx) => {
              const p = slotId != null ? prefabsById.get(slotId) : undefined;
              return (
                <ContextMenuItem
                  key={idx}
                  disabled={!p}
                  onClick={() => spawnFromHotbar(idx)}
                >
                  <span className="font-mono text-[10px] text-muted-foreground mr-2 w-4">
                    {idx + 1}
                  </span>
                  {p ? p.name : <span className="opacity-50">empty</span>}
                </ContextMenuItem>
              );
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!projectId}
          onClick={() => window.dispatchEvent(new CustomEvent("gameforge:openMapGen"))}
        >
          <Wand2 className="size-3.5 mr-2" /> Generate map…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <BestPracticesSubMenu context="viewport" label="Scene best practices" />
      </ContextMenuContent>
    </ContextMenu>
    </>
  );
}
