import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Standalone player build.
 *
 * Produces a single self-contained `dist/index.html` (JS + CSS inlined) that:
 *   - Fetches `./scene.json` on load.
 *   - Renders the scene with the same `EntityRenderer` + `Physics` + camera
 *     stack the editor uses, but without any editor chrome.
 *
 * The player imports source files from `../game-forge/src/...` via the `@`
 * alias, and stubs out the editor store with a tiny `useEditor`-shaped
 * zustand instance (`./src/playerStore.ts`) so scene-tree files like
 * `EntityRenderer`, `CameraControllers`, and `SoftBodies` resolve their
 * `useEditor((s) => s.sceneData...)` selectors against the loaded scene.
 *
 * Build output is consumed by `artifacts/game-forge/src/lib/puterPublish.ts`,
 * which uploads the single HTML to `Grudge/published/<slug>/index.html`
 * alongside the user's `scene.json`. See `copy-to-editor.mjs` for the
 * post-build step that drops the file into game-forge's `public/` so the
 * deployed editor serves it at `/player.html`.
 */

const GAME_FORGE_SRC = path.resolve(import.meta.dirname, "..", "game-forge", "src");

const rawPort = process.env.PORT ?? "5180";
const port = Number(rawPort);
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  resolve: {
    alias: [
      // Stub the editor store BEFORE the broad `@` alias so the prefix
      // match doesn't win. Vite tries aliases top-to-bottom.
      {
        find: /^@\/store\/editor$/,
        replacement: path.resolve(import.meta.dirname, "src/playerStore.ts"),
      },
      // Editor-only modules the scene tree drags in transitively. They are
      // not used at play time (no UI / hotkeys / launch-queue), so we map
      // them to a shared empty stub to keep the bundle slim.
      {
        find: /^@\/lib\/launchQueue$/,
        replacement: path.resolve(import.meta.dirname, "src/stubs/launchQueue.ts"),
      },
      // The shared editor `@` alias points at game-forge's src. All scene
      // files (EntityRenderer, PlayRuntime, agentRuntime, …) live there.
      { find: /^@\//, replacement: GAME_FORGE_SRC + "/" },
      // Race portrait PNGs imported by `lib/races.ts` (which PlayRuntime
      // pulls in for per-race stats since Task #107). These icons are
      // editor-only UI but `races.ts` imports them eagerly at module load,
      // so Rollup needs to resolve them. Mirrors game-forge's `@assets`
      // alias — points at the same `attached_assets/` directory at the
      // monorepo root. The resulting ~60KB of PNG bytes get inlined into
      // the single-file player bundle (assetsInlineLimit is 100MB).
      {
        find: /^@assets\//,
        replacement:
          path.resolve(import.meta.dirname, "..", "..", "attached_assets") + "/",
      },
      // Same Rapier shim the editor uses — keeps `@react-three/rapier`'s
      // transitive `@dimforge/rapier3d-compat` import flowing through the
      // streaming WASM build instead of the inlined-base64 -compat one.
      {
        find: "@dimforge/rapier3d-compat",
        replacement: path.resolve(GAME_FORGE_SRC, "lib/rapierShim.ts"),
      },
    ],
    dedupe: ["react", "react-dom", "three"],
  },
  optimizeDeps: {
    include: ["three"],
    exclude: [
      "@dimforge/rapier3d",
      "@dimforge/rapier3d-compat",
      "@react-three/rapier",
    ],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    // Single-file mode requires inline assets and one chunk.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  // The cross-imported `colliderBaker.ts` spawns a Worker with
  // `new Worker(..., { type: "module" })`. The default IIFE worker
  // format is incompatible with `inlineDynamicImports`, so force ESM
  // workers and inline them. The resulting bundle is one HTML file.
  worker: {
    format: "es",
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
