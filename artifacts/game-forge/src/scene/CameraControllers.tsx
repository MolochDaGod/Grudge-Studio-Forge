import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import type { RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useKeyboardState } from "@/lib/keyboard";
import type { CameraMode, SceneEntity } from "@/scene/types";
import { getPlaySession } from "@/scene/playSession";
import { getRaceStats } from "@/scene/PlayRuntime";
import { getRaceClips } from "@/lib/builtinModels";

/** Publish the desired animation clip name for an entity into the same
 *  `window.__agentClips` map the FSM agent bridge writes to (see
 *  `PlayScriptRuntime.tsx`). `EntityRenderer.LoadedModel` reads this
 *  each frame in `pickClipName` and crossfades over 0.2s. Writing a
 *  clip name that doesn't exist in the GLB is a safe no-op (drei's
 *  `useAnimations` simply finds no matching action and the heuristic
 *  fallback runs). */
function writeAgentClip(entityId: string, clip: string | undefined): void {
  if (!clip) return;
  const w = window as unknown as { __agentClips?: Map<string, string> };
  w.__agentClips ??= new Map();
  w.__agentClips.set(entityId, clip);
}

/**
 * Returns true when an external system (the deathmatch script runtime) has
 * asked the camera controller to LEAVE the body alone for the current frame.
 *
 * Two reasons:
 *   1. {@link PlaySession.frozenBodies} — the script has explicitly frozen
 *      the body (e.g. dead player).
 *   2. {@link PlaySession.pendingTeleportFrame} — the script queued a
 *      teleport on THIS frame. Comparing the stamp to the caller's
 *      `state.clock.elapsedTime` makes the arbitration ORDER-INDEPENDENT:
 *      no matter whether ScriptedEntities or the camera controller runs
 *      first within the same frame, the stamp matches "now" once
 *      setPosition has been called for that id, and is "stale" otherwise.
 *
 * INVARIANT: never call `state.clock.getDelta()` or `state.clock.start/stop`
 * inside a useFrame callback — R3F advances the clock once per frame and
 * dispatches subscribers; mutating it mid-tick would break the equality
 * check above. Use the `delta` arg from useFrame's signature instead.
 */
function isExternallyOwned(entityId: string, elapsedTime: number): boolean {
  const s = getPlaySession();
  if (s.frozenBodies.has(entityId)) return true;
  const stamp = s.pendingTeleportFrame.get(entityId);
  return stamp !== undefined && stamp === elapsedTime;
}

const UP = new THREE.Vector3(0, 1, 0);

function findPlayer(entities: SceneEntity[], targetId: string | null | undefined): SceneEntity | undefined {
  if (targetId) {
    const byId = entities.find((e) => e.id === targetId);
    if (byId) return byId;
  }
  return entities.find((e) => e.controllerKind && e.controllerKind !== "none");
}

function isRapierBody(b: RapierRigidBody | THREE.Group | undefined): b is RapierRigidBody {
  return !!b && "translation" in b && typeof (b as RapierRigidBody).translation === "function";
}

// Rapier RigidBodyType enum values (stable across rapier3d versions).
// Dynamic = 0, Fixed = 1, KinematicPositionBased = 2, KinematicVelocityBased = 3.
const RB_DYNAMIC = 0;
const RB_FIXED = 1;
const RB_KIN_POS = 2;
const RB_KIN_VEL = 3;

/**
 * Drive a body horizontally at the desired velocity (m/s). `delta` is the
 * frame's elapsed time in seconds.
 *
 * The previous implementation called BOTH setNextKinematicTranslation AND
 * setTranslation every frame which:
 *   • teleported dynamic bodies through walls (bypassed collision response,
 *     overwrote velocity / gravity), and
 *   • clobbered kinematicPosition's queued move with an immediate teleport,
 *     defeating Rapier's character-controller-style collision sweep and
 *     causing visible jitter / clipping.
 *
 * Branching on `body.bodyType()` lets us pick the correct API per body type
 * so the controller never fights the physics solver.
 */
