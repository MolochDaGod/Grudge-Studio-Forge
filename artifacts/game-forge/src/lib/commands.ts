/**
 * Command pattern for undo/redo (modeled after the three.js editor).
 *
 * A Command is a small object that knows how to `do` and `undo` an
 * atomic edit. Pushing a command onto the stack also runs it.
 *
 * Coalescing: commands of the same kind+target executed in quick
 * succession (typical for a TransformControls drag) merge into the
 * last entry on the stack so a single drag = single undo step.
 */

import type { SceneEntity, Vec3 } from "@/scene/types";

export interface Command {
  /** Stable kind discriminator (used for coalescing). */
  kind: string;
  /** Optional target id (used for coalescing). */
  target?: string;
  /** Human-readable label shown in the History panel. */
  label: string;
  /** Apply the change. Called once when pushed and again on redo. */
  do: () => void;
  /** Reverse the change. */
  undo: () => void;
  /**
   * Optional merger: if the previous command on the stack returns true here
   * AND was issued < `coalesceWindowMs` ago, the new command's `do()` is run
   * but the new command is not pushed; instead the previous entry's `undo`
   * (which already captures the original "before" state) is kept.
   */
  coalesceWith?: (previous: Command) => boolean;
}

const COALESCE_WINDOW_MS = 800;

/** Read-only snapshot of a stack entry, exposed for introspection
 *  (e.g. the AI `get_recent_history` tool, debug overlays). Does NOT
 *  expose `do/undo` closures — these are non-portable. */
export interface CommandSummary {
  kind: string;
  label: string;
  target: string | null;
  ts: number;
}

export class CommandStack {
  private undoStack: { cmd: Command; ts: number }[] = [];
  private redoStack: Command[] = [];
  private capacity: number;
  /** Listeners are notified whenever the stack changes (UI redraw). */
  private listeners = new Set<() => void>();

  constructor(capacity = 100) {
    this.capacity = capacity;
  }

  /** Push and execute a command. */
  push(cmd: Command): void {
    cmd.do();
    const now = Date.now();

    // Coalesce with the top entry?
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      top &&
      cmd.coalesceWith &&
      now - top.ts < COALESCE_WINDOW_MS &&
      cmd.coalesceWith(top.cmd)
    ) {
      // Replace the timestamp; keep the original `undo` (it captured the
      // pre-edit state). The new `do` already ran, so on redo we want the
      // *new* "do" — which means we need to update the top's `do` too.
      top.cmd.do = cmd.do;
      top.ts = now;
      this.redoStack = [];
      this.notify();
      return;
    }

