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
 * entry's static import graph touches (`vendor-3d` = three+R3F, `vendor-rapier`).
 * It does *not* preload:
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
 * Those load from R2 (assets.grudge-studio.com/builtin).
 *
 * CRITICAL: Vite copies the entire `public/` tree into dist during transform —
 * ~350MB of GLBs OOM 8GB builders. Park `public/builtin` *before* copy, restore
 * after. closeBundle still strips any residual dist/public/builtin.
 * Also guarantee vercel.json SPA rewrites exist (prebuilt dist deploys).
 */
function stripHeavyPublicAssets(): Plugin {
  const packageRoot = process.cwd();
  const publicBuiltin = path.resolve(packageRoot, "public/builtin");
  const parkedBuiltin = path.resolve(packageRoot, "public/.builtin-parked-for-build");
  let parked = false;

  async function parkBuiltin() {
    const { rename, access } = await import("node:fs/promises");
    try {
      await access(publicBuiltin);
      // If a previous crash left a park folder, prefer keeping source of truth.
      try {
        await access(parkedBuiltin);
        // Already parked
        parked = true;
        return;
      } catch {
        /* ok */
      }
      await rename(publicBuiltin, parkedBuiltin);
      parked = true;
      console.log(
        "[build] parked public/builtin → public/.builtin-parked-for-build (CDN at runtime)",
      );
    } catch {
      /* no local builtin folder — fine for lean checkouts */
    }
  }

  async function restoreBuiltin() {
    if (!parked) return;
    const { rename, access } = await import("node:fs/promises");
    try {
      await access(parkedBuiltin);
      try {
        await access(publicBuiltin);
        // Target already exists — leave park in place for next build
        return;
      } catch {
        /* restore */
      }
      await rename(parkedBuiltin, publicBuiltin);
      parked = false;
      console.log("[build] restored public/builtin from park");
    } catch {
      /* ignore */
    }
  }

  return {
    name: "strip-heavy-public-assets",
    apply: "build",
    async buildStart() {
      await parkBuiltin();
    },
    async buildEnd() {
      // Restore even when transform fails mid-build (OOM / kill).
      await restoreBuiltin();
    },
    async closeBundle() {
      const { rm, writeFile, stat, copyFile, access, mkdir } = await import("node:fs/promises");
      // Prefer process.cwd() (package root under pnpm filter). import.meta.dirname
      // can point at Vite's compiled config temp dir on CI and miss dist/public.
      const publicDir = path.resolve(packageRoot, "dist/public");
      const builtinDir = path.join(publicDir, "builtin");
      try {
        await mkdir(publicDir, { recursive: true });
        await rm(builtinDir, { recursive: true, force: true });
        console.log("[build] stripped dist/public/builtin (use R2 CDN at runtime)");
      } catch {
        /* folder may not exist */
      }
      await restoreBuiltin();

      // SPA rewrites — without this, /editor 404s on Vercel static deploys.
      const vercelJson = path.join(publicDir, "vercel.json");
      const vercelSrc = path.resolve(packageRoot, "public/vercel.json");
      try {
        await access(vercelSrc);
        await copyFile(vercelSrc, vercelJson);
        console.log("[build] copied public/vercel.json → dist/public/");
      } catch {
        const fallback = {
          rewrites: [
            {
              source:
                "/((?!assets/|ui/|_framework/|favicon|logo|pwa|manifest|player\\.html|downloads\\.html|sw\\.js|opengraph|apple-touch).*)",
              destination: "/index.html",
            },
          ],
          headers: [
            {
              source: "/index.html",
              headers: [
                {
                  key: "Cache-Control",
                  value: "no-cache, no-store, must-revalidate",
                },
              ],
            },
            {
              source: "/assets/(.*)",
              headers: [
                {
                  key: "Cache-Control",
                  value: "public, max-age=31536000, immutable",
                },
              ],
            },
            {
              source: "/_framework/(.*).wasm",
              headers: [
                { key: "Content-Type", value: "application/wasm" },
                { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
              ],
            },
          ],
        };
        await mkdir(publicDir, { recursive: true });
        await writeFile(vercelJson, JSON.stringify(fallback, null, 2), "utf8");
        console.log("[build] wrote fallback dist/public/vercel.json");
      }

      // Hybrid Blazor packs — must ship with SPA or RegisterBuiltin is unavailable.
      try {
        await access(path.join(publicDir, "_framework", "blazor.boot.json"));
        console.log("[build] _framework/blazor.boot.json present (hybrid C# packs)");
      } catch {
        console.warn(
          "[build] WARNING: dist/public/_framework/blazor.boot.json missing — hybrid Blazor packs will fall back to JS",
        );
      }

      // Oversized single-file player bloats every SPA deploy — warn loudly.
      try {
        const player = path.join(publicDir, "player.html");
        const st = await stat(player);
        const mb = st.size / (1024 * 1024);
        if (mb > 2) {
          console.warn(
            `[build] player.html is ${mb.toFixed(1)} MB — consider hosting on R2 (assets…/forge/player.html) to shrink SPA deploys`,
          );
        }
      } catch {
        /* optional */
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
              // Use anonymous (not empty string) — empty crossorigin="" can
              // break modulepreload on some browsers and white-screen the SPA.
              crossorigin: "anonymous",
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
    // Force a single three + react graph (nested stats-gl three@0.170 kills Vector2).
    dedupe: [
      "react",
      "react-dom",
      "scheduler",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/rapier",
      "@react-three/postprocessing",
      "@dimforge/rapier3d",
      "@dimforge/rapier3d-compat",
    ],
  },
  optimizeDeps: {
    include: ["three", "@react-three/fiber", "@react-three/drei"],
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
     * Heaviest JS is `vendor-3d` (three + R3F + drei + postprocessing) —
     * must stay one chunk to avoid TLA circular init (see manualChunks).
     * ~2 MB minified is expected; warn only above that so new bloat still
     * surfaces. (Rapier WASM is a separate asset, not in this budget.)
     */
    chunkSizeWarningLimit: 2200,
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

          // Monaco core only — never @monaco-editor/react (keeps React out).
          if (
            norm.includes("/monaco-editor/") &&
            !norm.includes("/@monaco-editor/react")
          ) {
            return "vendor-monaco";
          }

          // ─────────────────────────────────────────────────────────────
          // Rapier WASM + @react-three/rapier — OWN chunk with TLA.
          // Must NOT be mixed into vendor-3d: that made vendor-3d import
          // vendor-rapier `__tla` while also defining three.Vector2, so
          // static{De.prototype.isVector2} ran with De in TDZ → crash.
          // One-way edge is OK: vendor-rapier → vendor-3d (three already
          // fully evaluated, no TLA in vendor-3d).
          // ─────────────────────────────────────────────────────────────
          if (
            norm.includes("/@dimforge/rapier3d/") ||
            norm.includes("/@dimforge/rapier3d-compat") ||
            norm.includes("/@react-three/rapier")
          ) {
            return "vendor-rapier";
          }

          // three + R3F + drei + post — NO Rapier, so NO top-level await.
          // Splitting three vs fiber alone still breaks under TLA cycles;
          // keep them together. Nested three (stats-gl) forced here too.
          if (
            norm.includes("/@react-three/fiber") ||
            norm.includes("/@react-three/drei") ||
            norm.includes("/@react-three/postprocessing") ||
            norm.includes("/postprocessing/") ||
            norm.includes("/three/") ||
            norm.endsWith("/three") ||
            /\/node_modules\/three\//.test(norm) ||
            norm.includes("/three-stdlib/") ||
            norm.includes("/three-mesh-bvh/") ||
            norm.includes("/maath/") ||
            norm.includes("/troika-three-text/") ||
            norm.includes("/troika-three-utils/") ||
            norm.includes("/troika-worker-utils/") ||
            norm.includes("/camera-controls/") ||
            norm.includes("/stats-gl/")
          ) {
            return "vendor-3d";
          }

          // React + Radix stay in the main entry (forwardRef / TLA note above).
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