function moveBody(
  body: RapierRigidBody | THREE.Group | undefined,
  desiredVel: { x: number; z: number },
  delta: number,
) {
  if (!body) return;
  if (!isRapierBody(body)) {
    body.position.x += desiredVel.x * delta;
    body.position.z += desiredVel.z * delta;
    return;
  }
  // bodyType() already returns Rapier's numeric RigidBodyType enum (a number
  // at runtime); compare directly against the numeric constant.
  const type: number = body.bodyType();
  if (type === RB_KIN_POS) {
    const cur = body.translation();
    const target = {
      x: cur.x + desiredVel.x * delta,
      y: cur.y,
      z: cur.z + desiredVel.z * delta,
    };
    // Prefer the queued kinematic helper. If the runtime is missing it (API
    // drift / older Rapier build), fall back to a hard set so movement still
    // happens — a one-frame teleport is much better than the body freezing.
    if (typeof body.setNextKinematicTranslation === "function") {
      body.setNextKinematicTranslation(target);
    } else {
      body.setTranslation(target, true);
    }
  } else if (type === RB_DYNAMIC || type === RB_KIN_VEL) {
    // Preserve vertical velocity so gravity & jumps still work.
    const v = body.linvel();
    body.setLinvel({ x: desiredVel.x, y: v.y, z: desiredVel.z }, true);
  } else if (type !== RB_FIXED) {
    // Unknown body type (future Rapier additions, custom builds). Defensive
    // fallback so the controller still drives the entity instead of silently
    // doing nothing.
    const cur = body.translation();
    body.setTranslation(
      {
        x: cur.x + desiredVel.x * delta,
        y: cur.y,
        z: cur.z + desiredVel.z * delta,
      },
      true,
    );
  }
  // Fixed bodies never move; intentional no-op.
}

function readBody(body: RapierRigidBody | THREE.Group | undefined): THREE.Vector3 | null {
  if (!body) return null;
  if (isRapierBody(body)) {
    const t = body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }
  return new THREE.Vector3(body.position.x, body.position.y, body.position.z);
}

/**
 * Yaw-only rotation. Other axes are expected to be rotation-locked at the
 * RigidBody level (see EntityRenderer's enabledRotations) so the player never
 * tips over from a sideways collision impulse.
 */
function rotateBody(
  body: RapierRigidBody | THREE.Group | undefined,
  yaw: number,
) {
  if (!body) return;
  if (!isRapierBody(body)) {
    body.rotation.y = yaw;
    return;
  }
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const r = { x: q.x, y: q.y, z: q.z, w: q.w };
  // bodyType() already returns Rapier's numeric RigidBodyType enum.
  const type: number = body.bodyType();
  if (type === RB_KIN_POS) {
    if (typeof body.setNextKinematicRotation === "function") {
      body.setNextKinematicRotation(r);
    } else {
      body.setRotation(r, true);
    }
  } else if (type === RB_DYNAMIC || type === RB_KIN_VEL) {
    body.setRotation(r, true);
    if (type === RB_DYNAMIC) body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  } else if (type !== RB_FIXED) {
    body.setRotation(r, true);
  }
}

/* -------------------------------------------------------------------------- */
/* Editor (free-orbit) controller — Unity Scene View-ish                     */
/*   - LMB drag: orbit                                                        */
/*   - MMB drag (wheel button down): pan camera (Unity style)                 */
/*   - RMB drag: pan (same as Unity alt-pan alternative)                      */
/*   - Wheel: free zoom in/out — no practical min/max distance clamp          */
/* -------------------------------------------------------------------------- */

/** Shared mouse-button map: middle-mouse pans like Unity Scene view. */
export const EDITOR_ORBIT_MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
} as const;

/**
 * Unity-like orbit for the edit viewport.
 * Wheel dolly has effectively no distance limit (0.01 → 1e9).
 * Middle-mouse drag pans in screen space.
 */
