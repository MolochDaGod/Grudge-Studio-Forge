import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

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
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
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
