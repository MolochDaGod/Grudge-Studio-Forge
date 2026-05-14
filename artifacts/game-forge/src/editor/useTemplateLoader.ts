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
import { warmBuiltinModelsForEntities } from "@/lib/modelPreload";
import type { SceneData } from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";
import {
  useCreateProject,
  useCreateScene,
  useDeleteProject,
  getListProjectsQueryKey,
  getListScenesQueryKey,
  getGetProjectSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface ActiveLoad {
  key: string;
  label: string;
}

const DIALOG_HOLD_MS = 250;

/**
 * Auto-generated project name when the user picks an example template
 * with no active project. Format: `Example project YYYY-MM-DD HH:MM`
 * (local time). The user can rename it from the project picker; this
 * is just the placeholder until they do.
 */
function defaultExampleProjectName(now = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `Example project ${stamp}`;
}

export function useTemplateLoader() {
  const setSceneData = useEditor((s) => s.setSceneData);
  const setSceneName = useEditor((s) => s.setSceneName);
  const pushLog = useEditor((s) => s.pushLog);
  const setProject = useEditor((s) => s.setProject);
  const loadScene = useEditor((s) => s.loadScene);
  // Read projectId via getState() at start-time (not a subscription) —
  // we only need the current value when a load fires; subscribing would
  // re-run start's identity on every project switch and force callers
  // to re-bind their handlers.
  const getProjectId = useEditor.getState;

  const qc = useQueryClient();
  const createProjectMut = useCreateProject();
  const createSceneMut = useCreateScene();
  const deleteProjectMut = useDeleteProject();

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
        .then(async (data: SceneData) => {
          if (loadIdRef.current !== id) return;
          // Kick off background warm-up of every `builtin:` GLB referenced
          // by the template's entities BEFORE the dialog closes and the
          // viewport mounts them. Big maps (the deathmatch templates ship
          // 14–44 MB GLBs) otherwise wouldn't start downloading until
          // useGLTF() fires inside EntityRenderer, leaving the viewport
          // showing only the small wireframe placeholder for the entire
          // download. This call is best-effort and dedupes against drei's
          // loader cache, so re-picking the same template is a no-op.
          warmBuiltinModelsForEntities(data.entities);

          // Auto-create a project if the user picked an example template
          // without one open. Naming pattern: `Example project YYYY-MM-DD
          // HH:MM` — visible in the project picker until the user renames
          // it. Without this, the template would scribble onto whatever
          // last-loaded scratch buffer was around and never persist
          // server-side, surprising users who expected "examples" to live
          // somewhere they can come back to.
          //
          // Cancellation safety:
          //   We DELIBERATELY do not call setProject() until BOTH the
          //   project AND the scene exist server-side and we've re-checked
          //   loadId. setProject() resets sceneData to emptyScene() and
          //   clears the command stack, so calling it speculatively would
          //   destroy the user's current scratch buffer if they then
          //   cancel the dialog or click another template mid-create.
          //   On supersede after createProject succeeds we issue a
          //   best-effort rollback delete so we don't leak orphan empty
          //   projects to the project picker.
          const activeProjectId = getProjectId().projectId;
          if (activeProjectId == null) {
            const projName = defaultExampleProjectName();
            let newProjectId: number | null = null;
            try {
              const proj = await createProjectMut.mutateAsync({
                data: { name: projName, description: `Auto-created from example "${label}".` },
              });
              newProjectId = proj.id;
              // Supersede check #1 — if a newer load fired while
              // /api/projects was in flight, roll back the orphan.
              if (loadIdRef.current !== id) {
                deleteProjectMut.mutate({ id: proj.id });
                return;
              }
              const sceneRes = await createSceneMut.mutateAsync({
                data: { projectId: proj.id, name: label, data },
              });
              // Supersede check #2 — same window between scene-create
              // resolve and our state apply. Roll back project + its
              // empty scene (server cascades) before bailing.
              if (loadIdRef.current !== id) {
                deleteProjectMut.mutate({ id: proj.id });
                return;
              }
              // All server work succeeded → atomic UI commit. setProject
              // first to wipe any prior scratch + reset undo, then
              // loadScene to populate sceneId + the persisted entities.
              setProject(proj.id);
              loadScene(sceneRes.id, sceneRes.name, sceneRes.data as SceneData);
              qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
              qc.invalidateQueries({ queryKey: getListScenesQueryKey(proj.id) });
              qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(proj.id) });
              pushLog(
                "info",
                `Created project "${projName}" with example "${label}" (${data.entities.length} entities).`,
              );
              // Hold the 100% bar briefly so the user sees completion
              // before the dialog vanishes.
              holdTimerRef.current = window.setTimeout(() => {
                holdTimerRef.current = null;
                if (loadIdRef.current !== id) return;
                finalizeIfCurrent(id);
              }, DIALOG_HOLD_MS);
              return;
            } catch (err) {
              // Either createProject or createScene failed mid-way. If
              // the project DID get created (createScene was the failing
              // step), best-effort rollback so the picker doesn't grow
              // empty entries on every flaky network blip.
              if (newProjectId != null) {
                deleteProjectMut.mutate({ id: newProjectId });
              }
              pushLog(
                "warn",
                `Could not auto-create project: ${(err as Error).message}. Loading template into scratch scene.`,
              );
              // fall through to the in-memory path below
            }
          }

          // Hold the 100% bar for a beat so the user sees completion
          // before the dialog vanishes (in-memory / legacy path).
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