export function EditorOrbitControls({
  makeDefault = true,
}: {
  makeDefault?: boolean;
}) {
  const controlsRef = useRef<{
    domElement?: HTMLElement;
    minDistance: number;
    maxDistance: number;
    mouseButtons: typeof EDITOR_ORBIT_MOUSE_BUTTONS;
    enableZoom: boolean;
    enablePan: boolean;
  } | null>(null);

  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    // Re-assert after mount (drei sometimes resets defaults).
    c.mouseButtons = { ...EDITOR_ORBIT_MOUSE_BUTTONS };
    c.minDistance = 0.01;
    c.maxDistance = 1e9;
    c.enableZoom = true;
    c.enablePan = true;

    // Stop browser "auto-scroll" / middle-click navigation on the canvas.
    const el = c.domElement;
    if (!el) return;
    const blockMiddle = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const blockAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("mousedown", blockMiddle);
    el.addEventListener("pointerdown", blockMiddle);
    el.addEventListener("auxclick", blockAuxClick);
    return () => {
      el.removeEventListener("mousedown", blockMiddle);
      el.removeEventListener("pointerdown", blockMiddle);
      el.removeEventListener("auxclick", blockAuxClick);
    };
  }, []);

  return (
    <OrbitControls
      ref={controlsRef as never}
      makeDefault={makeDefault}
      enableDamping
      dampingFactor={0.08}
      // Free zoom — Orbit's default maxDistance (~∞ is finite in practice)
      // and a non-zero min so we never pass through the target.
      minDistance={0.01}
      maxDistance={1_000_000_000}
      // Slightly snappier than stock for editor feel
      zoomSpeed={1.35}
      panSpeed={1.15}
      rotateSpeed={0.85}
      // Pan parallel to the screen (Unity Scene view) rather than the ground plane only
      screenSpacePanning
      // Plain dolly in/out (no zoom-to-cursor re-targeting of the pivot).
      zoomToCursor={false}
      mouseButtons={EDITOR_ORBIT_MOUSE_BUTTONS}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  );
}

export function EditorCameraController() {
  return <EditorOrbitControls makeDefault />;
}

/* -------------------------------------------------------------------------- */
/* RTS controller — top-down strategy view                                    */
/*   - WASD / arrows pan along ground                                         */
/*   - Mouse near screen edge pans (when window has focus)                    */
/*   - MMB drag: pan (Unity style)                                            */
/*   - Wheel zooms with no practical height clamp                             */
/*   - Camera angle is fixed (looks down at ~55°)                             */
/* -------------------------------------------------------------------------- */

