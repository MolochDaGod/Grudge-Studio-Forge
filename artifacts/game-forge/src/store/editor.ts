import { create } from "zustand";
import { nanoid } from "nanoid";
import {
  type SceneData,
  type SceneEntity,
  type EntityType,
  type Vec3,
  type ControllerKind,
  DEFAULT_ENV,
  DEFAULT_TRANSFORM,
} from "@/scene/types";
import { cloneSubtree, getDescendants, wouldCycle, reidTree, sanitizeEntities } from "@/lib/hierarchy";
import { loadGlbTopLevelNodes, type GlbChildNode } from "@/lib/glbHierarchy";
import {
  CommandStack,
  addEntityCommand,
  addEntitiesCommand,
  removeEntityCommand,
  setTransformCommand,
  renameEntityCommand,
  setParentCommand,
  type StoreLike,
} from "@/lib/commands";

export type TransformMode = "translate" | "rotate" | "scale";
export type ConsoleLevel = "log" | "warn" | "error" | "info";

export interface ConsoleMessage {
  id: string;
  level: ConsoleLevel;
  text: string;
  ts: number;
}

/** Sub-scene editing context for prefabs (Unity-style "Open Prefab" mode).
 *  When active, the main editor's sceneData has been TEMPORARILY swapped
 *  for the prefab's contents. On close we restore `parentSnapshot` so the
 *  user is dropped back into the scene exactly where they left off. */
export interface PrefabSubScene {
  prefabId: number;
  prefabName: string;
  parentSnapshot: {
    sceneId: number | null;
    sceneName: string;
    sceneData: SceneData;
    selectedId: string | null;
    isDirty: boolean;
  };
}

interface EditorState {
  projectId: number | null;
  sceneId: number | null;
  sceneName: string;
  sceneData: SceneData;
  selectedId: string | null;
  isDirty: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  transformMode: TransformMode;
  consoleMessages: ConsoleMessage[];
  bottomTab: "console" | "assets" | "scripts" | "prefabs" | "nodes";
  /** When non-null, the editor is in Prefab Edit Mode and the viewport
   *  reflects the prefab buffer instead of the scene buffer. */
  prefabSubScene: PrefabSubScene | null;

  /** Quick-access prefab slots (length 8). Each entry is a prefab id, or null
   *  for an empty slot. Spawn via the Hotbar component or hotkeys 1-8. */
  hotbar: (number | null)[];

  /** Bumped whenever the user requests "focus camera on selection" (F hotkey
   *  or context-menu). Components subscribe to this token and react when it
   *  changes — we don't store the entity id because focus on the *currently
   *  selected* entity is always what we want. */
  focusToken: number;

  /** Shared command stack for undo/redo. UI components dispatch commands
   *  through `pushCommand()`; raw store mutations remain available but are
   *  not undoable. */
  commandStack: CommandStack;

  /** Render preset — "high" turns on the full post-processing rig (SSAO,
   *  bloom, vignette, ACES tone mapping, SMAA). "perf" runs only ACES + SMAA
   *  so weak GPUs stay responsive. */
  renderQuality: "high" | "perf";
  /** Show the drei Stats overlay (FPS / ms / mem) in the corner. */
  showStats: boolean;
  setRenderQuality: (q: "high" | "perf") => void;
  setShowStats: (v: boolean) => void;

  setProject: (projectId: number | null) => void;
  loadScene: (sceneId: number, name: string, data: SceneData) => void;
  setSceneName: (name: string) => void;
  setSceneData: (data: SceneData) => void;
  markSaved: () => void;