    this.undoStack.push({ cmd, ts: now });
    if (this.undoStack.length > this.capacity) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.notify();
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    entry.cmd.undo();
    this.redoStack.push(entry.cmd);
    this.notify();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push({ cmd, ts: Date.now() });
    this.notify();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  peekUndoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.cmd.label ?? null;
  }
  peekRedoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  /** Return the undo entries newest-first as immutable summaries.
   *  Read-only — the do/undo closures stay encapsulated so callers
   *  can't accidentally re-fire side effects. */
  getUndoEntries(limit = Infinity): CommandSummary[] {
    const out: CommandSummary[] = [];
    const cap = Math.max(0, Math.min(limit, this.undoStack.length));
    for (let i = this.undoStack.length - 1; i >= 0 && out.length < cap; i--) {
      const e = this.undoStack[i];
      out.push({
        kind: e.cmd.kind,
        label: e.cmd.label,
        target: e.cmd.target ?? null,
        ts: e.ts,
      });
    }
    return out;
  }

  /** Return the redo entries newest-first as immutable summaries. */
  getRedoEntries(limit = Infinity): Omit<CommandSummary, "ts">[] {
    const out: Omit<CommandSummary, "ts">[] = [];
    const cap = Math.max(0, Math.min(limit, this.redoStack.length));
    for (let i = this.redoStack.length - 1; i >= 0 && out.length < cap; i--) {
      const c = this.redoStack[i];
      out.push({
        kind: c.kind,
        label: c.label,
        target: c.target ?? null,
      });
    }
    return out;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

/* ---------------------------------------------------------------------- *
 * Concrete command factories
 *
 * These are intentionally factory functions (not classes) so they capture
 * the store API by closure and stay flat. Each factory takes a minimal
 * StoreApi shape — defined here to avoid a cyclic import on the store.
 * ---------------------------------------------------------------------- */

export interface StoreLike {
  getEntities: () => SceneEntity[];
  setEntities: (next: SceneEntity[]) => void;
  selectEntity: (id: string | null) => void;
}

export function addEntityCommand(store: StoreLike, entity: SceneEntity): Command {
  return {
    kind: "addEntity",
    target: entity.id,
    label: `Add ${entity.name}`,
    do: () => {
      store.setEntities([...store.getEntities(), entity]);
      store.selectEntity(entity.id);
    },
    undo: () => {
      store.setEntities(store.getEntities().filter((e) => e.id !== entity.id));
      store.selectEntity(null);
    },
  };
}

/**
 * Add multiple entities in a single command (used when spawning a prefab
 * subtree or seeding a generated map). Undo removes the whole batch.
 */
export function addEntitiesCommand(
  store: StoreLike,
  entities: SceneEntity[],
  label: string,
  selectId?: string | null,
): Command {
  const ids = new Set(entities.map((e) => e.id));
  return {
    kind: "addEntities",
    label,
    do: () => {
      store.setEntities([...store.getEntities(), ...entities]);
      if (selectId !== undefined) store.selectEntity(selectId);
    },
    undo: () => {
      store.setEntities(store.getEntities().filter((e) => !ids.has(e.id)));
      store.selectEntity(null);
    },
  };
}

/**
 * Remove an entity AND its descendants. We capture the removed slice in
 * its original order so undo restores positions exactly.
 */
export function removeEntityCommand(
  store: StoreLike,
  rootId: string,
  descendantIds: string[],
): Command {
  const allIds = new Set<string>([rootId, ...descendantIds]);
  let removed: SceneEntity[] = [];
  let removedIndices: number[] = [];

  return {
    kind: "removeEntity",
    target: rootId,
    label: `Delete entity`,
    do: () => {
      const cur = store.getEntities();
      removed = [];
      removedIndices = [];
      cur.forEach((e, i) => {
        if (allIds.has(e.id)) {
          removed.push(e);
          removedIndices.push(i);
        }
      });
      store.setEntities(cur.filter((e) => !allIds.has(e.id)));
      store.selectEntity(null);
    },
    undo: () => {
      const next = [...store.getEntities()];
      // Reinsert at original indices in order.
      removed.forEach((e, i) => {
        const idx = Math.min(removedIndices[i], next.length);
        next.splice(idx, 0, e);
      });
      store.setEntities(next);
      store.selectEntity(rootId);
    },
  };
}

export function setTransformCommand(
  store: StoreLike,
  id: string,
  key: "position" | "rotation" | "scale",
  prev: Vec3,
  next: Vec3,
): Command {
  return {
    kind: `setTransform:${key}`,
    target: id,
    label: `Edit ${key}`,
    do: () => {
      store.setEntities(
        store.getEntities().map((e) =>
          e.id === id ? { ...e, transform: { ...e.transform, [key]: next } } : e,
        ),
      );
    },
    undo: () => {
      store.setEntities(
        store.getEntities().map((e) =>
          e.id === id ? { ...e, transform: { ...e.transform, [key]: prev } } : e,
        ),
      );
    },
    coalesceWith: (p) => p.kind === `setTransform:${key}` && p.target === id,
  };
}

export function renameEntityCommand(
  store: StoreLike,
  id: string,
  prevName: string,
  nextName: string,
): Command {
  return {
    kind: "rename",
    target: id,
    label: `Rename to ${nextName}`,
    do: () => {
      store.setEntities(
        store.getEntities().map((e) => (e.id === id ? { ...e, name: nextName } : e)),
      );
    },
    undo: () => {
      store.setEntities(
        store.getEntities().map((e) => (e.id === id ? { ...e, name: prevName } : e)),
      );
    },
    coalesceWith: (p) => p.kind === "rename" && p.target === id,
  };
}

export function setParentCommand(
  store: StoreLike,
  id: string,
  prevParent: string | null | undefined,
  nextParent: string | null,
): Command {
  return {
    kind: "setParent",
    target: id,
    label: `Reparent`,
    do: () => {
      store.setEntities(
        store.getEntities().map((e) => (e.id === id ? { ...e, parentId: nextParent } : e)),
      );
    },
    undo: () => {
      store.setEntities(
        store.getEntities().map((e) =>
          e.id === id ? { ...e, parentId: prevParent ?? null } : e,
        ),
      );
    },
  };
}

/**
 * Generic field patch — `before` and `after` are full SceneEntity snapshots
 * so this works for any inspector edit (material, physics, light, etc.).
 */
export function patchEntityCommand(
  store: StoreLike,
  id: string,
  before: SceneEntity,
  after: SceneEntity,
  label = "Edit entity",
): Command {
  return {
    kind: "patchEntity",
    target: id,
    label,
    do: () => {
      store.setEntities(store.getEntities().map((e) => (e.id === id ? after : e)));
    },
    undo: () => {
      store.setEntities(store.getEntities().map((e) => (e.id === id ? before : e)));
    },
    coalesceWith: (p) => p.kind === "patchEntity" && p.target === id,
  };
}
