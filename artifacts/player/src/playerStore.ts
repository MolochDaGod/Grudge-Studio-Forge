/**
 * Tiny `useEditor`-shaped store for the standalone player.
 *
 * The scene tree files in `@/scene/*` (EntityRenderer, CameraControllers,
 * SoftBodies, …) read from `useEditor((s) => s.sceneData)` and call
 * `useEditor((s) => s.pushLog)`. The player has no editor — there's no
 * hierarchy, no inspector, no command stack — but those selectors still
 * need to return the *current* scene so rendering works.
 *
 * We expose the minimum surface the renderer actually touches:
 *   - `sceneData`           — populated once after `./scene.json` loads.
 *   - `projectId`           — null (player has no project context).
 *   - `isPaused`            — the player can pause via `?` (debug only).
 *   - `pushLog(level, msg)` — forwards to `console`. Production-friendly
 *                             because the player has no log panel UI.
 *
 * The `setScene()` action is the only writer — `main.tsx` calls it once
 * after fetching the published scene JSON.
 *
 * NOTE: This module is wired in via a Vite alias (see `vite.config.ts`)
 * so any `import { useEditor } from "@/store/editor"` inside the
 * cross-imported game-forge sources resolves here instead of to the
 * full editor store (which would drag in the entire UI tree).
 */
import { create } from "zustand";
import type { SceneData, SceneEntity } from "@workspace/scene-schema";
import type { Script } from "@workspace/api-client-react";

// Mirror game-forge's `ConsoleLevel` so cross-imported runtime code that
// types its `pushLog` arg as ConsoleLevel ("log"|"warn"|"error"|"info")
// passes typecheck against this store. We don't need the full editor
// console UI, just a compatible signature.
type LogLevel = "log" | "info" | "warn" | "error" | "debug";

const EMPTY_SCENE: SceneData = {
  entities: [] as SceneEntity[],
  environment: {},
} as unknown as SceneData;

interface PlayerState {
  sceneData: SceneData;
  projectId: number | null;
  sceneId: number | null;
  sceneName: string;
  isPaused: boolean;
  /** Always true in the player — there is no edit mode. SoftBodies.tsx
   *  reads this to decide whether to mount the Rapier world probe.
   *  The player only renders inside `<Physics>` so this is safe. */
  isPlaying: boolean;
  /** Set true exactly once after `setScene()` runs in `main.tsx`'s
   *  bootstrap. The boot UI gates on this rather than
   *  `entities.length` so an intentionally-empty published scene
   *  doesn't hang on the "Loading scene…" spinner forever. */
  loaded: boolean;
  /** Scripts loaded from `./scripts.json` at boot. Read by `<PlayerScene>`
   *  and forwarded into `<PlayScriptRuntime scripts={…} />`. The shared
   *  runtime tolerates `undefined` (treated as "no scripts loaded yet")
   *  but the player always sets it to at least `[]` after fetch. */
  scripts: Script[];
  setScene: (data: SceneData) => void;
  setScripts: (scripts: Script[]) => void;
  setPaused: (paused: boolean) => void;
  pushLog: (
    level: LogLevel,
    text: string,
    meta?: { scriptId?: number | null; entityId?: string | null } | unknown,
  ) => void;
  /** No-op stub. The editor uses `cmdBakeNavmesh` to persist a freshly
   *  baked navmesh's asset id + blob key into the scene's environment.
   *  In the player the navmesh is already baked into the published
   *  `scene.json` (no rebaking happens at runtime), so we accept the
   *  call and discard it to keep `navmeshBake.ts` cross-buildable.
   *  Kept on the type for cross-imported `useEditor.getState()` calls. */
  cmdBakeNavmesh: (
    next: { assetId: number; blobKey?: string } | null,
  ) => void;
}

export const useEditor = create<PlayerState>((set) => ({
  sceneData: EMPTY_SCENE,
  projectId: null,
  sceneId: null,
  sceneName: "Published Scene",
  isPaused: false,
  isPlaying: true,
  scripts: [],
  loaded: false,
  setScene: (data) => set({ sceneData: data, loaded: true }),
  setScripts: (scripts) => set({ scripts }),
  setPaused: (paused) => set({ isPaused: paused }),
  cmdBakeNavmesh: () => {
    /* no-op — see PlayerState.cmdBakeNavmesh docs */
  },
  pushLog: (level, text, meta) => {
    // Forward to the browser console; published players have no log panel.
    const fn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "debug"
            ? console.debug
            : console.log;
    if (meta !== undefined) fn(`[player] ${text}`, meta);
    else fn(`[player] ${text}`);
  },
}));