  addEntity: (type: EntityType, name?: string, parentId?: string | null) => SceneEntity;
  addEntityRaw: (entity: SceneEntity) => SceneEntity;
  /** Walk the GLB referenced by `parentEntityId` and create a transform-only
   *  proxy child entity for each top-level named node. The parent GLB still
   *  renders the geometry — proxies are pure locators (see ModelComponent.proxy).
   *  Resolves with the number of children added (0 if the GLB has none, the
   *  parent already has proxies, or the parent isn't a model). */
  explodeGlbHierarchy: (parentEntityId: string) => Promise<number>;
  removeEntity: (id: string) => void;
  duplicateEntity: (id: string) => void;
  selectEntity: (id: string | null) => void;
  updateEntity: (id: string, updater: (e: SceneEntity) => void) => void;
  setEntityTransform: (id: string, key: "position" | "rotation" | "scale", value: Vec3) => void;
  renameEntity: (id: string, name: string) => void;
  setEntityScript: (id: string, scriptId: number | null) => void;
  setEntityController: (id: string, kind: ControllerKind) => void;
  setEntityParent: (id: string, parentId: string | null) => void;
  toggleCollapsed: (id: string) => void;

  setEnvironment: (env: Partial<SceneData["environment"]>) => void;

  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setPaused: (paused: boolean) => void;
  setTransformMode: (m: TransformMode) => void;

  /** Entities that were spawned *for* play mode (e.g. the auto-spawned
   *  player prefab from {@link spawnPlayerPrefab}). Tracked so we can
   *  sweep them again when {@link setPlaying}(false) is called — they
   *  must never be persisted to the saved scene. NOT undoable. */
  playOnlyEntityIds: string[];
  /** Spawn a prefab's entities into the live scene tagged as play-only,
   *  positioning the spawn root at the first `behavior:"spawnpoint"`
   *  entity if any, otherwise at the origin. Returns the spawned root
   *  id, or null if `entities` was empty. The mutation BYPASSES the
   *  command stack — undo must not bring play-only entities back into
   *  the persisted scene. */
  spawnPlayerPrefab: (entities: SceneEntity[], prefabId?: number | null) => string | null;
  /** Pluggable resolver the store uses on entry-into-play to find the
   *  current "default Player" prefab (the one flagged
   *  `data.isPlayerPrefab` in the project's prefab list). The Toolbar
   *  registers this — it has React-Query access to the prefab list,
   *  whereas the store does not. Returning null means "no default
   *  player; just enter play mode as-is". Centralizing the lookup here
   *  ensures BOTH the toolbar play button AND the `P` hotkey go through
   *  the same auto-spawn path. */
  playerPrefabResolver:
    | (() => { entities: SceneEntity[]; prefabId: number; name: string } | null)
    | null;
  setPlayerPrefabResolver: (
    fn:
      | (() => { entities: SceneEntity[]; prefabId: number; name: string } | null)
      | null,
  ) => void;

  pushLog: (level: ConsoleLevel, text: string) => void;
  clearConsole: () => void;
  setBottomTab: (t: "console" | "assets" | "scripts" | "prefabs" | "nodes") => void;

  // Prefab sub-scene editing — temporarily swap sceneData for a prefab's
  // entities, then restore the original scene on close.
  openPrefabSubScene: (prefabId: number, name: string, prefabEntities: SceneEntity[]) => void;
  closePrefabSubScene: () => void;
  /** Capture the current (prefab) scene's entities for saving. */
  getPrefabBufferEntities: () => SceneEntity[];

  /** Snapshot a scene-entity subtree → standalone tree of entities (re-rooted). */
  snapshotSubtree: (rootId: string) => SceneEntity[];
  /** Spawn a prefab tree into the current scene (re-ids and adds). */
  spawnPrefabEntities: (entities: SceneEntity[], prefabId?: number) => SceneEntity | null;

  // --- Hotbar / focus / undo plumbing ---
  setHotbarSlot: (index: number, prefabId: number | null) => void;
  setHotbar: (slots: (number | null)[]) => void;
  requestFocus: () => void;
  /** Replace the entire entities array (used by command undo/redo). */
  setEntities: (entities: SceneEntity[]) => void;

