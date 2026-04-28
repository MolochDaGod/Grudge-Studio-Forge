import { create } from "zustand";
import { nanoid } from "nanoid";
import {
  type SceneData,
  type SceneEntity,
  type EntityType,
  type Vec3,
  DEFAULT_ENV,
  DEFAULT_TRANSFORM,
} from "@/scene/types";

export type TransformMode = "translate" | "rotate" | "scale";
export type ConsoleLevel = "log" | "warn" | "error" | "info";

export interface ConsoleMessage {
  id: string;
  level: ConsoleLevel;
  text: string;
  ts: number;
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
  bottomTab: "console" | "assets" | "scripts";

  setProject: (projectId: number | null) => void;
  loadScene: (sceneId: number, name: string, data: SceneData) => void;
  setSceneName: (name: string) => void;
  setSceneData: (data: SceneData) => void;
  markSaved: () => void;

  addEntity: (type: EntityType, name?: string) => SceneEntity;
  removeEntity: (id: string) => void;
  duplicateEntity: (id: string) => void;
  selectEntity: (id: string | null) => void;
  updateEntity: (id: string, updater: (e: SceneEntity) => void) => void;
  setEntityTransform: (id: string, key: "position" | "rotation" | "scale", value: Vec3) => void;
  renameEntity: (id: string, name: string) => void;
  setEntityScript: (id: string, scriptId: number | null) => void;

  setEnvironment: (env: Partial<SceneData["environment"]>) => void;

  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setPaused: (paused: boolean) => void;
  setTransformMode: (m: TransformMode) => void;

  pushLog: (level: ConsoleLevel, text: string) => void;
  clearConsole: () => void;
  setBottomTab: (t: "console" | "assets" | "scripts") => void;
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
        material: { color: "#9b6dff", metalness: 0.1, roughness: 0.6 },
        physics: { bodyType: "dynamic", colliderType: "cuboid", mass: 1, restitution: 0.4, friction: 0.6 },
      };
    case "sphere":
      return {
        ...base,
        material: { color: "#5af0ff", metalness: 0.2, roughness: 0.4 },
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

  setProject: (projectId) =>
    set({ projectId, sceneId: null, sceneData: emptyScene(), selectedId: null, isDirty: false }),

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

  addEntity: (type, name) => {
    const entity = defaultsByType(type, name ?? `${type[0].toUpperCase()}${type.slice(1)}`);
    set((s) => ({
      sceneData: { ...s.sceneData, entities: [...s.sceneData.entities, entity] },
      selectedId: entity.id,
      isDirty: true,
    }));
    return entity;
  },

  removeEntity: (id) =>
    set((s) => ({
      sceneData: { ...s.sceneData, entities: s.sceneData.entities.filter((e) => e.id !== id) },
      selectedId: s.selectedId === id ? null : s.selectedId,
      isDirty: true,
    })),

  duplicateEntity: (id) => {
    const e = get().sceneData.entities.find((x) => x.id === id);
    if (!e) return;
    const clone: SceneEntity = JSON.parse(JSON.stringify(e));
    clone.id = nanoid(8);
    clone.name = `${e.name} Copy`;
    clone.transform.position = [
      e.transform.position[0] + 1,
      e.transform.position[1],
      e.transform.position[2] + 1,
    ];
    set((s) => ({
      sceneData: { ...s.sceneData, entities: [...s.sceneData.entities, clone] },
      selectedId: clone.id,
      isDirty: true,
    }));
  },

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
          e.id === id
            ? { ...e, transform: { ...e.transform, [key]: value } }
            : e,
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
}));
