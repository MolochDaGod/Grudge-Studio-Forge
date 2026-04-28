/**
 * Background prefetch helpers for the heavy 3D viewport bundle.
 *
 * The editor shell (Toolbar, Hierarchy, Inspector, ProjectPicker) paints
 * almost immediately, but the Viewport sub-tree drags in the four heaviest
 * vendor chunks in the app: `vendor-three`, `vendor-r3f`, `vendor-rapier`,
 * and `vendor-postprocessing` (~3.5 MB combined, minified). When the user
 * opens or creates a project — which is what they do within a second or
 * two of arriving — those chunks need to be on disk already, otherwise
 * they see the "Loading 3D viewport…" Suspense fallback.
 *
 * Strategy: call `import("@/editor/Viewport")` from `requestIdleCallback`
 * once the main entry has rendered. The browser fetches and parses the
 * chunk while the user is still reading the project picker; by the time
 * they click anything, the lazy import in `App.tsx` resolves synchronously
 * from the module cache.
 *
 * Vite deduplicates dynamic imports of the same specifier, so this
 * prefetch and the `lazy(() => import("@/editor/Viewport"))` in `App.tsx`
 * resolve to the *same* chunk request.
 */

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
type RequestIdleCallback = (
  cb: (deadline: IdleDeadlineLike) => void,
  opts?: { timeout?: number },
) => number;

/**
 * Run `cb` when the browser is idle, falling back to a short `setTimeout`
 * on browsers without `requestIdleCallback` (Safari < 16.4). The fallback
 * delay is generous enough that we don't compete with the editor shell's
 * first paint and React hydration on slower hardware.
 */
export function whenIdle(cb: () => void, fallbackDelayMs = 1500): void {
  if (typeof window === "undefined") return;
  const ric = (window as unknown as { requestIdleCallback?: RequestIdleCallback })
    .requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => cb(), { timeout: 4000 });
    return;
  }
  window.setTimeout(cb, fallbackDelayMs);
}

/**
 * True when the user has opted into Save-Data or is on a 2g-ish connection.
 * In that case we skip the prefetch and let the `lazy()` import pay the cost
 * on demand, so we don't burn their data budget on a chunk they may never
 * open.
 */
function shouldSkipPrefetch(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  if (conn.effectiveType && /^(slow-2g|2g)$/.test(conn.effectiveType)) {
    return true;
  }
  return false;
}

let prefetchPromise: Promise<unknown> | null = null;

/**
 * Kick off the Viewport chunk download in the background. Safe to call
 * multiple times — concurrent and subsequent calls share the same in-flight
 * promise, so the returned promise always resolves when the chunk is
 * actually available rather than resolving immediately for the second
 * caller. If the prefetch fails the cached promise is cleared so a real
 * on-demand import (the `lazy()` in `App.tsx`) can retry and surface the
 * error through Suspense's error boundary.
 */
export function prefetchViewport(): Promise<unknown> {
  if (prefetchPromise) return prefetchPromise;
  // Import via the small `viewportPreload` re-export entry. Routing both
  // the prefetch and the on-demand `lazy()` import in `App.tsx` through
  // the same module gives the chunk a stable name (`viewportPreload`)
  // that the build-time Vite plugin in `vite.config.ts` targets when it
  // emits the `<link rel="modulepreload">` tags into `index.html`.
  prefetchPromise = import("@/editor/viewportPreload").catch((err) => {
    // Reset so a real on-demand import can try again with full error
    // surfacing through Suspense.
    prefetchPromise = null;
    // Swallow here — the user-visible code path still owns error UI.
    if (typeof console !== "undefined") {
      console.debug("[prefetch] Viewport chunk prefetch failed:", err);
    }
  });
  return prefetchPromise;
}

/**
 * Schedule the Viewport prefetch for the next idle moment. Honors
 * Save-Data / slow-network preferences.
 */
export function schedulePrefetchViewport(): void {
  if (shouldSkipPrefetch()) return;
  whenIdle(() => {
    void prefetchViewport();
  });
}