  // --- Command-dispatching wrappers (undoable) ---
  /** Undoable: add a primitive entity. Defaults & parenting like addEntity. */
  cmdAddEntity: (type: EntityType, name?: string, parentId?: string | null) => SceneEntity;
  /** Undoable: remove an entity (cascades to descendants). */
  cmdRemoveEntity: (id: string) => void;
  /** Undoable: duplicate the subtree rooted at id. Returns new root id. */
  cmdDuplicateEntity: (id: string) => string | null;
  /** Undoable: set a transform key. Coalesces while a TransformControls drag is in flight. */
  cmdSetEntityTransform: (id: string, key: "position" | "rotation" | "scale", value: Vec3) => void;
  /** Undoable: rename an entity. Coalesces consecutive renames of the same id. */
  cmdRenameEntity: (id: string, name: string) => void;
  /** Undoable: reparent (or unparent when parentId === null). */
  cmdSetEntityParent: (id: string, parentId: string | null) => void;
  /** Undoable: add an empty entity as a child of `parentId`. */
  cmdAddEmptyChild: (parentId: string | null) => SceneEntity;
}

const emptyScene = (): SceneData => ({
  entities: [],
  environment: { ...DEFAULT_ENV },
});

/** Module-scoped re-entry guard for `explodeGlbHierarchy`. The action loads
 *  the GLB asynchronously, and a fast double-click could otherwise pass the
 *  in-state `alreadyExposed` check twice and append duplicate proxies. */
const explodeInFlight = new Set<string>();