export function RTSCameraController({
  bodyRefs,
}: {
  bodyRefs: React.RefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const { camera, gl } = useThree();
  const keysRef = useKeyboardState(true);
  const sceneData = useEditor((s) => s.sceneData);
  const focusRef = useRef(new THREE.Vector3(0, 0, 0));
  const heightRef = useRef(18);
  const edgePanRef = useRef({ x: 0, z: 0 });
  const mmbPanRef = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
  }>({ active: false, lastX: 0, lastY: 0 });

  // Initialise focus on first frame to the player (if any)
  const initRef = useRef(false);
  if (!initRef.current) {
    const p = findPlayer(sceneData.entities, sceneData.environment.cameraTargetEntityId);
    if (p) focusRef.current.set(p.transform.position[0], 0, p.transform.position[2]);
    initRef.current = true;
  }

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Exponential-ish free zoom — no hard 6–50 clamp (tiny floor only).
      const next = heightRef.current + e.deltaY * 0.025;
      heightRef.current = Math.min(5_000, Math.max(0.5, next));
    };
    const onMove = (e: MouseEvent) => {
      // MMB drag pans the focus on the ground plane
      if (mmbPanRef.current.active) {
        const dx = e.clientX - mmbPanRef.current.lastX;
        const dy = e.clientY - mmbPanRef.current.lastY;
        mmbPanRef.current.lastX = e.clientX;
        mmbPanRef.current.lastY = e.clientY;
        const scale = heightRef.current * 0.0025;
        focusRef.current.x -= dx * scale;
        focusRef.current.z -= dy * scale;
        return;
      }
      const r = el.getBoundingClientRect();
      const margin = 24;
      let x = 0;
      let z = 0;
      if (e.clientX - r.left < margin) x = -1;
      else if (r.right - e.clientX < margin) x = 1;
      if (e.clientY - r.top < margin) z = -1;
      else if (r.bottom - e.clientY < margin) z = 1;
      edgePanRef.current = { x, z };
    };
    const onLeave = () => {
      edgePanRef.current = { x: 0, z: 0 };
      mmbPanRef.current.active = false;
    };
    const onDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        mmbPanRef.current = {
          active: true,
          lastX: e.clientX,
          lastY: e.clientY,
        };
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 1) mmbPanRef.current.active = false;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("mousedown", onDown);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("pointerup", onUp);
    };
  }, [gl]);

  useFrame((_state, delta) => {
    const k = keysRef.current;
    const speed = 18 * delta;
    let dx = 0;
    let dz = 0;
    if (k["w"] || k["W"] || k["ArrowUp"]) dz -= 1;
    if (k["s"] || k["S"] || k["ArrowDown"]) dz += 1;
    if (k["a"] || k["A"] || k["ArrowLeft"]) dx -= 1;
    if (k["d"] || k["D"] || k["ArrowRight"]) dx += 1;
    dx += edgePanRef.current.x;
    dz += edgePanRef.current.z;
    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz) || 1;
      focusRef.current.x += (dx / len) * speed;
      focusRef.current.z += (dz / len) * speed;
    }

    const h = heightRef.current;
    const back = h * 0.65; // pitch ≈ 55°
    camera.position.set(focusRef.current.x, h, focusRef.current.z + back);
    camera.lookAt(focusRef.current);
    void bodyRefs;
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Third-person controller — orbit camera + WASD player movement              */
/*   - Mouse drag rotates orbit (no pointer lock; works in iframes nicely)    */
/*   - Wheel zooms in/out                                                     */
/*   - WASD moves the player along ground; player rotates to face direction   */
/* -------------------------------------------------------------------------- */

