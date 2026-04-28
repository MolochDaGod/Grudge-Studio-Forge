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
import { cloneSubtree, getDescendants, wouldCycle, reidTree } from "@/lib/hierarchy";

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
  bottomTab: "console" | "assets" | "scripts" | "prefabs";
  /** When non-null, the editor is in Prefab Edit Mode and the viewport
   *  reflects the prefab buffer instead of the scene buffer. */
  prefabSubScene: PrefabSubScene | null;

  setProject: (projectId: number | null) => void;
  loadScene: (sceneId: number, name: string, data: SceneData) => void;
  setSceneName: (name: string) => void;
  setSceneData: (data: SceneData) => void;
  markSaved: () => void;

  addEntity: (type: EntityType, name?: string, parentId?: string | null) => SceneEntity;
  addEntityRaw: (entity: SceneEntity) => SceneEntity;
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

  pushLog: (level: ConsoleLevel, text: string) => void;
  clearConsole: () => void;
  setBottomTab: (t: "console" | "assets" | "scripts" | "prefabs") => void;

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
}

const emptyScene = (): SceneData => ({
  entities: [],
  environment: { ...DEFAULT_ENV },
});

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

  setProject: (projectId) =>
    set({
      projectId,
      sceneId: null,
      sceneData: emptyScene(),
      selectedId: null,
      isDirty: false,
      prefabSubScene: null,
    }),

  loadScene: (sceneId, name, data) =>
    set({
      sceneId,
      sceneName: name,
      sceneData: {
        entities: Array.isArray(data?.entities) ? data.entities : [],
        environment: { ...DEFAULT_ENV, ...(data?.environment ?? {}) },
      },
      selectedId: null,
      isDirty: false,
      isPlaying: false,
      isPaused: false,
    }),

  setSceneName: (name) => set({ sceneName: name, isDirty: true }),
  setSceneData: (data) => set({ sceneData: data, isDirty: true }),
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

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying, isPaused: false })),
  setPlaying: (playing) => set({ isPlaying: playing, isPaused: false }),
  setPaused: (paused) => set({ isPaused: paused }),
  setTransformMode: (m) => set({ transformMode: m }),

  pushLog: (level, text) =>
    set((s) => ({
      consoleMessages: [...s.consoleMessages, { id: nanoid(6), level, text, ts: Date.now() }].slice(-200),
    })),

  clearConsole: () => set({ consoleMessages: [] }),
  setBottomTab: (t) => set({ bottomTab: t }),

  openPrefabSubScene: (prefabId, name, prefabEntities) =>
    set((s) => {
      // Don't double-stack — if already in prefab mode, close it first.
      if (s.prefabSubScene) return s;
      // Strip parentId references that point outside this prefab tree (defensive).
      const ids = new Set(prefabEntities.map((e) => e.id));
      const cleaned = prefabEntities.map((e) => ({
        ...e,
        parentId: e.parentId && ids.has(e.parentId) ? e.parentId : null,
      }));
      return {
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
      };
    }),

  closePrefabSubScene: () =>
    set((s) => {
      if (!s.prefabSubScene) return s;
      const snap = s.prefabSubScene.parentSnapshot;
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
    }),

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
    set((s) => ({
      sceneData: { ...s.sceneData, entities: [...s.sceneData.entities, ...next] },
      selectedId: rootIds[0] ?? null,
      isDirty: true,
    }));
    return next.find((e) => e.id === rootIds[0]) ?? null;
  },
}));
