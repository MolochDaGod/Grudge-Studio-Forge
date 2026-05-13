/**
 * Typed accessors for the `window.__agentClips` bridge between the
 * gameplay layer (FSM agents, camera controllers, deathmatch
 * behaviors) and the renderer layer (`EntityRenderer.LoadedModel`).
 *
 * Historically the value was a bare `string` clip name. PR-B
 * extends the contract: writers MAY publish a richer
 * `{ clip, velocity, angularVelocity }` envelope so the renderer
 * can blend gait weights from the rigid body's actual velocity
 * instead of crossfading between discrete clips. The bare-string
 * form is still accepted for backward compatibility with older
 * call sites (deathmatchBehaviors, custom user scripts, etc.).
 */

/** Rich envelope written by writers that have access to the rigid
 *  body. `velocity` is world-space linear velocity in m/s; the
 *  renderer projects out the Y component itself. `angularVelocity`
 *  is the yaw rate in rad/s. */
export interface AgentClipEnvelope {
  clip: string;
  velocity: [number, number, number];
  angularVelocity: number;
}

export type AgentClipEntry = string | AgentClipEnvelope;

interface BridgeWindow {
  __agentClips?: Map<string, AgentClipEntry>;
}

function bridge(): Map<string, AgentClipEntry> {
  const w = window as unknown as BridgeWindow;
  w.__agentClips ??= new Map();
  return w.__agentClips;
}

/** Read whatever the writers published for this entity. Returns the
 *  raw entry — callers normalise via {@link readClipName} /
 *  {@link readClipEnvelope}. */
export function readAgentClipEntry(entityId: string): AgentClipEntry | undefined {
  return bridge().get(entityId);
}

/** Convenience: extract just the clip name from either form. */
export function readClipName(entityId: string): string | undefined {
  const e = bridge().get(entityId);
  if (!e) return undefined;
  return typeof e === "string" ? e : e.clip;
}

/** Convenience: return the rich envelope when the writer published
 *  one, or `null` for the legacy bare-string case. */
export function readClipEnvelope(entityId: string): AgentClipEnvelope | null {
  const e = bridge().get(entityId);
  if (!e || typeof e === "string") return null;
  return e;
}

export function writeClip(entityId: string, clip: string): void {
  bridge().set(entityId, clip);
}

export function writeClipWithVelocity(
  entityId: string,
  clip: string,
  velocity: [number, number, number],
  angularVelocity: number,
): void {
  bridge().set(entityId, { clip, velocity, angularVelocity });
}

export function deleteClip(entityId: string): void {
  bridge().delete(entityId);
}

export function clipKeys(): IterableIterator<string> {
  return bridge().keys();
}