export function ThirdPersonCameraController({
  bodyRefs,
}: {
  bodyRefs: React.RefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const { camera, gl } = useThree();
  const keysRef = useKeyboardState(true);
  const sceneData = useEditor((s) => s.sceneData);
  const env = sceneData.environment;
  const yawRef = useRef(0);
  const pitchRef = useRef(0.18);
  const distRef = useRef(3.2);
  // True while the canvas owns pointer-lock — mouselook only applies then so
  // editor mode (no lock) doesn't accidentally orbit when the cursor moves.
  // The PointerLockBridge in Viewport.tsx is the canonical owner of the lock
  // request; this controller just observes and reads movementX/Y deltas.
  const lockedRef = useRef(false);

  useEffect(() => {
    const el = gl.domElement;
    const sens = env.mouseSensitivity ?? 0.0025;
    const onLockChange = () => {
      lockedRef.current = document.pointerLockElement === el;
    };
    const onMove = (e: MouseEvent) => {
      if (!lockedRef.current) return;
      // movementX/Y is the only mouse delta source that keeps producing values
      // under pointer-lock (clientX/Y stays clamped at the lock anchor). This
      // is what makes the dive-style "always centered crosshair" feel work.
      yawRef.current -= e.movementX * sens;
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current + e.movementY * sens,
        -0.4,
        1.2,
      );
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Free zoom — only a tiny near-floor so the camera never sits inside
      // the mesh; no tight 2.2–5.5 Fortnite band.
      const next = distRef.current + e.deltaY * 0.008;
      distRef.current = Math.min(200, Math.max(0.35, next));
    };
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMove);
    el.addEventListener("wheel", onWheel, { passive: false });
    onLockChange();
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl, env.mouseSensitivity]);

  useFrame((state, delta) => {
    const player = findPlayer(sceneData.entities, env.cameraTargetEntityId);
    if (!player) return;
    const body = bodyRefs.current?.get(player.id);
    const pos = readBody(body) ??
      new THREE.Vector3(...player.transform.position);

    // WASD → desired horizontal velocity (m/s), relative to camera yaw.
    const k = keysRef.current;
    let mx = 0;
    let mz = 0;
    if (k["w"] || k["W"] || k["ArrowUp"]) mz -= 1;
    if (k["s"] || k["S"] || k["ArrowDown"]) mz += 1;
    if (k["a"] || k["A"] || k["ArrowLeft"]) mx -= 1;
    if (k["d"] || k["D"] || k["ArrowRight"]) mx += 1;

    // Per-race speed override: when the player entity carries a raceId,
    // pull baseStats.speed from the RACES catalog so picking the elf
    // actually feels swift and the dwarf actually feels stout. Falls
    // back to the env-level slider when no race is set.
    const raceSpeed = getRaceStats(player.raceId)?.speed;
    const speed = (raceSpeed ?? env.playerMoveSpeed ?? 6) * (k["Shift"] ? 1.6 : 1);
    let vx = 0;
    let vz = 0;
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz) || 1;
      const fx = mx / len;
      const fz = mz / len;
      const sin = Math.sin(yawRef.current);
      const cos = Math.cos(yawRef.current);
      vx = (fx * cos + fz * sin) * speed;
      vz = (-fx * sin + fz * cos) * speed;
    }
    // Always call moveBody — when no input it sets horizontal velocity to 0
    // (preserving Y), which stops sliding on dynamic bodies cleanly.
    // EXCEPT when the body is externally owned this frame (frozen by a
    // script, or has a teleport queued THIS frame). isExternallyOwned uses
    // the frame stamp so callback order doesn't matter. The camera still
    // follows the body either way.
    if (!isExternallyOwned(player.id, state.clock.elapsedTime)) {
      moveBody(body, { x: vx, z: vz }, delta);
      // Lock the character's facing to the camera yaw. The character GLB
      // points down -Z at rest (matching three.js' "forward = -Z"
      // convention) and our forward vector at yaw=0 is (sin0, cos0) =
      // (0, +1). So feeding `yaw` directly aligns the model with the
      // direction the camera is looking. Asset packs that authored their
      // characters facing +Z (toon-rts) get a per-model `yawOffset`
      // applied inside EntityRenderer.LoadedModel — physics yaw stays
      // canonical here.
      rotateBody(body, yawRef.current);
    }

    // Per-race locomotion clip: write idle / walk / run into the
    // __agentClips bridge so LoadedModel crossfades to the matching clip
    // name. We skip the write entirely when the player has no raceId
    // (legacy `builtin:character`) so the existing idle/loop heuristic
    // continues to pick the first available clip in the GLB.
    const clips = getRaceClips(player.raceId);
    if (clips) {
      const isMoving = mx !== 0 || mz !== 0;
      const isRunning = isMoving && !!k["Shift"];
      writeAgentClip(player.id, isRunning ? clips.run : isMoving ? clips.walk : clips.idle);
    }

    // Fortnite-style over-the-shoulder camera.
    //
    // Geometry, in player-local frame:
    //   forward = where the player is facing (== camera yaw)
    //   right   = perpendicular, to the player's right
    //   up      = world Y
    //
    // The "boom" (camera pivot) sits at the player's shoulder height,
    // offset SIDEWAYS along `right` by SHOULDER_OFFSET. The camera then
    // sits BEHIND that pivot along -forward by `dist`, with the lookAt
    // target placed AHEAD along +forward at the same shoulder line.
    // Crucially, lookAt uses the SAME right-shoulder offset — that's
    // what keeps the character pinned to the LEFT third of the screen
    // and the aim reticle on the RIGHT third (the over-the-shoulder
    // feel). If we instead looked at the body centre, the character
    // would slide back to the middle and we'd be back to a generic
    // orbit cam.
    //
    // Sign convention (CRITICAL — earlier versions had this inverted
    // and the camera ended up IN FRONT of the player making "eye
    // contact" with them): three.js' default forward is -Z, and
    // `rotateBody(body, yawRef)` above leaves the player's facing as
    // -Z at yaw=0. So the player's actual world-space forward vector
    // is `(-sinY, 0, -cosY)` — the NEGATIVE of (sinY, 0, cosY). To
    // place the camera BEHIND the player we therefore ADD the
    // `(sinY*cosP, sinP, cosY*cosP)` vector to the shoulder pivot
    // (that direction is opposite to the player's facing), and aim
    // SUBTRACTS that same vector to look out in front.
    const d = distRef.current;
    const SHOULDER_OFFSET = 0.55;   // metres to the right of the spine
    const SHOULDER_HEIGHT = 1.55;   // ~head height for an average rig
    const AIM_AHEAD       = 6.0;    // how far in front the look-target sits
    const sinY = Math.sin(yawRef.current);
    const cosY = Math.cos(yawRef.current);
    const sinP = Math.sin(pitchRef.current);
    const cosP = Math.cos(pitchRef.current);

    // Vector pointing FROM the player TOWARD where the camera sits
    // (i.e. opposite of the player's facing). Player faces -Z at
    // yaw=0, so this vector is +Z at yaw=0 → camera lands behind.
    const bx = sinY * cosP;
    const by = sinP;
    const bz = cosY * cosP;
    // Right vector (player's right at yaw=0 is +X).
    const rx =  cosY;
    const rz = -sinY;

    // Pivot at the right shoulder.
    const sx = pos.x + rx * SHOULDER_OFFSET;
    const sy = pos.y + SHOULDER_HEIGHT;
    const sz = pos.z + rz * SHOULDER_OFFSET;

    // Camera sits behind the shoulder along +back (= opposite facing).
    camera.position.set(sx + bx * d, sy + by * d, sz + bz * d);

    // Aim point sits ahead of (and at) the same shoulder line — i.e.
    // along the player's actual forward direction, the negation of
    // the back vector. Character stays parked on the left third, the
    // crosshair lands on the right third.
    camera.lookAt(sx - bx * AIM_AHEAD, sy - by * AIM_AHEAD, sz - bz * AIM_AHEAD);
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* First-person controller — pointer lock mouselook + WASD                    */
/* -------------------------------------------------------------------------- */

