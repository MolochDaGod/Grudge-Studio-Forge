import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
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
/**
 * Production deploys should NOT ship public/builtin (hundreds of MB of GLBs).
 * Those load from R2 (assets.grudge-studio.com/builtin). Strip after copy.
 */
function stripHeavyPublicAssets(): Plugin {
  return {
    name: "strip-heavy-public-assets",
    apply: "build",
    async closeBundle() {
      const { rm } = await import("node:fs/promises");
      const outDir = path.resolve(import.meta.dirname, "dist/public/builtin");
      try {
        await rm(outDir, { recursive: true, force: true });
        console.log("[build] stripped dist/public/builtin (use R2 CDN at runtime)");
      } catch {
        /* folder may not exist */
      }
    },
  };
}

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

// PORT is only used by the dev server.
// Default to a placeholder so the prod build doesn't fail if the deploy build
// context doesn't inherit `[services.env]`. Same rationale as BASE_PATH below.
const rawPort = process.env.PORT || "24426";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH is set by the platform at runtime (and by the workflow at dev
// time via artifact.toml's `[services.env]`), but the deploy build context
// doesn't always inherit it — and the artifact's `previewPath = "/"` means
// the correct fallback is just "/". Defaulting here keeps the prod build
// working even when the env var doesn't propagate, while still respecting
// an explicit override (e.g. if this artifact is ever moved to a sub-path).
const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    preloadViewportCandidate(),
    stripHeavyPublicAssets(),
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
  ],
  // Vite defaults `worker.format` to "iife", which rollup rejects whenever a
  // worker bundle ends up code-split (our `colliderBaker.worker.ts` pulls in
  // `vhacd-js` which lazy-imports its wasm loader). Switching to "es" lets
  // rollup emit a multi-chunk worker output and unblocks the prod build.
  worker: {
    format: "es",
  },
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
      /**
       * Redirect all imports of `@workspace/api-client-react` to the
       * Puter-backed data layer. This replaces the Express+PostgreSQL
       * api-server with Puter KV + FS — zero import changes needed in
       * the 20+ consuming files.
       */
      "@workspace/api-client-react": path.resolve(
        import.meta.dirname,
        "src/lib/cloud/dataLayer.ts",
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
    target: "esnext",
    minify: "esbuild",
    // Source maps double peak RSS on Vercel 8 GB builders (OOM/SIGKILL).
    sourcemap: false,
    reportCompressedSize: false,
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
      // Cap the number of files Rollup opens in parallel. The default
      // (os.cpus().length × 20) creates huge in-memory queues when bundling
      // heavy deps like Three.js on CI containers with limited RAM.
      // 1 keeps peak RSS lowest for local/CI prebuilt deploys (8–16 GB hosts).
      // NOTE: this must be at the top level of rollupOptions, NOT inside
      // output — Rollup ignores it if placed inside the output block.
      maxParallelFileOps: 1,
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
         * ⚠️  React, react-dom, scheduler, AND @radix-ui/* are intentionally
         * NOT split out — they stay in the main entry chunk. Why:
         *
         *   `vite-plugin-top-level-await` (required so Rapier's WASM
         *   streaming load works in browsers without native TLA) wraps
         *   any chunk that has a top-level `await` into a `__tla` promise
         *   that consumers must await before reading exports. Once any
         *   chunk in the graph gets a `__tla` marker, every chunk that
         *   re-exports through it inherits the asynchronous-binding
         *   behaviour. With React split into its own `vendor-react`
         *   chunk, Radix's `vendor-radix` chunk would import from it
         *   (`R as mn, b as Ri, ...`) and execute its own module body —
         *   `const ComponentX = React.forwardRef(...)` — BEFORE the
         *   `__tla_0` promise from vendor-react had resolved. The
         *   imported bindings would still be undefined, producing the
         *   classic production-only crash:
         *     "Cannot read properties of undefined (reading 'forwardRef')"
         *   thrown from a renamed import like `Ri.forwardRef(...)`.
         *
         *   Keeping React + Radix in the main entry sidesteps the issue
         *   entirely — the entry chunk is always the first thing the
         *   browser evaluates, so by the time any lazy / vendor chunk
         *   loads, React's bindings are already live. The size cost
         *   (~280 KB minified for react + react-dom + radix) is well
         *   under our chunk-size warning limit.
         *
         * `manualChunks` runs against the *resolved id* of every module
         * — including transitive deps inside `node_modules` — so we only
         * need to enumerate the package roots we DO want split out.
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
          // React + Radix deliberately fall through to the main entry
          // chunk — see the long comment above for why splitting them
          // breaks production builds when TLA is in the graph.
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
    // API proxy removed — data layer uses Puter KV+FS directly.
    // Grudge catalogs and builtin assets are fetched via direct URLs.
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