const defaultsByType = (type: EntityType, name: string): SceneEntity => {
  const base: SceneEntity = {
    id: nanoid(8),
    name,
    type,
    transform: DEFAULT_TRANSFORM(),
  };
  switch (type) {
    case "box":
      return {
        ...base,
        material: { color: "#d4af37", metalness: 0.1, roughness: 0.6 },
        physics: { bodyType: "dynamic", colliderType: "cuboid", mass: 1, restitution: 0.4, friction: 0.6 },
      };
    case "sphere":
      return {
        ...base,
        material: { color: "#e8dfc8", metalness: 0.2, roughness: 0.4 },
        physics: { bodyType: "dynamic", colliderType: "ball", mass: 1, restitution: 0.6, friction: 0.4 },
      };
    case "cylinder":
      return {
        ...base,
        material: { color: "#ffb84d", metalness: 0.1, roughness: 0.5 },
        physics: { bodyType: "dynamic", colliderType: "cylinder", mass: 1, restitution: 0.3, friction: 0.7 },
      };
    case "plane":
      return {
        ...base,
        transform: { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [20, 20, 1] },
        material: { color: "#222236", metalness: 0, roughness: 1 },
        physics: { bodyType: "fixed", colliderType: "cuboid", mass: 0, restitution: 0.2, friction: 1 },
      };
    case "light":
      return {
        ...base,
        transform: { position: [4, 6, 4], rotation: [0, 0, 0], scale: [1, 1, 1] },
        light: { kind: "point", color: "#ffffff", intensity: 8, distance: 30 },
      };
    case "model":
      return { ...base, model: { url: "" } };
    default:
      return base;
  }
};

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  sceneId: null,
  sceneName: "Untitled Scene",
  sceneData: emptyScene(),
  selectedId: null,
  isDirty: false,
  isPlaying: false,
  isPaused: false,
  transformMode: "translate",
  consoleMessages: [],
  bottomTab: "console",
  prefabSubScene: null,
  playOnlyEntityIds: [],
  playerPrefabResolver: null,
  hotbar: Array(8).fill(null) as (number | null)[],
  focusToken: 0,
  commandStack: new CommandStack(100),
  renderQuality: "high",
  showStats: false,
  setRenderQuality: (q) => set({ renderQuality: q }),
  setShowStats: (v) => set({ showStats: v }),

  setProject: (projectId) => {
    // Switching project must reset undo history (commands captured against the
    // previous project's entity ids would otherwise corrupt the new scene) and
    // clear the hotbar (prefab ids are project-scoped). The
    // playerPrefabResolver is also project-scoped (it closes over the
    // OLD project's prefab list); the new project's Toolbar mount will
    // re-register a fresh one, but until then auto-spawn must not fire
    // against stale data.
    get().commandStack.clear();
    set({
      projectId,
      sceneId: null,
      sceneData: emptyScene(),
      selectedId: null,
      isDirty: false,
      prefabSubScene: null,
      hotbar: Array(8).fill(null) as (number | null)[],
      playerPrefabResolver: null,
    });
  },

  loadScene: (sceneId, name, data) => {
    const raw = Array.isArray(data?.entities) ? data.entities : [];
    const { entities, warnings } = sanitizeEntities(raw);
    // New scene = new editing context; previous undo entries reference
    // entity ids that no longer exist here.
    get().commandStack.clear();
    set({
      sceneId,
      sceneName: name,
      sceneData: {
        entities,
        environment: { ...DEFAULT_ENV, ...(data?.environment ?? {}) },
      },
      selectedId: null,
      isDirty: false,
      isPlaying: false,
      isPaused: false,
    });
    for (const w of warnings) get().pushLog("warn", `Scene load: ${w}`);
  },

  setSceneName: (name) => set({ sceneName: name, isDirty: true }),
  setSceneData: (data) => {
    const { entities, warnings } = sanitizeEntities(
      Array.isArray(data?.entities) ? data.entities : [],
    );
    set({
      sceneData: { entities, environment: data?.environment ?? {} },
      isDirty: true,
    });
    for (const w of warnings) get().pushLog("warn", `Scene data: ${w}`);
  },
  markSaved: () => set({ isDirty: false }),

  addEntity: (type, name, parentId) => {
    const entity = defaultsByType(type, name ?? `${type[0].toUpperCase()}${type.slice(1)}`);
    if (parentId !== undefined) entity.parentId = parentId;
    set((s) => ({
      sceneData: { ...s.sceneData, entities: [...s.sceneData.entities, entity] },
      selectedId: entity.id,
      isDirty: true,
    }));
    return entity;
  },

  addEntityRaw: (entity) => {
    set((s) => ({
      sceneData: { ...s.sceneData, entities: [...s.sceneData.entities, entity] },
      selectedId: entity.id,
      isDirty: true,
    }));
    return entity;
  },

  explodeGlbHierarchy: async (parentEntityId) => {
    // Mutex against concurrent / double-click re-entry on the same parent.
    // The async load below means a fast second click could otherwise pass the
    // `alreadyExposed` guard a second time and append duplicate proxies.
    if (explodeInFlight.has(parentEntityId)) {
      get().pushLog("info", `Expose Children: already in progress.`);
      return 0;
    }
    explodeInFlight.add(parentEntityId);
    try {
      const state = get();
      const parent = state.sceneData.entities.find((e) => e.id === parentEntityId);
      if (!parent) {
        state.pushLog("warn", `Expose Children: entity ${parentEntityId} not found.`);
        return 0;
      }
      if (parent.type !== "model" || !parent.model?.url) {
        state.pushLog("warn", `Expose Children: "${parent.name}" has no GLB url.`);
        return 0;
      }
      if (parent.model.proxy) {
        state.pushLog("warn", `Expose Children: "${parent.name}" is itself a proxy locator.`);
        return 0;
      }
      const alreadyExposed = state.sceneData.entities.some(
        (e) => e.parentId === parent.id && e.model?.proxy,
      );
      if (alreadyExposed) {
        state.pushLog("info", `Expose Children: "${parent.name}" already exposed.`);
        return 0;
      }
      const url = parent.model.url;
      let nodes: GlbChildNode[];
      try {
        nodes = await loadGlbTopLevelNodes(url);
      } catch (err) {
        state.pushLog(
          "error",
          `Expose Children: failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return 0;
      }
      if (nodes.length === 0) {
        state.pushLog("warn", `Expose Children: "${parent.name}" has no named top-level nodes.`);
        return 0;
      }
      // Re-check after the await — the parent could have been deleted, the
      // url could have changed, or another exploder could have raced us.
      const fresh = get();
      const freshParent = fresh.sceneData.entities.find((e) => e.id === parentEntityId);
      if (!freshParent || freshParent.model?.url !== url) {
        fresh.pushLog("warn", `Expose Children: parent changed during load — aborting.`);
        return 0;
      }
      if (fresh.sceneData.entities.some((e) => e.parentId === parentEntityId && e.model?.proxy)) {
        // Another call won the race.
        return 0;
      }
      const newChildren: SceneEntity[] = nodes.map((n) => ({
        id: nanoid(8),
        name: n.name,
        type: "model",
        parentId: parentEntityId,
        transform: { position: n.position, rotation: n.rotation, scale: n.scale },
        model: { url, proxy: true, subNode: n.name },
      }));
      set((s) => ({
        sceneData: { ...s.sceneData, entities: [...s.sceneData.entities, ...newChildren] },
        isDirty: true,
      }));
      fresh.pushLog(
        "info",
        `Expose Children: added ${newChildren.length} locator${newChildren.length === 1 ? "" : "s"} under "${freshParent.name}".`,
      );
      return newChildren.length;
    } finally {
      explodeInFlight.delete(parentEntityId);
    }
  },

  removeEntity: (id) =>
    set((s) => {
      const descendants = getDescendants(s.sceneData.entities, id);
      const toRemove = new Set([id, ...descendants]);
      return {
        sceneData: {
          ...s.sceneData,
          entities: s.sceneData.entities.filter((e) => !toRemove.has(e.id)),
        },
        selectedId: toRemove.has(s.selectedId ?? "") ? null : s.selectedId,
        isDirty: true,
      };
    }),

  duplicateEntity: (id) =>
    set((s) => {
      const cloned = cloneSubtree(s.sceneData.entities, id);
      if (cloned.length === 0) return s;
      // Offset only the new root, descendants stay relative to it.
      cloned[0].transform = {
        ...cloned[0].transform,
        position: [
          cloned[0].transform.position[0] + 1,
          cloned[0].transform.position[1],
          cloned[0].transform.position[2] + 1,
        ],
      };
      cloned[0].name = `${cloned[0].name} Copy`;
      return {
        sceneData: { ...s.sceneData, entities: [...s.sceneData.entities, ...cloned] },
        selectedId: cloned[0].id,
        isDirty: true,
      };
    }),

  selectEntity: (id) => set({ selectedId: id }),

  updateEntity: (id, updater) =>
    set((s) => ({
      sceneData: {
        ...s.sceneData,
        entities: s.sceneData.entities.map((e) => {
          if (e.id !== id) return e;
          const draft: SceneEntity = JSON.parse(JSON.stringify(e));
          updater(draft);
          return draft;
        }),
      },
      isDirty: true,
    })),

  setEntityTransform: (id, key, value) =>
    set((s) => ({
      sceneData: {
        ...s.sceneData,
        entities: s.sceneData.entities.map((e) =>
          e.id === id ? { ...e, transform: { ...e.transform, [key]: value } } : e,
        ),
      },
      isDirty: true,
    })),

  renameEntity: (id, name) =>
    set((s) => ({
      sceneData: {
        ...s.sceneData,
        entities: s.sceneData.entities.map((e) => (e.id === id ? { ...e, name } : e)),
      },
      isDirty: true,
    })),

  setEntityScript: (id, scriptId) =>
    set((s) => ({
      sceneData: {
        ...s.sceneData,
        entities: s.sceneData.entities.map((e) => (e.id === id ? { ...e, scriptId } : e)),
      },
      isDirty: true,
    })),

  setEntityController: (id, kind) =>
    set((s) => {
      const next = s.sceneData.entities.map((e) => {
        if (e.id === id) {
          const updated: SceneEntity = { ...e, controllerKind: kind };
          if (kind !== "none") {
            updated.physics = {
              ...(e.physics ?? {}),
              bodyType: "kinematicPosition",
              colliderType: e.physics?.colliderType ?? "cuboid",
            };
          }
          return updated;
        }
        if (kind !== "none" && e.controllerKind && e.controllerKind !== "none") {
          return { ...e, controllerKind: "none" as ControllerKind };
        }
        return e;
      });
      const env = { ...s.sceneData.environment };
      if (kind === "none") {
        if (env.cameraTargetEntityId === id) env.cameraTargetEntityId = null;
      } else {
        env.cameraTargetEntityId = id;
      }
      return {
        sceneData: { ...s.sceneData, entities: next, environment: env },
        isDirty: true,
      };
    }),

  setEntityParent: (id, parentId) =>
    set((s) => {
      if (id === parentId) return s;
      if (wouldCycle(s.sceneData.entities, id, parentId)) {
        get().pushLog("warn", `Cannot reparent — would create a cycle.`);
        return s;
      }
      return {
        sceneData: {
          ...s.sceneData,
          entities: s.sceneData.entities.map((e) =>
            e.id === id ? { ...e, parentId: parentId ?? null } : e,
          ),
        },
        isDirty: true,
      };
    }),

  toggleCollapsed: (id) =>
    set((s) => ({
      sceneData: {
        ...s.sceneData,
        entities: s.sceneData.entities.map((e) =>
          e.id === id ? { ...e, collapsed: !e.collapsed } : e,
        ),
      },
    })),

  setEnvironment: (env) =>
    set((s) => ({
      sceneData: { ...s.sceneData, environment: { ...s.sceneData.environment, ...env } },
      isDirty: true,
    })),

  togglePlay: () => {
    const next = !get().isPlaying;
    get().setPlaying(next);
  },
  setPlaying: (playing) => {
    const s = get();
    // Stopping play: garbage-collect any entities the auto-spawn (or other
    // play-only logic) injected. The persisted scene must be exactly what
    // the user designed, so we filter out tagged ids and reset the tracker.
    if (!playing && s.playOnlyEntityIds.length > 0) {
      const drop = new Set(s.playOnlyEntityIds);
      // Also drop descendants — a play-only spawn root can have children
      // (the prefab tree was re-id'd on spawn).
      const remaining = s.sceneData.entities.filter((e) => !drop.has(e.id));
      set({
        isPlaying: false,
        isPaused: false,
        playOnlyEntityIds: [],
        sceneData: { ...s.sceneData, entities: remaining },
        selectedId: drop.has(s.selectedId ?? "") ? null : s.selectedId,
      });
      return;
    }
    // Entering play: if the scene has no controller-driven entity AND a
    // default player prefab is registered, auto-spawn it. Routing the
    // lookup through `playerPrefabResolver` (set by the Toolbar via its
    // React-Query subscription) means the toolbar play button and the
    // `P` hotkey both go through this single path — they can't drift.
    if (playing && !s.isPlaying) {
      const hasController = s.sceneData.entities.some(
        (e) => e.controllerKind && e.controllerKind !== "none",
      );
      if (!hasController && s.playerPrefabResolver) {
        const found = s.playerPrefabResolver();
        if (found && found.entities.length > 0) {
          const root = get().spawnPlayerPrefab(found.entities, found.prefabId);
          if (root) {
            get().pushLog(
              "info",
              `Auto-spawned player prefab "${found.name}".`,
            );
          }
        }
      }
    }
    set({ isPlaying: playing, isPaused: false });
  },
  setPlayerPrefabResolver: (fn) => set({ playerPrefabResolver: fn }),

  spawnPlayerPrefab: (entities, prefabId) => {
    if (!entities || entities.length === 0) return null;
    const s = get();
    const { entities: spawned, rootIds } = reidTree(entities, null);
    const rootId = rootIds[0] ?? spawned[0]?.id ?? null;
    if (!rootId) return null;
    // Find a designated spawnpoint to place the player root at, otherwise
    // fall back to origin. We only translate the spawn ROOT — children
    // already have parent-relative transforms.
    const spawnpoint = s.sceneData.entities.find(
      (e) => e.behavior === "spawnpoint",
    );
    const spawnPos: Vec3 = spawnpoint
      ? [...spawnpoint.transform.position]
      : [0, 1, 0];
    const root = spawned.find((e) => e.id === rootId);
    if (root) {
      root.transform = { ...root.transform, position: spawnPos };
    }
    if (prefabId != null) {
      for (const e of spawned) e.prefabId = prefabId;
    }
    set({
      sceneData: {
        ...s.sceneData,
        entities: [...s.sceneData.entities, ...spawned],
      },
      // Mark every spawned id (root + children) so stop-play sweeps the
      // entire subtree, not just the root.
      playOnlyEntityIds: [...s.playOnlyEntityIds, ...spawned.map((e) => e.id)],
    });
    return rootId;
  },
  setPaused: (paused) => set({ isPaused: paused }),
  setTransformMode: (m) => set({ transformMode: m }),

  pushLog: (level, text) =>
    set((s) => ({
      consoleMessages: [...s.consoleMessages, { id: nanoid(6), level, text, ts: Date.now() }].slice(-200),
    })),

  clearConsole: () => set({ consoleMessages: [] }),
  setBottomTab: (t) => set({ bottomTab: t }),

  openPrefabSubScene: (prefabId, name, prefabEntities) => {
    // Don't double-stack — if already in prefab mode, just no-op.
    if (get().prefabSubScene) return;
    // Run the same hierarchy repair we use for normal scene loads:
    // dedupe ids, re-root orphan parents, break cycles. Without this a
    // corrupted prefab payload could hide entities in the sub-scene editor.
    const { entities: cleaned, warnings } = sanitizeEntities(prefabEntities);
    // Entering the prefab sub-scene is a context switch; clear undo so
    // Ctrl+Z can't reach back into the parent scene's commands.
    get().commandStack.clear();
    set((s) => ({
      prefabSubScene: {
        prefabId,
        prefabName: name,
        parentSnapshot: {
          sceneId: s.sceneId,
          sceneName: s.sceneName,
          sceneData: s.sceneData,
          selectedId: s.selectedId,
          isDirty: s.isDirty,
        },
      },
      sceneId: null,
      sceneName: `Prefab: ${name}`,
      sceneData: { entities: cleaned, environment: { ...DEFAULT_ENV } },
      selectedId: null,
      isDirty: false,
      isPlaying: false,
      isPaused: false,
    }));
    for (const w of warnings) get().pushLog("warn", `Prefab "${name}": ${w}`);
  },

  closePrefabSubScene: () => {
    if (!get().prefabSubScene) return;
    // Leaving the sub-scene returns to the parent context; commands recorded
    // inside the sub-scene reference its (now-discarded) entity ids.
    get().commandStack.clear();
    set((s) => {
      const snap = s.prefabSubScene!.parentSnapshot;
      return {
        prefabSubScene: null,
        sceneId: snap.sceneId,
        sceneName: snap.sceneName,
        sceneData: snap.sceneData,
        selectedId: snap.selectedId,
        isDirty: snap.isDirty,
        isPlaying: false,
        isPaused: false,
      };
    });
  },

  getPrefabBufferEntities: () => get().sceneData.entities,

  snapshotSubtree: (rootId) => {
    const entities = get().sceneData.entities;
    const subtree = cloneSubtree(entities, rootId, null);
    // The subtree's new root becomes the prefab root (parentId = null).
    return subtree;
  },

  spawnPrefabEntities: (entities, prefabId) => {
    if (!entities || entities.length === 0) return null;
    const { entities: next, rootIds } = reidTree(entities, null);
    // Tag instantiated entities with the prefab id so the UI can highlight.
    if (prefabId) {
      for (const e of next) e.prefabId = prefabId;
    }
    // Push as a single undoable command so Ctrl+Z removes the entire spawned
    // subtree (matching the behavior of generated maps and addEntities).
    const store = makeStoreLike(get);
    const root = next.find((e) => e.id === rootIds[0]) ?? next[0];
    const label = `Spawn ${root.name}`;
    get().commandStack.push(
      addEntitiesCommand(store, next, label, rootIds[0] ?? null),
    );
    return next.find((e) => e.id === rootIds[0]) ?? null;
  },

  setHotbarSlot: (index, prefabId) =>
    set((s) => {
      if (index < 0 || index >= s.hotbar.length) return s;
      const next = [...s.hotbar];
      next[index] = prefabId;
      return { hotbar: next };
    }),

  setHotbar: (slots) =>
    set(() => ({
      hotbar: slots.slice(0, 8).concat(Array(Math.max(0, 8 - slots.length)).fill(null)),
    })),

  requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),

  setEntities: (entities) =>
    set((s) => ({
      sceneData: { ...s.sceneData, entities },
      isDirty: true,
    })),

  // ---- Command-dispatching wrappers ----

  cmdAddEntity: (type, name, parentId) => {
    const entity = defaultsByType(type, name ?? `${type[0].toUpperCase()}${type.slice(1)}`);
    if (parentId !== undefined && parentId !== null) entity.parentId = parentId;
    const store = makeStoreLike(get);
    get().commandStack.push(addEntityCommand(store, entity));
    set({ isDirty: true });
    return entity;
  },

  cmdRemoveEntity: (id) => {
    const entities = get().sceneData.entities;
    if (!entities.find((e) => e.id === id)) return;
    const descendants = getDescendants(entities, id);
    const store = makeStoreLike(get);
    get().commandStack.push(removeEntityCommand(store, id, descendants));
    set({ isDirty: true });
  },

  cmdDuplicateEntity: (id) => {
    const entities = get().sceneData.entities;
    const cloned = cloneSubtree(entities, id);
    if (cloned.length === 0) return null;
    cloned[0].transform = {
      ...cloned[0].transform,
      position: [
        cloned[0].transform.position[0] + 1,
        cloned[0].transform.position[1],
        cloned[0].transform.position[2] + 1,
      ],
    };
    cloned[0].name = `${cloned[0].name} Copy`;
    const newRootId = cloned[0].id;
    const store = makeStoreLike(get);
    get().commandStack.push(
      addEntitiesCommand(store, cloned, `Duplicate ${cloned[0].name}`, newRootId),
    );
    set({ isDirty: true });
    return newRootId;
  },

  cmdSetEntityTransform: (id, key, value) => {
    const entity = get().sceneData.entities.find((e) => e.id === id);
    if (!entity) return;
    const prev = [...entity.transform[key]] as Vec3;
    const store = makeStoreLike(get);
    get().commandStack.push(setTransformCommand(store, id, key, prev, value));
    set({ isDirty: true });
  },

  cmdRenameEntity: (id, name) => {
    const entity = get().sceneData.entities.find((e) => e.id === id);
    if (!entity || entity.name === name) return;
    const store = makeStoreLike(get);
    get().commandStack.push(renameEntityCommand(store, id, entity.name, name));
    set({ isDirty: true });
  },

  cmdSetEntityParent: (id, parentId) => {
    const entities = get().sceneData.entities;
    const entity = entities.find((e) => e.id === id);
    if (!entity) return;
    if (id === parentId) return;
    if (parentId !== null && wouldCycle(entities, id, parentId)) {
      get().pushLog("warn", "Cannot reparent — would create a cycle.");
      return;
    }
    const prev = entity.parentId ?? null;
    if (prev === parentId) return;
    const store = makeStoreLike(get);
    get().commandStack.push(setParentCommand(store, id, prev, parentId));
    set({ isDirty: true });
  },

  cmdAddEmptyChild: (parentId) => {
    const entity = defaultsByType("empty", "Empty");
    if (parentId !== null) entity.parentId = parentId;
    const store = makeStoreLike(get);
    get().commandStack.push(addEntityCommand(store, entity));
    set({ isDirty: true });
    return entity;
  },
}));

/** Build the StoreLike used by command factories.  We thread `get` through
 *  every call (instead of capturing once) so commands always see the latest
 *  store state — important because zustand `get` is stable but its returned
 *  values are not. */
function makeStoreLike(get: () => EditorState): StoreLike {
  return {
    getEntities: () => get().sceneData.entities,
    setEntities: (next) => get().setEntities(next),
    selectEntity: (id) => get().selectEntity(id),
  };
}
