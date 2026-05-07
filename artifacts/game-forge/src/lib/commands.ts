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

import type { SceneData, SceneEntity, Vec3 } from "@/scene/types";
import { surfaceToLayer, type SurfaceKind } from "@workspace/scene-schema";

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
  /** Optional — only used by `setEnvironmentCommand`. */
  getEnvironment?: () => SceneData["environment"];
  setEnvironmentRaw?: (env: Partial<SceneData["environment"]>) => void;
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
 * Patch one or more entities' `layer` field in a single command. Used by the
 * Inspector's Layer dropdown and the AI `set_layer` tool so layer edits land
 * on the undo stack.
 */
export function setLayersCommand(
  store: StoreLike,
  changes: { id: string; from: string | undefined; to: string | undefined }[],
  label = changes.length === 1 ? `Set layer to ${changes[0].to}` : `Set layer (${changes.length})`,
): Command {
  const byId = new Map(changes.map((c) => [c.id, c] as const));
  return {
    kind: changes.length === 1 ? `setLayer:${changes[0].id}` : "setLayers",
    target: changes.length === 1 ? changes[0].id : undefined,
    label,
    do: () => {
      store.setEntities(
        store.getEntities().map((e) => {
          const c = byId.get(e.id);
          return c ? { ...e, layer: c.to as SceneEntity["layer"] } : e;
        }),
      );
    },
    undo: () => {
      store.setEntities(
        store.getEntities().map((e) => {
          const c = byId.get(e.id);
          if (!c) return e;
          const next = { ...e } as SceneEntity;
          if (c.from === undefined) delete (next as { layer?: string }).layer;
          else next.layer = c.from as SceneEntity["layer"];
          return next;
        }),
      );
    },
    coalesceWith: (p) =>
      changes.length === 1 && p.kind === `setLayer:${changes[0].id}`,
  };
}

/**
 * Patch `Environment` keys in a single undoable step. Snapshots the previous
 * values for exactly the keys being changed so undo restores (or removes)
 * just those keys without trampling unrelated env state.
 */
