/**
 * Configure Monaco Editor to load from CDN instead of bundling it.
 *
 * The previous approach imported Monaco language workers via Vite's
 * `?worker` suffix (e.g. `monaco-editor/esm/vs/editor/editor.worker?worker`).
 * That forced Rollup to transform all ~1,000 Monaco ESM source files during
 * the production build, consuming several GB of RAM and causing SIGKILL on
 * Vercel's build containers.
 *
 * @monaco-editor/react already supports CDN loading via @monaco-editor/loader
 * (RequireJS / AMD). Pointing the loader at the CDN removes every Monaco
 * source file from the Rollup transform pipeline entirely — Monaco is
 * downloaded by the browser at runtime instead.  Language workers (TS, JSON,
 * CSS, HTML) ship with the CDN bundle and are loaded automatically.
 *
 * Imported for side-effects only — see `main.tsx`.
 */
import loader from "@monaco-editor/loader";

// Pin to the exact installed version so the CDN and the @monaco-editor/react
// wrapper are guaranteed to be in sync.
loader.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs",
  },
});
