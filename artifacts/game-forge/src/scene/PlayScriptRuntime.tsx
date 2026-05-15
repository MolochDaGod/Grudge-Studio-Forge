/**
 * Reusable script + nav-agent runtime — extracted from `Viewport.tsx`'s
 * `ScriptedEntities` so both the editor (play mode) and the standalone
 * player (`artifacts/player/`) share the exact same gameplay tick.
 *
 * Differences from the original `ScriptedEntities`:
 *   - Accepts `scripts` as a prop instead of calling `useListScripts`
 *     against the API. The editor passes its react-query result
 *     through; the player passes scripts inlined into the published
 *     `scripts.json` (see `artifacts/game-forge/src/lib/puterPublish.ts`).
 *   - Pulls `projectId` defensively — null in the player, in which
 *     case server-side navmesh hydration is skipped (the bake is
 *     already inlined into the scene's environment).
 *
 * The body of the runtime — agent reconciliation, surface ticks,
 * navmesh load, script start/update, teleport queue, mouse delta — is
 * a verbatim port of the original implementation. Editing one should
 * edit the other; long-term we may want to fold the editor caller back
 * into this file once Viewport is broken up.
 */
import { useFrame, useThree } from "@react-three/fiber";
import type { RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import type { Script } from "@workspace/api-client-react";
import {
  getCompiledBehavior,
  getCompiledScript,
  groundProbe,
  makeContext,
  raycastEntities,
  reconcileAgents,
  tickAgentSurfaces,
  type Compiled,
} from "@/scene/PlayRuntime";
import { type AgentActor } from "@/scene/agentRuntime";
import {
  loadNavmesh,
  findPath as navFindPath,
  sampleNavmesh as navSampleNavmesh,
} from "@/lib/navmesh";
import { getCachedBlob, hydrateNavmeshFromServer } from "@/lib/navmeshBake";
import type { AgentHandle, ScriptEntity } from "@/scene/csTranspile";
import type { SurfaceKind } from "@workspace/scene-schema";
import { useKeyboardState } from "@/lib/keyboard";
import { useMouseState } from "@/scene/useMouseState";
import { buildTree } from "@/lib/hierarchy";
import type { SceneEntity } from "@/scene/types";
import { BUILTIN_BEHAVIORS } from "@/lib/deathmatchBehaviors";
import { getPlaySession, resetPlaySession } from "@/scene/playSession";
import { EntityRenderer } from "@/scene/EntityRenderer";

/**
 * Renders the scene tree (entities + their children) inside the play tree
 * and ticks scripts / nav-agent FSMs each frame. Mount under `<Physics>`.
 */
export function PlayScriptRuntime({
  bodyRefs,
  scripts,
}: {
  bodyRefs: React.MutableRefObject<Map<string, RapierRigidBody | THREE.Group>>;
  /** Compiled+source scripts referenced by the scene's entities. The
   *  editor sources these via react-query against `/api/projects/:id/scripts`;
   *  the standalone player inlines them into `scripts.json` at publish time. */
  scripts: Script[] | undefined;
}) {
  const sceneData = useEditor((s) => s.sceneData);
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const isPaused = useEditor((s) => s.isPaused);
  const keysRef = useKeyboardState(true);
  const { gl, scene: threeScene, camera } = useThree();
  const mouseRef = useMouseState(gl.domElement);
  const session = useMemo(() => {
    const s = getPlaySession();
    // Initialize the stats engine from the current scene's entities so
    // scripts can read ctx.stats.get(id) from their very first frame.
    s.stats.init(useEditor.getState().sceneData.entities);
    return s;
  }, []);

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
      npcLine: entity.npcLine,
      raceId: entity.raceId,
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
    // A teleport implies the entity is being relocated under script
    // control (respawn, scene-load reset, etc.) — drop any prior
    // ragdoll mark so the agent FSM can write velocities again. If
    // the entity is still meant to be a corpse, the death handler
    // can re-call `ctx.scene.ragdoll(...)` after the teleport.
    session.ragdolledBodies.delete(id);
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

    // Tick timed stat modifiers (duration countdown + expiry sweep).
    session.stats.tick(delta);

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
      // Ragdolled corpses must NOT have their velocity overwritten —
      // gravity + the death-impulse run uncontested while the body
      // settles. The death pose still plays on the mesh.
      const isRagdolled = session.ragdolledBodies.has(id);
      if (isRagdolled) {
        // skip — ragdoll owns this body now.
      } else if (bg && "setLinvel" in bg) {
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
    // Switch a body into a free-falling ragdoll. We force Dynamic
    // (RigidBodyType=0) so kinematic / fixed bodies start responding
    // to gravity, unlock all rotation axes (the player rotation lock
    // would otherwise keep the corpse standing upright while it falls),
    // re-enable gravity, then apply a one-shot impulse in `direction`.
    // The id is added to `session.ragdolledBodies` so the agent FSM
    // tick below stops calling `setLinvel` on it (otherwise the FSM
    // would zero our impulse on the very next frame).
    const ragdoll = (
      id: string,
      direction: [number, number, number],
      force = 6,
    ): boolean => {
      const bodyOrGroup = bodyRefs.current.get(id);
      if (!bodyOrGroup || !("setLinvel" in bodyOrGroup)) return false;
      const body = bodyOrGroup;
      // Normalize the direction so callers can pass un-normalized
      // killer→victim vectors directly. A zero vector falls straight
      // down — still a valid ragdoll.
      const len = Math.hypot(direction[0], direction[1], direction[2]);
      const nx = len > 1e-4 ? direction[0] / len : 0;
      const ny = len > 1e-4 ? direction[1] / len : 0;
      const nz = len > 1e-4 ? direction[2] / len : 0;
      try {
        // RigidBodyType.Dynamic === 0 (stable across rapier3d versions —
        // see CameraControllers.tsx for the same enum-by-value usage).
        if (body.bodyType?.() !== 0) {
          body.setBodyType(0, true);
        }
        body.setEnabledRotations(true, true, true, true);
        body.setGravityScale(1, true);
        // Mass-aware impulse: scale by the body's mass so heavier
        // characters don't fly. Falls back to `force` directly when
        // mass is unavailable (Rapier returns 0 for fixed bodies).
        const m = body.mass?.() ?? 1;
        const k = force * Math.max(m, 0.5);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        body.applyImpulse({ x: nx * k, y: ny * k, z: nz * k }, true);
      } catch {
        // RigidBody types vary slightly across react-three-rapier
        // versions; if any setter is missing we still mark the body
        // as ragdolled so the FSM writes stop and the death pose plays.
      }
      session.ragdolledBodies.add(id);
      return true;
    };
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
        ragdoll,
        parentOf,
        childrenOf,
        descendantsOf,
        findChildren,
        worldPosition,
        agentFor,
        navFindPath: navFindPathFn,
        navSample: navSampleFn,
        statsEngine: session.stats,
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
        <PlayRenderNode
          key={entity.id}
          entity={entity}
          childrenByParent={childrenByParent}
          bodyRefs={bodyRefs}
        />
      ))}
    </>
  );
}

/**
 * Recursive renderer for the play tree. Mirrors `RenderNode` from Viewport
 * but with no edit-mode props (selection, context menu, hover) — the
 * runtime never paints highlights, just geometry + physics.
 */
function PlayRenderNode({
  entity,
  childrenByParent,
  bodyRefs,
}: {
  entity: SceneEntity;
  childrenByParent: Map<string | null, SceneEntity[]>;
  bodyRefs: React.MutableRefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const kids = childrenByParent.get(entity.id) ?? [];
  return (
    <EntityRenderer
      entity={entity}
      playMode
      ref={(node) => {
        if (!node) {
          bodyRefs.current.delete(entity.id);
        } else {
          bodyRefs.current.set(entity.id, node as RapierRigidBody | THREE.Group);
        }
      }}
    >
      {kids.map((child) => (
        <PlayRenderNode
          key={child.id}
          entity={child}
          childrenByParent={childrenByParent}
          bodyRefs={bodyRefs}
        />
      ))}
    </EntityRenderer>
  );
}
