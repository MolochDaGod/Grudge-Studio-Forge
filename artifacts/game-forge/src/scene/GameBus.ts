/**
 * In-play-mode messaging primitives.
 *
 *   • {@link createGameBus} → a single global event bus instance owned by
 *     {@link ScriptedEntities} for the duration of one play session. Drives
 *     HUD updates (`damage`, `hit`, `kill`, `respawn`, `win`, `lose`).
 *
 *   • Entity inbox + state bag → per-entity Map of pending messages and a
 *     persistent state object. Reset whenever play mode (re)starts.
 *
 * All three live for one play session; `reset()` is called when the user
 * stops play mode so a fresh play-through starts clean.
 */

export type GameEventHandler = (payload: unknown) => void;

export interface GameBus {
  emit: (event: string, payload?: unknown) => void;
  on: (event: string, handler: GameEventHandler) => () => void;
  /** Drop all listeners (called on play-mode stop). */
  reset: () => void;
}

export function createGameBus(): GameBus {
  const listeners = new Map<string, Set<GameEventHandler>>();
  return {
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const h of set) {
        try {
          h(payload);
        } catch (err) {
          console.error("[GameBus] listener for", event, "threw:", err);
        }
      }
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    reset() {
      listeners.clear();
    },
  };
}

export interface InboxMessage {
  event: string;
  payload: unknown;
  fromId: string;
}

/** Per-entity inbox queue. ScriptedEntities flushes messages into the entity
 *  via registered {@link ScriptContext.scene.on} handlers each frame. */
export class EntityInboxes {
  private queues = new Map<string, InboxMessage[]>();
  private handlers = new Map<string, Map<string, (payload: unknown, fromId: string) => void>>();

  send(targetId: string, event: string, payload: unknown, fromId: string): void {
    let q = this.queues.get(targetId);
    if (!q) {
      q = [];
      this.queues.set(targetId, q);
    }
    q.push({ event, payload, fromId });
  }

  registerHandler(
    entityId: string,
    event: string,
    handler: (payload: unknown, fromId: string) => void,
  ): void {
    let m = this.handlers.get(entityId);
    if (!m) {
      m = new Map();
      this.handlers.set(entityId, m);
    }
    m.set(event, handler);
  }

  /** Drain pending messages for `entityId` and dispatch them to registered
   *  handlers. Messages without a handler are silently dropped (with a debug
   *  log) so receiver order doesn't matter on the first frame. */
  flush(entityId: string): void {
    const q = this.queues.get(entityId);
    if (!q || q.length === 0) return;
    const handlers = this.handlers.get(entityId);
    for (const msg of q) {
      const h = handlers?.get(msg.event);
      if (h) {
        try {
          h(msg.payload, msg.fromId);
        } catch (err) {
          console.error(`[EntityInboxes] handler for ${entityId}:${msg.event} threw:`, err);
        }
      }
    }
    q.length = 0;
  }

  reset(): void {
    this.queues.clear();
    this.handlers.clear();
  }
}

/** Per-entity persistent state bag — exposed to scripts as `ctx.state`. */
export class EntityStates {
  private states = new Map<string, Record<string, unknown>>();

  get(entityId: string): Record<string, unknown> {
    let s = this.states.get(entityId);
    if (!s) {
      s = {};
      this.states.set(entityId, s);
    }
    return s;
  }

  reset(): void {
    this.states.clear();
  }
}
