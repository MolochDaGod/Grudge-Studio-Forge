import { createGameBus, EntityInboxes, EntityStates, TriggerInbox, type GameBus } from "./GameBus";

/**
 * Play session — module-level singleton. The HUD lives outside the R3F canvas
 * (it's a DOM overlay), the script runtime lives inside it. Both need access
 * to the same {@link GameBus} so events emitted by scripts reach the HUD. A
 * module singleton is the simplest sharing surface — no React Context, no
 * prop-drilling across the canvas/DOM boundary.
 *
 *   • {@link getPlaySession} — returns the current session. If none exists,
 *     creates one. Idempotent.
 *   • {@link resetPlaySession} — drops the bus, inboxes, and state bags so the
 *     next play-mode start gets a fresh universe. Called by the editor when
 *     the user toggles play OFF.
 */
export interface PlaySession {
  bus: GameBus;
  inboxes: EntityInboxes;
  states: EntityStates;
  /** Per-entity trigger / overlap event registry. Wired into Rapier
   *  RigidBody intersection events by EntityRenderer; consumed by
   *  scripts via `ctx.scene.onEnterTrigger` / `onExitTrigger`. */
  triggers: TriggerInbox;
  /** Set of entity ids that should be IGNORED by external systems that
   *  normally write to their rigid body (e.g. {@link PlayCameraController}).
   *
   *  Used by `player-deathmatch` to prevent the camera controller from
   *  driving a dead player's body and from clobbering the respawn teleport
   *  on the resurrection frame. Scripts manipulate this set via
   *  `ctx.scene.freeze(id)` / `ctx.scene.unfreeze(id)`. */
  frozenBodies: Set<string>;
  /** Set of entity ids that have been switched to a free-falling
   *  ragdoll by `ctx.scene.ragdoll(id, ...)`. Once an entity is in
   *  this set the agent FSM tick stops writing `setLinvel` to its
   *  body so gravity + the impulse can run uncontested. The procedural
   *  death pose still plays on the mesh (the AnimationMixer doesn't
   *  care that physics now owns the capsule transform). Cleared by
   *  `resetPlaySession` when play mode tears down. */
  ragdolledBodies: Set<string>;
  /** Map of entity id → `state.clock.elapsedTime` at which a teleport was
   *  queued. Read by external writers (camera controller) to skip their
   *  own write when the stamp equals the CURRENT frame's elapsedTime.
   *
   *  Frame-stamping (instead of a Set cleared at end of frame) makes the
   *  teleport-vs-controller arbitration order-independent: within the same
   *  frame, every `useFrame` callback sees the same elapsedTime, so any
   *  callback that ran AFTER setPosition will see "stamp === now" and skip.
   *  Stale entries from prior frames are harmless. */
  pendingTeleportFrame: Map<string, number>;
  /** Monotonic id bumped on each reset so React subscribers can re-mount /
   *  re-subscribe cleanly. */
  epoch: number;
}

let session: PlaySession | null = null;

export function getPlaySession(): PlaySession {
  if (!session) {
    session = {
      bus: createGameBus(),
      inboxes: new EntityInboxes(),
      states: new EntityStates(),
      triggers: new TriggerInbox(),
      frozenBodies: new Set(),
      ragdolledBodies: new Set(),
      pendingTeleportFrame: new Map(),
      epoch: 0,
    };
  }
  return session;
}

export function resetPlaySession(): void {
  if (!session) return;
  session.bus.reset();
  session.inboxes.reset();
  session.states.reset();
  session.triggers.reset();
  session.frozenBodies.clear();
  session.ragdolledBodies.clear();
  session.pendingTeleportFrame.clear();
  session.epoch += 1;
}