export function FirstPersonCameraController({
  bodyRefs,
}: {
  bodyRefs: React.RefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const { camera, gl } = useThree();
  const keysRef = useKeyboardState(true);
  const sceneData = useEditor((s) => s.sceneData);
  const env = sceneData.environment;
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const lockedRef = useRef(false);

  useEffect(() => {
    const el = gl.domElement;
    const sens = env.mouseSensitivity ?? 0.0025;
    const onClick = () => {
      if (!lockedRef.current) el.requestPointerLock?.();
    };
    const onLockChange = () => {
      lockedRef.current = document.pointerLockElement === el;
    };
    const onMove = (e: MouseEvent) => {
      if (!lockedRef.current) return;
      yawRef.current -= e.movementX * sens;
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current - e.movementY * sens,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05,
      );
    };
    el.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      if (document.pointerLockElement === el) document.exitPointerLock?.();
    };
  }, [gl, env.mouseSensitivity]);

  useFrame((state, delta) => {
    const player = findPlayer(sceneData.entities, env.cameraTargetEntityId);
    if (!player) return;
    const body = bodyRefs.current?.get(player.id);
    const pos = readBody(body) ??
      new THREE.Vector3(...player.transform.position);

    const k = keysRef.current;
    let mx = 0;
    let mz = 0;
    if (k["w"] || k["W"] || k["ArrowUp"]) mz -= 1;
    if (k["s"] || k["S"] || k["ArrowDown"]) mz += 1;
    if (k["a"] || k["A"] || k["ArrowLeft"]) mx -= 1;
    if (k["d"] || k["D"] || k["ArrowRight"]) mx += 1;

    // Per-race speed override (see TPS controller above).
    const raceSpeed = getRaceStats(player.raceId)?.speed;
    const speed = (raceSpeed ?? env.playerMoveSpeed ?? 6) * (k["Shift"] ? 1.6 : 1);
    let vx = 0;
    let vz = 0;
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz) || 1;
      const fx = mx / len;
      const fz = mz / len;
      const sin = Math.sin(yawRef.current);
      const cos = Math.cos(yawRef.current);
      vx = (fx * cos + fz * sin) * speed;
      vz = (-fx * sin + fz * cos) * speed;
    }
    if (!isExternallyOwned(player.id, state.clock.elapsedTime)) {
      moveBody(body, { x: vx, z: vz }, delta);
      // FPS: same convention as the TPS path above — yaw alone aligns the
      // body's forward axis with the camera's look direction.
      rotateBody(body, yawRef.current);
    }

    // Same locomotion clip publish as the TPS controller — see comment
    // there. In FPS the player rarely sees their own body, but enemies
    // observing the player and any 3rd-party spectator camera still
    // benefit from the correct walk/run animation playing.
    const clips = getRaceClips(player.raceId);
    if (clips) {
      const isMoving = mx !== 0 || mz !== 0;
      const isRunning = isMoving && !!k["Shift"];
      writeAgentClip(player.id, isRunning ? clips.run : isMoving ? clips.walk : clips.idle);
    }

    // Camera at "head" height
    const headY = pos.y + 0.6;
    camera.position.set(pos.x, headY, pos.z);
    // Build a forward vector from yaw + pitch
    const fx = Math.sin(yawRef.current) * Math.cos(pitchRef.current);
    const fy = Math.sin(pitchRef.current);
    const fz = Math.cos(yawRef.current) * Math.cos(pitchRef.current);
    camera.lookAt(pos.x + fx, headY + fy, pos.z + fz);
  });

  // Render a passive PointerLockControls so the user gets the standard prompt
  return null;
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

