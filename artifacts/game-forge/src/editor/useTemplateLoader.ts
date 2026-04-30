/**
 * Shared hook for the two template entry points (Toolbar dropdown and
 * Viewport empty-scene overlay). Owns the AbortController, the live
 * progress state, and dialog open/close — so both call sites just hand
 * us a `(key, label) => void` handle and listen for the success
 * callback to populate the editor store.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TemplateLoadProgress } from "@/lib/loadTemplate";
import { loadTemplateWithProgress } from "@/lib/loadTemplate";
import type { SceneData } from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";

interface ActiveLoad {
  key: string;
  label: string;
}

const DIALOG_HOLD_MS = 250;

export function useTemplateLoader() {
  const setSceneData = useEditor((s) => s.setSceneData);
  const setSceneName = useEditor((s) => s.setSceneName);
  const pushLog = useEditor((s) => s.pushLog);

  const [active, setActive] = useState<ActiveLoad | null>(null);
  const [progress, setProgress] = useState<TemplateLoadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic load id — every `start()` increments and the new value is
  // captured in that load's promise callbacks. Stale callbacks (whose
  // captured id no longer matches) become no-ops, so an aborted A-load
  // can never clobber an in-flight B-load's state. Without this guard,
  // rapid clicks would race: A's AbortError handler fires AFTER B's
  // start() has already populated the dialog, hiding B's dialog and
  // nulling B's controller.
  const loadIdRef = useRef(0);
  // Pending "hold at 100% before closing" timer. Tracked so unmount can
  // clear it, otherwise a fast unmount-after-success would still call
  // setSceneData on a torn-down store consumer.
  const holdTimerRef = useRef<number | null>(null);

  // Centralized teardown for the current load attempt — only run when
  // the captured id still matches.
  const finalizeIfCurrent = (id: number) => {
    if (loadIdRef.current !== id) return;
    setActive(null);
    setProgress(null);
    abortRef.current = null;
  };

  const start = useCallback(
    (key: string, label: string) => {
      // Bump id BEFORE aborting the previous controller. Otherwise the
      // prior load's AbortError handler might race ahead and observe
      // its own (now-stale) id as still-current.
      const id = ++loadIdRef.current;

      // If a previous load is in flight, abort it. Its callbacks will
      // see id mismatch and silently bail.
      abortRef.current?.abort();
      // Clear any pending success-hold timer from a previous load too.
      if (holdTimerRef.current != null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setActive({ key, label });
      setProgress(null);

      loadTemplateWithProgress(key, {
        signal: ctrl.signal,
        onProgress: (p) => {
          // Drop progress events from superseded loads.
          if (loadIdRef.current !== id) return;
          setProgress(() => p);
        },
      })
        .then((data: SceneData) => {
          if (loadIdRef.current !== id) return;
          // Hold the 100% bar for a beat so the user sees completion
          // before the dialog vanishes.
          holdTimerRef.current = window.setTimeout(() => {
            holdTimerRef.current = null;
            if (loadIdRef.current !== id) return;
            setSceneData(data);
            setSceneName(label);
            pushLog(
              "info",
              `Loaded template "${label}" (${data.entities.length} entities).`,
            );
            finalizeIfCurrent(id);
          }, DIALOG_HOLD_MS);
        })
        .catch((err: Error) => {
          if (loadIdRef.current !== id) return;
          if (err.name === "AbortError") {
            // User-cancelled — silent close, no toast/log noise.
            finalizeIfCurrent(id);
            return;
          }
          pushLog(
            "error",
            `Failed to load template "${label}": ${err.message}`,
          );
          finalizeIfCurrent(id);
        });
    },
    [setSceneData, setSceneName, pushLog],
  );

  const cancel = useCallback(() => {
    // Make Cancel authoritative across BOTH phases:
    //   1. Streaming phase — abort the in-flight fetch (AbortController).
    //   2. Hold-at-100% phase (between fetch resolve and the 250ms timer
    //      firing) — fetch has already resolved, so abort() is a no-op;
    //      we must clear the hold timer ourselves AND bump loadId so the
    //      already-scheduled callback bails on its id-mismatch check.
    // Without (2), Cancel during the hold window still applies the scene.
    loadIdRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setActive(null);
    setProgress(null);
  }, []);

  // Unmount cleanup: abort any in-flight fetch and clear the hold
  // timer so stale promise callbacks can't run against a torn-down
  // component (or, during dev, against the previous module instance
  // after a Vite hot reload).
  useEffect(() => {
    return () => {
      // Bumping the id invalidates every captured closure, even if
      // the controller's abort hasn't propagated yet.
      loadIdRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      if (holdTimerRef.current != null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, []);

  return {
    activeLabel: active?.label ?? "",
    isLoading: active != null,
    progress,
    start,
    cancel,
  };
}
