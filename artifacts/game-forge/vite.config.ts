import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

/**
 * Wrap `@replit/vite-plugin-cartographer` so its `transform` step skips files
 * that render React Three Fiber primitives.
 *
 * Why: cartographer injects `data-component-name="<JSXName>"` props onto every
 * JSX element so the visual editor can identify components. R3F's `applyProps`
 * interprets dotted prop names as nested paths on the underlying Three.js
 * object — `data-component-name` becomes "set `component-name` on `data`" —
 * and Three.js objects have no `data` field, so it throws:
 *
 *   R3F: Cannot set "data-component-name". Ensure it is an object before
 *   setting "component-name".
 *
 * The plugin already self-bails on files that import from `@react-three/fiber`
 * or `@react-three/drei`, but it does NOT detect `@react-three/postprocessing`
 * (used by `src/scene/EffectsRig.tsx`), so its components — `EffectComposer`,
 * `Bloom`, `SSAO`, etc. — get the bad attribute and crash the editor on mount
 * AND unmount (the secondary "Cannot convert undefined or null to object" in
 * `removeChild` is the same diff being replayed).
 *
 * We exclude `src/scene/**` (everything under the 3D scene tree) and the
 * top-level `src/editor/Viewport.tsx` so cartographer can keep instrumenting
 * the rest of the app — toolbar, hierarchy, inspector — for the visual editor.
 */
/**
 * Inject `<link rel="modulepreload">` tags into the built `index.html` for
 * the lazy 3D viewport chunk and its sibling vendor chunk that Vite's own
 * auto-injection misses (`vendor-postprocessing`, which is only reachable
 * through the dynamic Viewport import).
 *
 * Vite's default behavior already preloads the vendor chunks that the
 * entry's static import graph touches (`vendor-react`, `vendor-radix`,
 * `vendor-three`, `vendor-r3f`, `vendor-rapier`). It does *not* preload:
 *   - The lazy `viewportPreload` chunk itself (the small re-export entry
 *     in `src/editor/viewportPreload.ts` that anchors the dynamic import).
 *   - `vendor-postprocessing`, whose only consumer is reached through that
 *     dynamic import.
 *
 * Without these hints the browser would not learn about those URLs until
 * the runtime `__vitePreload` helper fires after React mounts, which costs
 * one extra round-trip per chunk on a cold cache. Adding the static hints
 * here lets the browser kick off all four downloads in parallel with the
 * main entry, so by the time `requestIdleCallback` runs the prefetch in
 * `src/lib/prefetch.ts` (or the user opens a project), the chunks are
 * either already in cache or in flight.
 */
function preloadViewportCandidate(): Plugin {
  const TARGET_CHUNK_NAMES = new Set(["viewportPreload"]);
  return {
    name: "preload-viewport-candidate",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return;
        const tags = [];
        for (const [filename, chunk] of Object.entries(bundle)) {
          if (chunk.type !== "chunk") continue;
          if (!TARGET_CHUNK_NAMES.has(chunk.name)) continue;
          tags.push({
            tag: "link",
            attrs: {
              rel: "modulepreload",
              crossorigin: "",
              href: `${basePath.replace(/\/$/, "")}/${filename}`,
            },
            injectTo: "head" as const,
          });
        }
        return tags;
      },
    },
  };
}

