/**
 * Tiny "preload candidate" entry that re-exports the Viewport.
 *
 * Why this exists: `index.html` carries a `<link rel="modulepreload">` hint
 * that points at this file. Vite resolves the hint at build time, treats
 * this module as an additional entry, and walks its *static* import graph
 * to emit `<link rel="modulepreload">` tags for every chunk reachable from
 * it — which means the heavy `Viewport.tsx` module and its transitive
 * vendor chunk (`vendor-3d` = three + R3F + drei + postprocessing + Rapier)
 * gets preload hints in the generated HTML.
 *
 * The browser begins fetching those chunks in parallel with the main
 * `index.js` entry, instead of waiting for the runtime `__vitePreload`
 * helper to fire after React mounts. Combined with the idle-time
 * `prefetchViewport()` call in `main.tsx`, the lazy `<Viewport />` import
 * in `App.tsx` almost always resolves from cache and the
 * "Loading 3D viewport…" Suspense fallback is invisible.
 *
 * NOTE: This module is intentionally tiny. It must NOT add any side
 * effects — only the re-export — because the modulepreload link will
 * cause the browser to *download and parse* it on every page load. The
 * actual `<Viewport />` component is still rendered lazily through
 * `React.lazy()` so the parse work is only paid when the editor decides
 * to mount the 3D scene.
 */
export { Viewport } from "./Viewport";
