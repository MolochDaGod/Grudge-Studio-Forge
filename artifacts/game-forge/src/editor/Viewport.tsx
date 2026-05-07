import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, Stats, TransformControls } from "@react-three/drei";
import { EffectsRig } from "@/scene/EffectsRig";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useListScripts, getListScriptsQueryKey, type Script } from "@workspace/api-client-react";
import { EntityRenderer } from "@/scene/EntityRenderer";
import { NavmeshDebugOverlay } from "@/scene/NavmeshDebugOverlay";
import { getCompiledBehavior, getCompiledScript, groundProbe, makeContext, raycastEntities, reconcileAgents, tickAgentSurfaces, type Compiled } from "@/scene/PlayRuntime";
import { type AgentActor } from "@/scene/agentRuntime";
import { loadNavmesh, findPath as navFindPath, sampleNavmesh as navSampleNavmesh } from "@/lib/navmesh";
import { getCachedBlob, hydrateNavmeshFromServer } from "@/lib/navmeshBake";
import type { AgentHandle } from "@/scene/csTranspile";
import type { SurfaceKind } from "@workspace/scene-schema";
import { computeFramingPose } from "@/lib/framing";
import {
  applyGroundSnap,
  DEFAULT_WALKABLE_SURFACES,
  getEntitySurfaceTag,
  isGroundSnapModifierHeld,
  shouldGroundSnap,
} from "@/lib/groundSnap";
import type { ScriptEntity } from "@/scene/csTranspile";
import { useKeyboardState } from "@/lib/keyboard";
import { useMouseState } from "@/scene/useMouseState";
import { PlayCameraController } from "@/scene/CameraControllers";
import { buildTree } from "@/lib/hierarchy";
import type { SceneEntity, EntityType } from "@/scene/types";
import { DEFAULT_GRAVITY, DEFAULT_FOG } from "@workspace/scene-schema";
import { BUILTIN_BEHAVIORS } from "@/lib/deathmatchBehaviors";
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
}: {
  data?: { entities: SceneEntity[] };
  /** Records the entity hit by the most recent right-click so the
   *  surrounding Radix `<ContextMenu>` can render entity-aware items. */
  onContextEntity?: (id: string) => void;
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
                      originOffset: 50,
                      maxDistance: 200,
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

function ScriptedEntities({
  bodyRefs,
}: {
  bodyRefs: React.MutableRefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const sceneData = useEditor((s) => s.sceneData);
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const isPaused = useEditor((s) => s.isPaused);
  const { data: scripts } = useListScripts(projectId ?? 0, {
    query: { queryKey: getListScriptsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const keysRef = useKeyboardState(true);
  const { gl, scene: threeScene, camera } = useThree();
  const mouseRef = useMouseState(gl.domElement);
  const session = useMemo(() => getPlaySession(), []);

  const startedRef = useRef<Set<string>>(new Set());
  const elapsedRef = useRef(0);
  // ── Per-entity nav-agent actors ────────────────────────────────────
  // We spawn one XState v5 actor per entity carrying a `navAgent`
  // component the moment ScriptedEntities sees it, hold the actors in
  // a plain Map<entityId, AgentActor>, and dispose every actor when
  // play mode tears down so the FSMs don't leak across play sessions.
  // The script runtime gets a thin `AgentHandle` view (no XState
  // surface area) via `ctx.scene.agent(id)`.
  const agentsRef = useRef<Map<string, AgentActor>>(new Map());
  // Last destination forwarded to a chasing agent — keyed by agent id.
  // Used to throttle pursuit replans so a 60Hz target update doesn't
  // burn a Recast plan every frame.
  const chaseLastDest = useRef<Map<string, [number, number, number]>>(new Map());
  // Cached `LoadedNavmesh` for the current scene's `navmeshAssetId`.
  // Lazy: filled the first time a script calls `ctx.nav.findPath` /
  // `ctx.nav.sample`, invalidated when the asset id flips.
  const loadedNavRef = useRef<{
    assetId: number | null;
    promise: Promise<Awaited<ReturnType<typeof loadNavmesh>>> | null;
    loaded: Awaited<ReturnType<typeof loadNavmesh>> | null;
  }>({ assetId: null, promise: null, loaded: null });
  /** Pending teleports queued by `scene.setPosition` — applied after all
   *  scripts run so a script that moves another entity doesn't observe a
   *  half-applied state mid-iteration. The corresponding entity-ids are
   *  also frame-stamped into `session.pendingTeleportFrame` so other
   *  writers (PlayCameraController) can compare stamp === current frame
   *  elapsedTime and skip their write — order-independent. */
  const pendingTeleports = useRef<Map<string, [number, number, number]>>(new Map());

  // Tear down the play session when this component unmounts (i.e., user
  // toggles play off). Resetting clears the bus, inboxes, and per-entity
  // state so the next play-through starts clean.
  useEffect(() => {
    startedRef.current.clear();
    elapsedRef.current = 0;
    return () => {
      // Tear down every spawned agent actor so the XState services
      // don't keep holding references to closures that captured this
      // component's render scope.
      for (const a of agentsRef.current.values()) {
        try {
          a.stop();
        } catch {
          /* actor was never started or already stopped */
        }
      }
      agentsRef.current.clear();
      loadedNavRef.current = { assetId: null, promise: null, loaded: null };
      resetPlaySession();
    };
  }, []);

  const scriptMap = useMemo(() => {
    const m = new Map<number, Script>();
    (scripts ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [scripts]);

  // Snapshot helper — turns a SceneEntity into the smaller ScriptEntity the
  // script runtime sees, with live position/rotation pulled from the active
  // rigid body or group when available.
  const snapshot = (entity: SceneEntity): ScriptEntity => {
    const se: ScriptEntity = {
      id: entity.id,
      name: entity.name,
      position: [...entity.transform.position] as [number, number, number],
      rotation: [...entity.transform.rotation] as [number, number, number],
      scale: [...entity.transform.scale] as [number, number, number],
      layer: entity.layer ?? "Default",
    };
    const bodyOrGroup = bodyRefs.current.get(entity.id);
    if (bodyOrGroup) {
      if ("translation" in bodyOrGroup) {
        const t = bodyOrGroup.translation();
        se.position = [t.x, t.y, t.z];
      } else {
        se.position = [bodyOrGroup.position.x, bodyOrGroup.position.y, bodyOrGroup.position.z];
        se.rotation = [bodyOrGroup.rotation.x, bodyOrGroup.rotation.y, bodyOrGroup.rotation.z];
      }
    }
    return se;
  };

  // Direct teleport helper — used both by setPosition() and by the player
  // respawn path. Rapier RigidBodyType: Dynamic=0, Fixed=1,
  // KinematicPositionBased=2, KinematicVelocityBased=3. Kinematic bodies use
  // setNextKinematicTranslation; dynamic bodies use setTranslation; plain
  // groups just set position.
  const teleport = (id: string, position: [number, number, number]): boolean => {
    const bodyOrGroup = bodyRefs.current.get(id);
    if (!bodyOrGroup) return false;
    if ("setNextKinematicTranslation" in bodyOrGroup) {
      const body = bodyOrGroup;
      const t = body.bodyType?.() ?? 0;
      const isKinematic = t === 2 || t === 3;
      if (isKinematic) {
        body.setNextKinematicTranslation({ x: position[0], y: position[1], z: position[2] });
      } else {
        body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
      }
    } else {
      bodyOrGroup.position.set(position[0], position[1], position[2]);
    }
    return true;
  };

  useFrame((state, delta) => {
    if (isPaused) return;
    elapsedRef.current += delta;

    // ── Reconcile the agent map against the current scene ────────────
    // Spawn an actor for any entity that gained a `navAgent` since
    // last frame; dispose the actor for any entity that lost it (or
    // was despawned). Helper lives in PlayRuntime so the same logic
    // is reusable from headless tests.
    reconcileAgents(sceneData.entities, agentsRef.current);

    // Surface-driven FSM ticks: drop a short ground probe under each
    // agent and feed the resulting surface tag into its actor as a
    // `{type:"surface", surface}` event. The XState v5 child-state
    // guards read `event.surface` (NOT `context.currentSurface`) so
    // the Climb/Swim transitions land on the same frame as the probe.
    tickAgentSurfaces(threeScene, agentsRef.current, (id) => {
      const ent = sceneData.entities.find((e) => e.id === id);
      if (!ent) return null;
      const bg = bodyRefs.current.get(id);
      if (bg) {
        if ("translation" in bg) {
          const t = bg.translation();
          return [t.x, t.y, t.z];
        }
        return [bg.position.x, bg.position.y, bg.position.z];
      }
      return [...ent.transform.position] as [number, number, number];
    });

    // Lazily prepare the loaded navmesh whenever the scene's
    // `navmeshAssetId` changes. We never block the script tick on the
    // import — first frame after a bake reports `null` from
    // `ctx.nav.findPath` and the script falls through to direct
    // steering until the next frame. When the asset id is set but
    // its blob is missing from the in-memory cache (typical post-
    // reload state) AND the scene carries a server-side `navmeshBlobKey`,
    // we kick a one-shot hydration fetch so the navmesh comes back
    // online without forcing the user to re-bake.
    const navAssetId = sceneData.environment.navmeshAssetId ?? null;
    const navBlobKey = sceneData.environment.navmeshBlobKey ?? null;
    if (loadedNavRef.current.assetId !== navAssetId) {
      loadedNavRef.current = { assetId: navAssetId, promise: null, loaded: null };
      if (navAssetId !== null) {
        const blob = getCachedBlob(navAssetId);
        const blobPromise: Promise<Uint8Array | null> = blob
          ? Promise.resolve(blob)
          : navBlobKey
            ? hydrateNavmeshFromServer(navBlobKey, projectId).then(() =>
                getCachedBlob(navAssetId),
              )
            : Promise.resolve(null);
        loadedNavRef.current.promise = blobPromise.then((b) =>
          b ? loadNavmesh(b, navAssetId) : (null as never),
        );
        loadedNavRef.current.promise
          .then((l) => {
            if (l && loadedNavRef.current.assetId === navAssetId) {
              loadedNavRef.current.loaded = l;
            }
          })
          .catch(() => {
            /* corrupt blob / 404 — leave loaded as null so scripts
               get a transient miss rather than a hard crash. */
          });
      }
    }
    const loadedNav = loadedNavRef.current.loaded;
    const navFindPathFn = (
      start: [number, number, number],
      end: [number, number, number],
      options?: { areaFilter?: SurfaceKind[] },
    ): [number, number, number][] | null =>
      loadedNav ? navFindPath(loadedNav, start, end, options ?? {}) : null;
    const navSampleFn = (pos: [number, number, number]) =>
      loadedNav ? navSampleNavmesh(loadedNav, pos) : null;

    // Snapshot the live world position of an entity (Rapier body or
    // plain group) — used by `agent.moveTo(targetId)` so the FSM
    // chases a moving target's actual coordinates each tick.
    const livePositionOf = (id: string): [number, number, number] | null => {
      const bg = bodyRefs.current.get(id);
      if (bg) {
        if ("translation" in bg) {
          const t = bg.translation();
          return [t.x, t.y, t.z];
        }
        return [bg.position.x, bg.position.y, bg.position.z];
      }
      const ent = sceneData.entities.find((e) => e.id === id);
      return ent ? ([...ent.transform.position] as [number, number, number]) : null;
    };

    // Build the per-entity AgentHandle view (closes over the resolved
    // actor; the `agent(id)` call site doesn't pay actor lookup cost
    // when the requested entity has no navAgent).
    const agentFor = (id: string): AgentHandle | undefined => {
      const actor = agentsRef.current.get(id);
      if (!actor) return undefined;
      return {
        state: () => actor.state(),
        currentClip: () => actor.currentClip(),
        isStuck: () => actor.isStuck(),
        patrol: () => actor.send({ type: "patrol" }),
        chase: (targetId: string) => actor.send({ type: "chase", targetId }),
        moveTo: (target) => {
          if (typeof target === "string") {
            const dest = livePositionOf(target);
            if (dest) actor.send({ type: "moveTo", destination: dest });
          } else {
            actor.send({ type: "moveTo", destination: target });
          }
        },
        attack: (targetId: string) => actor.send({ type: "attack", targetId }),
        replan: () => actor.send({ type: "replan" }),
        stop: () => actor.send({ type: "stop" }),
      };
    };

    // ── Animation crossfade bridge ─────────────────────────────────
    // Each agent's currently-desired clip is published to a window-
    // scoped map that EntityRenderer's LoadedModel reads in its own
    // animation effect — this lets the FSM drive the renderer's
    // crossfade without coupling EntityRenderer to the agent runtime.
    // We refresh on every frame so a state transition (chase→attack→
    // chase) lands on the next render tick.
    const w = window as unknown as {
      __agentClips?: Map<string, string>;
    };
    w.__agentClips ??= new Map();
    for (const [id, actor] of agentsRef.current) {
      w.__agentClips.set(id, actor.currentClip());
    }
    // Drop dead entries so a despawned agent's last clip doesn't
    // pin the renderer to e.g. "attack" forever on a future entity
    // that happens to reuse the same id.
    for (const id of [...w.__agentClips.keys()]) {
      if (!agentsRef.current.has(id)) w.__agentClips.delete(id);
    }

    // ── Drain queued AI `move_agent_to` requests. The tool runs at
    // edit-time and pushes destinations onto `__pendingAgentMoves`;
    // we forward them once the matching agent exists in play mode.
    const pendingW = window as unknown as {
      __pendingAgentMoves?: Map<
        string,
        [number, number, number] | { entityId: string }
      >;
    };
    if (pendingW.__pendingAgentMoves) {
      for (const [aid, target] of [...pendingW.__pendingAgentMoves]) {
        const actor = agentsRef.current.get(aid);
        if (!actor) continue;
        if (Array.isArray(target)) {
          actor.send({ type: "moveTo", destination: target });
        } else {
          const dest = livePositionOf(target.entityId);
          if (dest) actor.send({ type: "moveTo", destination: dest });
        }
        pendingW.__pendingAgentMoves.delete(aid);
      }
    }

    // ── Locomotion: ask each agent for its desired velocity this
    // frame and apply it to the matching Rapier body / Object3D. The
    // path planner is bound to the agent's `filter` so swim-only / no-
    // water agents share one navmesh without colliding routes.
    for (const [id, actor] of agentsRef.current) {
      const ent = sceneData.entities.find((e) => e.id === id);
      if (!ent) continue;
      // Continuous pursuit — when an agent is chasing a target entity,
      // refresh `destination` from the target's live position each
      // frame so the planner re-routes as the target moves.
      const snap = actor.ref.getSnapshot();
      const stateName = snap.value as string;
      const targetId = (snap.context as { targetId: string | null }).targetId;
      if ((stateName === "chase" || stateName === "attack") && targetId) {
        const live = livePositionOf(targetId);
        if (live) {
          // Only resend (and replan) when the target has drifted >0.5m
          // from the last forwarded destination — keeps us off the
          // Recast hot path during 60Hz target updates.
          const last = chaseLastDest.current.get(id);
          const moved =
            !last ||
            Math.hypot(live[0] - last[0], live[2] - last[2]) > 0.5;
          if (moved) {
            chaseLastDest.current.set(id, live);
            actor.send({ type: "moveTo", destination: live });
          }
        }
      } else if (chaseLastDest.current.has(id)) {
        chaseLastDest.current.delete(id);
      }
      const bg = bodyRefs.current.get(id);
      let pos: [number, number, number];
      if (bg && "translation" in bg) {
        const t = bg.translation();
        pos = [t.x, t.y, t.z];
      } else if (bg) {
        pos = [bg.position.x, bg.position.y, bg.position.z];
      } else {
        pos = [...ent.transform.position];
      }
      const filter = ent.navAgent?.filter;
      const plan = loadedNav
        ? (s: [number, number, number], e: [number, number, number]) =>
            navFindPath(loadedNav, s, e, { areaFilter: filter })
        : undefined;
      const { velocity, reached } = actor.tick({ position: pos, dt: delta, plan });
      if (bg && "setLinvel" in bg) {
        // Preserve the body's current Y so gravity / jumps stay intact.
        const cur = bg.linvel();
        bg.setLinvel({ x: velocity[0], y: cur.y, z: velocity[2] }, true);
      } else if (bg) {
        bg.position.x += velocity[0] * delta;
        bg.position.z += velocity[2] * delta;
      }
      if (reached) actor.send({ type: "stop" });
    }

    // Pre-build helpers reused across all scripts this frame.
    const findEntity = (name: string): ScriptEntity | undefined => {
      const found = sceneData.entities.find((e) => e.name === name);
      return found ? snapshot(found) : undefined;
    };
    const findEntityById = (id: string): ScriptEntity | undefined => {
      const found = sceneData.entities.find((e) => e.id === id);
      return found ? snapshot(found) : undefined;
    };
    const findEntities = (predicate: (e: ScriptEntity) => boolean): ScriptEntity[] => {
      const out: ScriptEntity[] = [];
      for (const e of sceneData.entities) {
        const se = snapshot(e);
        if (predicate(se)) out.push(se);
      }
      return out;
    };

    // ---------------- Hierarchy traversal ---------------------------------
    // Build a children-by-parent map once per frame so parentOf/childrenOf/
    // descendantsOf are all O(1) per call. Snapshots are produced lazily so
    // callers that just want IDs don't pay the snapshot cost.
    const childrenByParent = new Map<string, typeof sceneData.entities>();
    const entityById = new Map<string, (typeof sceneData.entities)[number]>();
    for (const e of sceneData.entities) {
      entityById.set(e.id, e);
      const key = e.parentId ?? "";
      const arr = childrenByParent.get(key);
      if (arr) arr.push(e);
      else childrenByParent.set(key, [e]);
    }

    const parentOf = (id: string): ScriptEntity | undefined => {
      const e = entityById.get(id);
      if (!e?.parentId) return undefined;
      const p = entityById.get(e.parentId);
      return p ? snapshot(p) : undefined;
    };
    const childrenOf = (id: string): ScriptEntity[] => {
      const arr = childrenByParent.get(id);
      if (!arr) return [];
      return arr.map((c) => snapshot(c));
    };
    const descendantsOf = (id: string): ScriptEntity[] => {
      const out: ScriptEntity[] = [];
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        const arr = childrenByParent.get(cur);
        if (!arr) continue;
        for (const c of arr) {
          out.push(snapshot(c));
          stack.push(c.id);
        }
      }
      return out;
    };
    const findChildren = (
      rootId: string,
      predicate: (e: ScriptEntity) => boolean,
      deep = false,
    ): ScriptEntity[] => {
      const candidates = deep ? descendantsOf(rootId) : childrenOf(rootId);
      return candidates.filter(predicate);
    };
    // Compose world position by walking the ancestor chain.
    // Honour rotation + scale by stacking THREE.Object3D scratch nodes.
    const wpScratchA = new THREE.Object3D();
    const wpScratchB = new THREE.Object3D();
    const wpVec = new THREE.Vector3();
    const worldPosition = (id: string): [number, number, number] => {
      const e = entityById.get(id);
      if (!e) return [0, 0, 0];
      // Walk up to root to collect chain (root → leaf).
      const chain: typeof sceneData.entities = [];
      let cursor: (typeof sceneData.entities)[number] | undefined = e;
      const seen = new Set<string>(); // cycle guard
      while (cursor && !seen.has(cursor.id)) {
        chain.unshift(cursor);
        seen.add(cursor.id);
        cursor = cursor.parentId ? entityById.get(cursor.parentId) : undefined;
      }
      // Apply each link's local TRS by reusing two scratch nodes (parent/child).
      // We explicitly set `quaternion.setFromEuler(rotation)` rather than
      // relying on Euler's onChange callback, so the composition is robust to
      // any internal THREE refactors that change Euler→Quaternion sync timing.
      let parentNode: THREE.Object3D | null = null;
      for (let i = 0; i < chain.length; i++) {
        const link = chain[i];
        const node = i % 2 === 0 ? wpScratchA : wpScratchB;
        node.position.set(...link.transform.position);
        node.rotation.set(...link.transform.rotation);
        node.quaternion.setFromEuler(node.rotation);
        node.scale.set(...link.transform.scale);
        node.matrix.compose(node.position, node.quaternion, node.scale);
        if (parentNode) {
          // childWorld = parentWorld * childLocal.
          node.matrixWorld.multiplyMatrices(parentNode.matrixWorld, node.matrix);
        } else {
          node.matrixWorld.copy(node.matrix);
        }
        parentNode = node;
      }
      if (!parentNode) return [...e.transform.position];
      wpVec.setFromMatrixPosition(parentNode.matrixWorld);
      return [wpVec.x, wpVec.y, wpVec.z];
    };
    const setEntityPosition = (id: string, pos: [number, number, number]): boolean => {
      // Defer the actual write — see pendingTeleports comment above. We also
      // stamp the id with THIS frame's elapsedTime on the play session.
      // External writers (camera controller) compare their own state.clock
      // .elapsedTime against this stamp and skip their write if equal —
      // making the arbitration order-independent across useFrame callbacks.
      pendingTeleports.current.set(id, [pos[0], pos[1], pos[2]]);
      session.pendingTeleportFrame.set(id, state.clock.elapsedTime);
      return bodyRefs.current.has(id);
    };
    const freeze = (id: string) => session.frozenBodies.add(id);
    const unfreeze = (id: string) => session.frozenBodies.delete(id);
    const cameraPosition = (): [number, number, number] => [
      camera.position.x,
      camera.position.y,
      camera.position.z,
    ];
    const cameraDirection = (): [number, number, number] => {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      return [dir.x, dir.y, dir.z];
    };
    const castRay = (
      origin: [number, number, number],
      direction: [number, number, number],
      maxDistance: number,
      excludeIds: string[] | undefined,
      layerMask: string[] | undefined,
      materialFilter?: import("@/scene/PlayRuntime").MaterialRayFilter,
    ) =>
      raycastEntities(
        threeScene,
        origin,
        direction,
        maxDistance,
        excludeIds,
        layerMask,
        materialFilter,
      );
    const findEntitiesByLayer = (name: string): ScriptEntity[] => {
      const out: ScriptEntity[] = [];
      for (const e of sceneData.entities) {
        if ((e.layer ?? "Default") === name) out.push(snapshot(e));
      }
      return out;
    };

    for (const entity of sceneData.entities) {
      // Resolve up to two compiled scripts: the built-in behavior (if any)
      // and the user-attached scriptId. Both run, behavior first, so the
      // user can layer custom logic on top of a stock player/enemy.
      const behaviorSrc = entity.behavior ? BUILTIN_BEHAVIORS[entity.behavior] : null;
      const userScript = entity.scriptId ? scriptMap.get(entity.scriptId) : null;
      const behaviorCompiled: Compiled | null =
        behaviorSrc && entity.behavior ? getCompiledBehavior(entity.behavior, behaviorSrc) : null;
      const userCompiled: Compiled | null = userScript ? getCompiledScript(userScript) : null;

      if (!behaviorCompiled && !userCompiled) continue;

      const scriptEntity = snapshot(entity);
      const ctx = makeContext({
        entityId: entity.id,
        delta,
        elapsed: elapsedRef.current,
        keys: keysRef.current,
        mouse: mouseRef.state,
        log: (level, text) =>
          pushLog(level, `[${entity.name}] ${text}`, {
            scriptId: entity.scriptId ?? null,
            entityId: entity.id,
          }),
        findEntity,
        findEntities,
        findEntityById,
        setEntityPosition,
        castRay,
        findEntitiesByLayer,
        cameraPosition,
        cameraDirection,
        inboxes: session.inboxes,
        bus: session.bus,
        states: session.states,
        triggers: session.triggers,
        despawn: (id: string) => {
          // Bypass the command stack — play-mode despawns shouldn't bloat
          // the editor undo history. The store's `removeEntity` is the
          // command-wrapping path; reach for the raw entities mutation.
          // We must walk the FULL descendant subtree (not just direct
          // children) so deep hierarchies don't leave orphan grandchildren
          // floating in scene data after their root despawns.
          const store = useEditor.getState();
          const exists = store.sceneData.entities.some((e) => e.id === id);
          if (!exists) return false;
          const childrenByParent = new Map<string, string[]>();
          for (const e of store.sceneData.entities) {
            if (!e.parentId) continue;
            const arr = childrenByParent.get(e.parentId);
            if (arr) arr.push(e.id);
            else childrenByParent.set(e.parentId, [e.id]);
          }
          const toRemove = new Set<string>([id]);
          const stack = [id];
          while (stack.length) {
            const cur = stack.pop()!;
            const kids = childrenByParent.get(cur);
            if (!kids) continue;
            for (const k of kids) {
              if (!toRemove.has(k)) {
                toRemove.add(k);
                stack.push(k);
              }
            }
          }
          useEditor.setState((s) => ({
            sceneData: {
              ...s.sceneData,
              entities: s.sceneData.entities.filter((e) => !toRemove.has(e.id)),
            },
          }));
          return true;
        },
        freeze,
        unfreeze,
        parentOf,
        childrenOf,
        descendantsOf,
        findChildren,
        worldPosition,
        agentFor,
        navFindPath: navFindPathFn,
        navSample: navSampleFn,
      });

      // Run start() once — for either source. Both run on the same frame.
      // We MUST register start before the first inbox flush, otherwise any
      // message addressed to this entity on frame N would be dropped because
      // the handler hasn't been registered yet.
      const startedKey = `${entity.id}:${entity.behavior ?? ""}:${entity.scriptId ?? ""}`;
      try {
        if (!startedRef.current.has(startedKey)) {
          // Seed env-tunable knobs into per-entity state before start() so
          // built-in deathmatch behaviors can read e.g. ctx.state.respawnDelay
          // / ctx.state.scoreLimit. Behaviors fall back to hardcoded defaults
          // if these are unset.
          if (sceneData.environment.respawnDelay !== undefined) {
            ctx.state.respawnDelay = sceneData.environment.respawnDelay;
          }
          if (sceneData.environment.scoreLimit !== undefined) {
            ctx.state.scoreLimit = sceneData.environment.scoreLimit;
          }
          if (behaviorCompiled?.start) behaviorCompiled.start(scriptEntity, ctx);
          if (userCompiled?.start && !userCompiled.error) userCompiled.start(scriptEntity, ctx);
          startedRef.current.add(startedKey);
        }
        // Now that start() has registered any scene.on() handlers, flush
        // pending inbox messages so they're delivered before update().
        session.inboxes.flush(entity.id);
        if (behaviorCompiled?.update) behaviorCompiled.update(scriptEntity, ctx);
        if (userCompiled?.update && !userCompiled.error) userCompiled.update(scriptEntity, ctx);
      } catch (err) {
        pushLog("error", `[${entity.name}] ${(err as Error).message}`, {
          scriptId: entity.scriptId ?? null,
          entityId: entity.id,
        });
        continue;
      }

      // Apply transform mutations back to the body / group (script may have
      // moved the entity by writing entity.position directly).
      //
      // Skip controller-driven entities: PlayCameraController owns their
      // body each frame, and ours would clobber its setNextKinematicTranslation
      // queue. Behavior scripts on a controller-driven entity (e.g. the
      // player-deathmatch behavior) interact with the world via inbox/events/
      // setPosition(), not by mutating entity.position directly.
      const isControllerDriven = !!entity.controllerKind && entity.controllerKind !== "none";
      const bodyOrGroup = bodyRefs.current.get(entity.id);
      if (bodyOrGroup && !isControllerDriven) {
        if ("setNextKinematicTranslation" in bodyOrGroup) {
          const body = bodyOrGroup;
          const bt = body.bodyType?.() ?? 0;
          // Only write back to KINEMATIC bodies (2 or 3). Dynamic bodies
          // (0) are owned by the solver — scripts that need to teleport a
          // dynamic body should call ctx.scene.setPosition() instead, which
          // routes through the kinematic-aware teleport() helper.
          if (bt === 2 || bt === 3) {
            body.setNextKinematicTranslation({
              x: scriptEntity.position[0],
              y: scriptEntity.position[1],
              z: scriptEntity.position[2],
            });
          }
        } else {
          bodyOrGroup.position.set(...scriptEntity.position);
          bodyOrGroup.rotation.set(...scriptEntity.rotation);
        }
      }
    }

    // Apply queued teleports (scene.setPosition calls). Doing this AFTER the
    // per-entity transform write-back ensures setPosition wins over the
    // entity-position write for the same id. The frame-stamp on
    // session.pendingTeleportFrame remains until the next frame — since
    // external readers compare against `state.clock.elapsedTime`, stale
    // entries are auto-ignored once a new frame begins.
    for (const [id, pos] of pendingTeleports.current) {
      teleport(id, pos);
    }
    pendingTeleports.current.clear();

    // Reset per-frame pointer delta.
    mouseRef.consumeDelta();
  });

  const childrenByParent = useMemo(() => buildTree(sceneData.entities), [sceneData.entities]);
  const roots = childrenByParent.get(null) ?? [];

  return (
    <>
      {roots.map((entity) => (
        <RenderNode
          key={entity.id}
          entity={entity}
          childrenByParent={childrenByParent}
          selectedId={null}
          onPick={() => {}}
          bodyRefs={bodyRefs}
          playMode
        />
      ))}
    </>
  );
}

function ScenePlayMode() {
  const envGravity = useEditor((s) => s.sceneData.environment.gravity);
  // Memoise so <Physics> doesn't tear down + recreate the world (and orphan
  // every RigidBody ref) every time a parent re-renders. The `?? [...]` would
  // otherwise allocate a fresh tuple on every render → new prop reference →
  // forced remount of the entire physics tree.
  const gravity = useMemo<[number, number, number]>(
    () => (envGravity ?? DEFAULT_GRAVITY) as [number, number, number],
    [envGravity],
  );
  const bodyRefs = useRef<Map<string, RapierRigidBody | THREE.Group>>(new Map());

  return (
    <Physics gravity={gravity}>
      <ScriptedEntities bodyRefs={bodyRefs} />
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
  return (
    <>
      <ambientLight intensity={ambient} />
      <hemisphereLight args={[sky, ground, ambient * 0.85]} />
      <directionalLight
        position={[10, 12, 8]}
        intensity={env.sunIntensity ?? 1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
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
function FocusCameraController() {
  const focusToken = useEditor((s) => s.focusToken);
  const { camera, controls, scene, size } = useThree();

  // Active tween bookkeeping. Null means "no tween in flight"; useFrame
  // bails immediately. The effect populates this when focusToken bumps.
  const tweenRef = useRef<{
    startTime: number;
    duration: number;
    startCam: THREE.Vector3;
    startTarget: THREE.Vector3;
    endCam: THREE.Vector3;
    endTarget: THREE.Vector3;
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

    tweenRef.current = {
      startTime: performance.now(),
      duration: 250,
      startCam: camera.position.clone(),
      startTarget: curTarget,
      endCam: new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2]),
      endTarget: new THREE.Vector3(pose.target[0], pose.target[1], pose.target[2]),
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
    if (c?.target) c.target.lerpVectors(t.startTarget, t.endTarget, e);
    c?.update?.();
    if (k >= 1) tweenRef.current = null;
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
          className="relative w-full h-full bg-background grid-pattern overflow-hidden"
          // Capture phase: runs BEFORE r3f's bubble-phase raycast on the
          // <canvas>. Resets the hover snapshot so a right-click on empty
          // space (no intersection → no per-entity handler fires) opens
          // the empty-space menu instead of acting on the previous hit.
          onContextMenuCapture={() => {
            lastContextEntityIdRef.current = null;
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
            <Canvas
              shadows
              camera={{ position: [8, 8, 12], fov: 45 }}
              onPointerMissed={
                isPlaying
                  ? undefined
                  : () => {
                      if (isGizmoSwallowingClick()) return;
                      selectEntity(null);
                    }
              }
              gl={{
                antialias: false,
                powerPreference: "high-performance",
                toneMapping: THREE.NoToneMapping,
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
                  />
                )}
              </Suspense>
              <NavmeshDebugOverlay />
              <EffectsRig highQuality={renderQuality === "high"} />
              {showStats && <Stats className="!left-auto !right-3 !top-3" />}
              {!isPlaying && (
                <>
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
                    position={[0, -0.001, 0]}
                  />
                  <OrbitControls makeDefault />
                  <FocusCameraController />
                </>
              )}
              <ClickToDeselect />
            </Canvas>
          </ViewportErrorBoundary>

          <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-card/80 backdrop-blur border border-card-border text-xs font-mono text-muted-foreground pointer-events-none">
            <span className={isPlaying ? "text-accent" : ""}>{hint}</span>
          </div>

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