export function PlayCameraController({
  bodyRefs,
}: {
  bodyRefs: React.RefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const mode: CameraMode = useEditor((s) => s.sceneData.environment.cameraMode ?? "editor");
  const entities = useEditor((s) => s.sceneData.entities);
  const targetId = useEditor((s) => s.sceneData.environment.cameraTargetEntityId);
  const pushLog = useEditor((s) => s.pushLog);
  const warnedRef = useRef(false);

  // First/third person modes need a player entity. Fall back to editor orbit
  // (with a one-shot warning) if none is configured, so play mode never goes
  // dark.
  const needsPlayer = mode === "thirdPerson" || mode === "firstPerson";
  const player = needsPlayer ? findPlayer(entities, targetId) : undefined;

  useEffect(() => {
    if (needsPlayer && !player && !warnedRef.current) {
      warnedRef.current = true;
      pushLog(
        "warn",
        `Camera mode "${mode}" needs a player entity. Falling back to orbit. ` +
          `Open the inspector → Player Controller and pick Third- or First-person on an entity.`,
      );
    }
    if (!needsPlayer || player) warnedRef.current = false;
  }, [needsPlayer, player, mode, pushLog]);

  if (mode === "rts") return <RTSCameraController bodyRefs={bodyRefs} />;
  if (mode === "thirdPerson" && player) return <ThirdPersonCameraController bodyRefs={bodyRefs} />;
  if (mode === "firstPerson" && player) return <FirstPersonCameraController bodyRefs={bodyRefs} />;
  return <EditorCameraController />;
}

// re-export for convenience so Viewport can suppress the FPS hint when pointer-lock is active
export { PointerLockControls };
