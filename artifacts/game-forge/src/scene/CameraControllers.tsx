import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import type { RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useKeyboardState } from "@/lib/keyboard";
import type { CameraMode, SceneEntity } from "@/scene/types";
import { getPlaySession } from "@/scene/playSession";

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
  const type = body.bodyType() as unknown as number;
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
  const type = body.bodyType() as unknown as number;
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
/* Editor (free-orbit) controller                                             */
/* -------------------------------------------------------------------------- */

export function EditorCameraController() {
  return <OrbitControls makeDefault />;
}

/* -------------------------------------------------------------------------- */
/* RTS controller — top-down strategy view                                    */
/*   - WASD / arrows pan along ground                                         */
/*   - Mouse near screen edge pans (when window has focus)                    */
/*   - Wheel zooms (clamped)                                                  */
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
      heightRef.current = THREE.MathUtils.clamp(heightRef.current + e.deltaY * 0.02, 6, 50);
    };
    const onMove = (e: MouseEvent) => {
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
    const onLeave = () => (edgePanRef.current = { x: 0, z: 0 });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
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
  const pitchRef = useRef(0.45);
  const distRef = useRef(8);
  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = gl.domElement;
    const sens = env.mouseSensitivity ?? 0.0025;
    const onDown = (e: MouseEvent) => {
      draggingRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => (draggingRef.current = false);
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastRef.current.x;
      const dy = e.clientY - lastRef.current.y;
      lastRef.current = { x: e.clientX, y: e.clientY };
      yawRef.current -= dx * sens;
      pitchRef.current = THREE.MathUtils.clamp(pitchRef.current + dy * sens, -0.4, 1.2);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      distRef.current = THREE.MathUtils.clamp(distRef.current + e.deltaY * 0.01, 3, 20);
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
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

    const speed = (env.playerMoveSpeed ?? 6) * (k["Shift"] ? 1.6 : 1);
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
      if (vx !== 0 || vz !== 0) {
        rotateBody(body, Math.atan2(vx, vz) + Math.PI);
      }
    }

    // Camera follows orbit. `pos` was read at frame start; for dynamic bodies
    // the next physics step will move them — the 1-frame lag is imperceptible.
    const d = distRef.current;
    const px = Math.sin(yawRef.current) * Math.cos(pitchRef.current) * d;
    const py = Math.sin(pitchRef.current) * d + 1.5;
    const pz = Math.cos(yawRef.current) * Math.cos(pitchRef.current) * d;
    camera.position.set(pos.x + px, pos.y + py, pos.z + pz);
    camera.lookAt(pos.x, pos.y + 1.2, pos.z);
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

    const speed = (env.playerMoveSpeed ?? 6) * (k["Shift"] ? 1.6 : 1);
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
      rotateBody(body, yawRef.current + Math.PI);
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