function excludeR3FFromCartographer(plugin: Plugin): Plugin {
  const original = plugin.transform;
  if (!original || typeof original !== "object" || !("handler" in original)) {
    return plugin;
  }
  const originalHandler = original.handler;
  return {
    ...plugin,
    transform: {
      ...original,
      async handler(this: unknown, code: string, id: string, opts: unknown) {
        const norm = id.replace(/\\/g, "/");
        if (
          norm.includes("/src/scene/") ||
          norm.endsWith("/src/editor/Viewport.tsx")
        ) {
          return null;
        }
        return (
          originalHandler as (
            this: unknown,
            code: string,
            id: string,
            opts: unknown,
          ) => unknown
        ).call(this, code, id, opts);
      },
    },
  } as Plugin;
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    preloadViewportCandidate(),
    /**
     * Lets Vite resolve the `import * as wasm from "./rapier_wasm3d_bg.wasm"`
     * statement inside `@dimforge/rapier3d` natively, emitting the binary as
     * a separate, browser-cacheable asset under `dist/public/assets/`. The
     * companion `topLevelAwait` plugin wraps the resulting top-level
     * `await WebAssembly.instantiateStreaming(...)` so the output still
     * targets ES2020 (no native top-level await required in the browser).
     *
     * Together these replace the 1.5 MB base64 blob that ships inside the
     * `-compat` package — see `src/lib/rapierShim.ts` for the alias wiring.
     */
    wasm(),
    topLevelAwait(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            excludeR3FFromCartographer(
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      /**
       * Redirect every import of `@dimforge/rapier3d-compat` — including the
       * one buried inside `@react-three/rapier` — to a thin local shim that
       * re-exports the streaming `@dimforge/rapier3d` build. See
       * `src/lib/rapierShim.ts` for the rationale; this avoids forking the
       * upstream `react-three-rapier` package.
       */
      "@dimforge/rapier3d-compat": path.resolve(
        import.meta.dirname,
        "src/lib/rapierShim.ts",
      ),
    },
    dedupe: ["react", "react-dom", "three"],
  },
  optimizeDeps: {
    include: ["three"],
    /**
     * Esbuild (used by Vite's dep pre-bundler) can't natively resolve the
     * `import * as wasm from "./rapier_wasm3d_bg.wasm"` statement inside
     * `@dimforge/rapier3d`, and bails out re-exporting through the local
     * shim. Excluding the entire Rapier chain — the streaming engine, the
     * legacy `-compat` id (now aliased to the shim), and the React wrapper
     * that pulls them in — lets every request flow through Vite's own
     * plugin pipeline, where `vite-plugin-wasm` handles the binary.
     */
    exclude: [
      "@dimforge/rapier3d",
      "@dimforge/rapier3d-compat",
      "@react-three/rapier",
    ],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    /**
     * After moving Rapier off the `-compat` build (its WASM is now a
     * separate ~1.5 MB asset, not inlined), the heaviest remaining JS
     * chunk is `vendor-three` at ~1.1 MB minified. We bump Vite's 500 kB
     * default up to 1100 kB to cover three.js without flagging it on every
     * build, but keep it tight enough that any *new* multi-megabyte
     * dependency triggers the warning and forces us to reconsider before
     * shipping. (Down from the previous 2500 kB ceiling that masked the
     * Rapier blob.)
     */
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        /**
         * Split the heavy vendor libraries into their own chunks so:
         *
         *  1. The initial editor shell (toolbar / hierarchy / inspector)
         *     doesn't drag the 3D + scripting stack into its first paint.
         *  2. Each vendor lives in its own long-cacheable file — bumping
         *     a UI dependency doesn't invalidate the megabyte of `three`
         *     in the user's browser cache, and vice versa.
         *  3. The lazy Viewport / ScriptEditor chunks stay small (just
         *     the glue code) because their vendor weight is hoisted to
         *     these named chunks instead.
         *
         * `manualChunks` runs against the *resolved id* of every module
         * — including transitive deps inside `node_modules` — so we only
         * need to enumerate the package roots.
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          // Normalize Windows paths so the substring checks below work.
          const norm = id.replace(/\\/g, "/");
          if (
            norm.includes("/monaco-editor/") ||
            norm.includes("/@monaco-editor/")
          ) {
            return "vendor-monaco";
          }
          if (
            norm.includes("/@dimforge/rapier3d/") ||
            norm.includes("/@dimforge/rapier3d-compat")
          ) {
            return "vendor-rapier";
          }
          if (
            norm.includes("/@react-three/fiber") ||
            norm.includes("/@react-three/drei") ||
            norm.includes("/@react-three/rapier") ||
            norm.includes("/@react-three/postprocessing") ||
            norm.includes("/postprocessing/")
          ) {
            return "vendor-r3f";
          }
          if (
            norm.includes("/three/") ||
            norm.endsWith("/three") ||
            norm.includes("/three-stdlib/") ||
            norm.includes("/three-mesh-bvh/") ||
            norm.includes("/maath/")
          ) {
            return "vendor-three";
          }
          if (norm.includes("/@radix-ui/")) {
            return "vendor-radix";
          }
          if (
            norm.includes("/react-dom/") ||
            norm.includes("/react/") ||
            norm.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
