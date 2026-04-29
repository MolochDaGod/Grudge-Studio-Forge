/**
 * Lazy GLB warm-up for prefabs.
 *
 * The 3D viewport never preloads any `builtin:*` GLB on mount — `useGLTF`
 * inside `EntityRenderer` only fetches a model when an entity that
 * references it actually renders. That keeps heavy starters (Blake at
 * 4.3 MB, the VFX tornado at 11 MB, etc.) off the editor's critical path
 * for sessions that never spawn them.
 *
 * The trade-off is that the FIRST spawn of such a prefab pays the network
 * + parse cost while the user waits, showing the small "loading" cube
 * fallback in the viewport. To paper over that latency we warm the
 * loader cache from cheap user-intent signals: hovering or focusing the
 * matching Hotbar slot, or hovering the prefab row in the Prefabs panel.
 * By the time the click lands the GLB is usually already in cache and
 * `useGLTF` resolves synchronously.
 *
 * This is intentionally a generic helper rather than a Blake-specific one
 * — every model-backed starter (current and future) gets the same treatment
 * automatically as long as its entities use `builtin:` URLs.
 *
 * Bundle note: drei is a heavy vendor dep that lives in the lazy
 * `vendor-r3f` / viewport chunk. We deliberately use a DYNAMIC import for
 * `useGLTF.preload` so this helper can be called from the editor shell
 * (`PrefabsPanel`) without pulling drei into the shell chunk and undoing
 * the existing lazy-viewport split. By the time the user hovers anything,
 * `schedulePrefetchViewport()` has usually already streamed the viewport
 * chunk into cache, so the dynamic import resolves in microseconds.
 */

import { resolveBuiltinModel } from "@/lib/builtinModels";
import type { SceneEntity } from "@/scene/types";

/** URLs we have already asked the loader to warm. drei's GLTFLoader cache
 *  also dedupes internally, but tracking it here lets us short-circuit the
 *  entity traversal AND the dynamic drei import when the same prefab gets
 *  hovered repeatedly. */
const warmedUrls = new Set<string>();

/** Cached drei module reference. Populated on first warm-up so subsequent
 *  calls skip the dynamic-import promise round-trip. */
type DreiPreloadModule = { useGLTF: { preload: (url: string) => void } };
let dreiPromise: Promise<DreiPreloadModule> | null = null;

function getDrei(): Promise<DreiPreloadModule> {
  if (!dreiPromise) {
    dreiPromise = import("@react-three/drei").then(
      (m) => m as unknown as DreiPreloadModule,
    );
  }
  return dreiPromise;
}

function collectBuiltinModelUrls(
  entities: readonly SceneEntity[] | undefined,
): string[] {
  if (!entities || entities.length === 0) return [];
  const out: string[] = [];
  for (const e of entities) {
    const raw = e.model?.url;
    if (!raw) continue;
    const resolved = resolveBuiltinModel(raw);
    // Only warm bundled builtins — arbitrary user URLs may be huge or
    // unavailable, and warming them speculatively would burn bandwidth
    // for content the user might never spawn.
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * Idempotently kick off background fetch + parse of every `builtin:` GLB
 * referenced by `entities`. Safe to call from `onMouseEnter` / `onFocus`
 * handlers — both this helper's `warmedUrls` set and drei's loader cache
 * make the second call a no-op.
 *
 * Failures are swallowed: warm-up is best-effort, and the real on-demand
 * `useGLTF()` in `EntityRenderer` still owns user-visible error UI via
 * its `<Suspense>` boundary.
 */
export function warmBuiltinModelsForEntities(
  entities: readonly SceneEntity[] | undefined,
): void {
  const urls = collectBuiltinModelUrls(entities).filter(
    (u) => !warmedUrls.has(u),
  );
  if (urls.length === 0) return;
  // Reserve the URLs synchronously so concurrent hover events don't kick off
  // duplicate dynamic imports + preloads while the first one is in flight.
  for (const u of urls) warmedUrls.add(u);
  void getDrei().then(
    ({ useGLTF }) => {
      for (const url of urls) {
        try {
          useGLTF.preload(url);
        } catch (err) {
          // Drop from the dedupe set so a later, real render can still try.
          warmedUrls.delete(url);
          if (typeof console !== "undefined") {
            console.debug("[modelPreload] preload failed for", url, err);
          }
        }
      }
    },
    (err) => {
      // The drei chunk itself failed to load — clear the reservations so
      // a later attempt can retry once the viewport chunk arrives.
      for (const u of urls) warmedUrls.delete(u);
      dreiPromise = null;
      if (typeof console !== "undefined") {
        console.debug("[modelPreload] drei dynamic import failed:", err);
      }
    },
  );
}

/** Test-only: forget which URLs we have warmed. Not exported for app use. */
export function __resetWarmedUrlsForTests(): void {
  warmedUrls.clear();
  dreiPromise = null;
}
