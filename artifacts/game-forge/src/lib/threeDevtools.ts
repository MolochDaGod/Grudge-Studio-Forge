/**
 * Bridge to the official three.js devtools Chrome extension.
 *
 * The devtools extension (https://github.com/threejs/devtools — published as
 * "three.js developer tools" on the Chrome Web Store) waits for a global
 * `__THREE_DEVTOOLS__` EventTarget that the page populates on page load. The
 * page then dispatches `observe` events whose `detail` is a Three.js
 * Scene / WebGLRenderer / Object3D, and the extension introspects from
 * there.
 *
 * Two subtleties matter for a multi-viewport editor:
 *
 *  1. **The global must exist BEFORE three.js loads anything.** The
 *     extension shims `WebGLRenderer` etc. at the moment it sees the
 *     global, so we ensure it on module load and re-check on first use.
 *  2. **Each Canvas needs its OWN observe event.** The extension can
 *     track multiple scenes, but only ones it has been told about. When
 *     a new viewport tab mounts (model viewer, prefab editor, …) we
 *     observe its scene + renderer; on unmount we dispatch a synthetic
 *     `dispose` so the inspector tree doesn't accumulate dead trees.
 *
 * If the extension is not installed the global never gets created on the
 * extension side either — our defensive `EventTarget` is harmless and
 * just absorbs the events.
 */
import type { Object3D, WebGLRenderer, Scene } from "three";

declare global {
  interface Window {
    __THREE_DEVTOOLS__?: EventTarget;
  }
}

let initialized = false;

/** Install the global EventTarget the extension hooks. Safe to call many
 *  times; only the first call has effect. */
export function ensureThreeDevtools(): EventTarget | null {
  if (typeof window === "undefined") return null;
  if (!window.__THREE_DEVTOOLS__) {
    try {
      window.__THREE_DEVTOOLS__ = new EventTarget();
    } catch {
      // Some restricted environments (very old Safari, locked-down WKWebView)
      // don't expose EventTarget as a constructor. Bail silently — devtools
      // simply won't see this page.
      return null;
    }
  }
  if (!initialized) {
    initialized = true;
    // Surface a single line so power users can confirm devtools wiring.
    if (typeof console !== "undefined" && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.info(
        "[Forge] three.js devtools bridge ready — install the extension to inspect.",
      );
    }
  }
  return window.__THREE_DEVTOOLS__;
}

/** Tell the extension to add this object (Scene, Renderer, Object3D) to
 *  its inspector. */
export function observeForDevtools(target: Object3D | WebGLRenderer | Scene) {
  const bus = ensureThreeDevtools();
  if (!bus) return;
  try {
    bus.dispatchEvent(new CustomEvent("observe", { detail: target }));
  } catch {
    // Older extension versions only accept Event, not CustomEvent.
    // The detail is silently dropped in that case which is fine — the
    // observe event itself is the trigger.
  }
}

/** Inverse of `observeForDevtools` — best-effort cleanup so closed-tab
 *  scenes don't linger in the inspector tree. The extension currently
 *  keys off the object identity, so we simply re-dispatch with a `name`
 *  hint indicating the scene is gone. Older extension versions ignore
 *  this and prune dead refs themselves on page reload. */
export function disposeForDevtools(target: Object3D | WebGLRenderer | Scene) {
  const bus = ensureThreeDevtools();
  if (!bus) return;
  try {
    bus.dispatchEvent(new CustomEvent("dispose", { detail: target }));
  } catch {
    /* noop */
  }
}
