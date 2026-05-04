import { useEffect, useRef } from "react";
import { useEditor } from "@/store/editor";

/** Persistence + crash-resilience hooks for the editor.
 *
 *  Three independent concerns wired into one place so App.tsx stays clean:
 *    1. Autosave — debounced 2 s after `isDirty` flips, dispatches the
 *       same `gameforge:save` event Ctrl+S uses (so the Toolbar's
 *       existing save plumbing stays the single source of truth for
 *       what "save" means in the various modes — scene vs prefab).
 *    2. localStorage draft mirror — every `sceneData` change is
 *       debounced 500 ms and written to `gameforge:draft:<sceneId>`.
 *       The store's `loadScene` action restores from this on next open
 *       if present; `markSaved()` clears it. This is a safety net for
 *       browser crashes, tab kills, network outages, etc. — independent
 *       of (and faster than) the API autosave.
 *    3. `beforeunload` guard — blocks accidental tab/window close while
 *       there are unsaved changes. The browser only honors a string
 *       return value, but at least the prompt fires.
 */

const SAVE_EVENT = "gameforge:save";
const AUTOSAVE_DEBOUNCE_MS = 2000;
const DRAFT_DEBOUNCE_MS = 500;
const DRAFT_KEY_PREFIX = "gameforge:draft:";

/** Drives the autosave timer. Subscribes to the slices that matter
 *  (`isDirty`, `sceneId`, `prefabSubScene`, `isPlaying`) and queues a
 *  single trailing-edge save event AUTOSAVE_DEBOUNCE_MS after the last
 *  dirty mutation. Skips when:
 *    - not dirty
 *    - currently playing (saving mid-play yanks the scene out from
 *      under the running session)
 *    - no `sceneId` AND no prefab sub-scene (we don't want autosave
 *      silently materializing "Untitled Scene" rows on the first
 *      keystroke; the user must explicitly save the first time)
 */
export function useEditorAutosave(): void {
  const isDirty = useEditor((s) => s.isDirty);
  const sceneId = useEditor((s) => s.sceneId);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);
  const isPlaying = useEditor((s) => s.isPlaying);
  const projectId = useEditor((s) => s.projectId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!isDirty) return;
    if (isPlaying) return;
    if (!projectId) return;
    // Need either a real scene id (UPDATE) or a prefab sub-scene
    // (UPDATE prefab). Brand-new unsaved scenes are skipped so we
    // don't spam "Untitled Scene" rows.
    if (sceneId === null && !prefabSubScene) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      window.dispatchEvent(new CustomEvent(SAVE_EVENT, { detail: { autosave: true } }));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isDirty, sceneId, prefabSubScene, isPlaying, projectId]);
}

/** Mirrors `sceneData` into localStorage on a 500 ms debounce so a
 *  browser crash between API saves doesn't lose work. Skipped while
 *  in prefab sub-scene mode (the buffer is the prefab, not the scene
 *  — restoring it as the scene's draft would corrupt the parent
 *  scene). Quota errors are swallowed: a missing draft is a worse-case
 *  no-op, not a data loss bug.
 */
export function useEditorDraftMirror(): void {
  const sceneId = useEditor((s) => s.sceneId);
  const sceneData = useEditor((s) => s.sceneData);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);
  const isDirty = useEditor((s) => s.isDirty);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (sceneId === null) return;
    if (prefabSubScene) return;
    if (!isDirty) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      try {
        const payload = JSON.stringify({ savedAt: Date.now(), data: sceneData });
        window.localStorage.setItem(`${DRAFT_KEY_PREFIX}${sceneId}`, payload);
      } catch {
        // Quota / private mode / disabled storage — non-fatal.
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sceneId, sceneData, prefabSubScene, isDirty]);
}

/** Browser confirmation dialog when the user tries to close the tab /
 *  window with unsaved changes. The localStorage draft mirror still
 *  protects against accidents, but a prompt is the standard UX and
 *  costs nothing to add. */
export function useUnsavedChangesGuard(): void {
  const isDirty = useEditor((s) => s.isDirty);
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for legacy Chromium; modern browsers ignore the
      // string but still show their generic "Leave site?" dialog if
      // we set returnValue.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}

/** Routes uncaught window errors and unhandled promise rejections into
 *  the editor's bottom-panel console so silent failures stop being
 *  silent. Only registered once per page (idempotent across HMR). */
export function useGlobalErrorCapture(): void {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const msg = e.error?.message ?? e.message ?? "Unknown error";
      const where = e.filename ? ` (${e.filename}:${e.lineno})` : "";
      try {
        useEditor.getState().pushLog("error", `Uncaught: ${msg}${where}`);
      } catch {
        // Store not ready yet during very early boot — drop it.
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
      try {
        useEditor.getState().pushLog("error", `Unhandled promise rejection: ${reason}`);
      } catch {
        /* boot-race */
      }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}