export function setEnvironmentCommand(
  store: StoreLike,
  next: Partial<SceneData["environment"]>,
  label = "Edit environment",
): Command {
  const get = store.getEnvironment;
  const setRaw = store.setEnvironmentRaw;
  if (!get || !setRaw) {
    throw new Error(
      "setEnvironmentCommand requires StoreLike.getEnvironment and setEnvironmentRaw",
    );
  }
  let before: Record<string, unknown> = {};
  let beforeKeys: string[] = [];
  return {
    kind: "setEnvironment",
    label,
    do: () => {
      const cur = get();
      if (beforeKeys.length === 0) {
        beforeKeys = Object.keys(next);
        before = {};
        for (const k of beforeKeys) {
          before[k] = (cur as Record<string, unknown>)[k];
        }
      }
      setRaw(next);
    },
    undo: () => {
      const restore: Partial<SceneData["environment"]> = {};
      for (const k of beforeKeys) {
        (restore as Record<string, unknown>)[k] = before[k];
      }
      setRaw(restore);
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

/** Atomic surface tagger. Surface, physics layer, and the runtime
 *  `userData.surface` tag are kept in lockstep so spatial queries,
 *  pathfinding, and the agent state machine never disagree. The same
 *  command writes both fields on the entity and on every snapshotted
 *  child (the EntityRenderer's mount-time stamper picks the new
 *  surface up on the next render). */
export interface SurfaceChange {
  id: string;
  /** Snapshot of the prior surface (undefined when unset). */
  fromSurface?: SurfaceKind;
  /** Snapshot of the prior layer (undefined when unset). */
  fromLayer?: SceneEntity["layer"];
  /** New surface to apply (undefined clears the override so the
   *  entity falls back to inheritance / default). */
  toSurface: SurfaceKind | undefined;
}

export function setSurfacesCommand(
  store: StoreLike,
  changes: SurfaceChange[],
  label = "Set surface",
): Command {
  return {
    kind: "setSurfaces",
    label,
    do: () => {
      const map = new Map(changes.map((c) => [c.id, c]));
      store.setEntities(
        store.getEntities().map((e) => {
          const ch = map.get(e.id);
          if (!ch) return e;
          const lockstepLayer = ch.toSurface ? surfaceToLayer(ch.toSurface) : undefined;
          return {
            ...e,
            surface: ch.toSurface,
            // Lockstep: assign the matching layer when the surface
            // dictates one. Surfaces with no opinion (None / Jump /
            // Dig) leave whatever layer the user already set alone.
            layer: lockstepLayer ?? e.layer,
          };
        }),
      );
    },
    undo: () => {
      const map = new Map(changes.map((c) => [c.id, c]));
      store.setEntities(
        store.getEntities().map((e) => {
          const ch = map.get(e.id);
          if (!ch) return e;
          return { ...e, surface: ch.fromSurface, layer: ch.fromLayer };
        }),
      );
    },
  };
}

/** Atomic Material kind tagger. Mirrors {@link setLayersCommand} so
 *  Inspector, AI tools, and bulk operations all land on the undo
 *  stack as a single step. Only the `material.kind` slot is updated;
 *  any per-entity visual / physical overrides on the same
 *  MaterialComponent are preserved. */
export interface MaterialKindChange {
  id: string;
  /** Snapshot of the prior material (undefined if entity had no
   *  material at all — undo restores the absence). */
  fromMaterial?: SceneEntity["material"];
  /** New `material.kind` slot. */
  toKind: NonNullable<SceneEntity["material"]>["kind"];
  /** Optional per-entity overrides applied atomically with the kind
   *  change. Stored as a partial MaterialComponent and merged on top
   *  of the existing material. Undo restores `fromMaterial` exactly. */
  overrides?: Partial<NonNullable<SceneEntity["material"]>>;
}

export function setMaterialsCommand(
  store: StoreLike,
  changes: MaterialKindChange[],
  label = changes.length === 1
    ? `Set material to ${changes[0].toKind}`
    : `Set material (${changes.length})`,
): Command {
  const map = new Map(changes.map((c) => [c.id, c] as const));
  return {
    kind: "setMaterials",
    label,
    do: () => {
      store.setEntities(
        store.getEntities().map((e) => {
          const c = map.get(e.id);
          if (!c) return e;
          return {
            ...e,
            material: { ...(e.material ?? {}), kind: c.toKind, ...(c.overrides ?? {}) },
          };
        }),
      );
    },
    undo: () => {
      store.setEntities(
        store.getEntities().map((e) => {
          const c = map.get(e.id);
          if (!c) return e;
          // Restore the entire prior MaterialComponent snapshot — undo
          // fully removes a material that was added by this command.
          const next = { ...e } as SceneEntity;
          if (c.fromMaterial === undefined) {
            delete (next as { material?: SceneEntity["material"] }).material;
          } else {
            next.material = c.fromMaterial;
          }
          return next;
        }),
      );
    },
  };
}

/** Set / clear the per-entity nav-agent component (single id). */
export function setNavAgentCommand(
  store: StoreLike,
  id: string,
  before: SceneEntity["navAgent"],
  after: SceneEntity["navAgent"],
): Command {
  return {
    kind: "setNavAgent",
    target: id,
    label: after ? "Set nav agent" : "Remove nav agent",
    do: () => {
      store.setEntities(
        store.getEntities().map((e) => (e.id === id ? { ...e, navAgent: after } : e)),
      );
    },
    undo: () => {
      store.setEntities(
        store.getEntities().map((e) => (e.id === id ? { ...e, navAgent: before } : e)),
      );
    },
  };
}

/** Atomic batched nav-agent set/clear. Multiple ids ripple in one
 *  undo step so AI tools that re-tag squads of NPCs collapse into a
 *  single CommandStack entry (rather than N entries the user has to
 *  Ctrl-Z N times to undo). */
export interface NavAgentChange {
  id: string;
  before: SceneEntity["navAgent"];
  after: SceneEntity["navAgent"];
}

export function setNavAgentsBatchCommand(
  store: StoreLike,
  changes: NavAgentChange[],
  label = "Set nav agents",
): Command {
  return {
    kind: "setNavAgents",
    label,
    do: () => {
      const map = new Map(changes.map((c) => [c.id, c.after]));
      store.setEntities(
        store.getEntities().map((e) =>
          map.has(e.id) ? { ...e, navAgent: map.get(e.id) } : e,
        ),
      );
    },
    undo: () => {
      const map = new Map(changes.map((c) => [c.id, c.before]));
      store.setEntities(
        store.getEntities().map((e) =>
          map.has(e.id) ? { ...e, navAgent: map.get(e.id) } : e,
        ),
      );
    },
  };
}

/** Pin / clear the scene-level baked navmesh — both the numeric
 *  `navmeshAssetId` and the persisted `navmeshBlobKey` are written
 *  in lockstep so a reload can re-derive the asset id from the
 *  server key (and short-circuit re-bakes when the same blob hash
 *  comes back from the server). */
export function bakeNavmeshCommand(
  store: StoreLike,
  before: { assetId?: number; blobKey?: string },
  after: { assetId?: number; blobKey?: string },
): Command {
  if (!store.setEnvironmentRaw) {
    throw new Error("bakeNavmeshCommand requires StoreLike.setEnvironmentRaw");
  }
  const setRaw = store.setEnvironmentRaw;
  return {
    kind: "bakeNavmesh",
    label: after.assetId ? "Bake navmesh" : "Clear navmesh",
    do: () =>
      setRaw({
        navmeshAssetId: after.assetId,
        navmeshBlobKey: after.blobKey,
      }),
    undo: () =>
      setRaw({
        navmeshAssetId: before.assetId,
        navmeshBlobKey: before.blobKey,
      }),
  };
}
