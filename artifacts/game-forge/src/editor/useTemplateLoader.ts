/**
 * Shared hook for the two template entry points (Toolbar dropdown and
 * Viewport empty-scene overlay). Owns the AbortController, the live
 * progress state, and dialog open/close — so both call sites just hand
 * us a `(key, label) => void` handle and listen for the success
 * callback to populate the editor store.
 *
 * When no project is open, we auto-create a local/cloud project + scene
 * so AI tools, autosave, and asset import work immediately. If the
 * remote API is down (HTTP 500 / HTML error pages), we fall back to the
 * Puter/local data provider so the example still loads into a real
 * project instead of a dead scratch scene.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  getListTemplatesQueryKey,
} from "@workspace/api-client-react";
import * as localDp from "@/lib/cloud/puterDataProvider";

interface ActiveLoad {
  key: string;
  label: string;
}

const DIALOG_HOLD_MS = 250;

function exampleProjectName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Example project ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function useTemplateLoader() {
  const setSceneData = useEditor((s) => s.setSceneData);
  const setSceneName = useEditor((s) => s.setSceneName);
  const pushLog = useEditor((s) => s.pushLog);
  const setProject = useEditor((s) => s.setProject);
  const loadScene = useEditor((s) => s.loadScene);
  const getState = useEditor.getState;

  const qc = useQueryClient();
  const createProject = useCreateProject();
  const createScene = useCreateScene();
  const deleteProject = useDeleteProject();

  const [active, setActive] = useState<ActiveLoad | null>(null);
  const [progress, setProgress] = useState<TemplateLoadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadIdRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);

  const finalizeIfCurrent = (id: number) => {
    if (loadIdRef.current !== id) return;
    setActive(null);
    setProgress(null);
    abortRef.current = null;
  };

  const start = useCallback(
    (key: string, label: string) => {
      const id = ++loadIdRef.current;

      abortRef.current?.abort();
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
          if (loadIdRef.current !== id) return;
          setProgress(() => p);
        },
      })
        .then(async (data: SceneData) => {
          if (loadIdRef.current !== id) return;
          warmBuiltinModelsForEntities(data.entities);

          // Auto-create project when none is open so AI + assets work.
          if (getState().projectId == null) {
            const projName = exampleProjectName();
            let createdProjectId: number | null = null;
            try {
              // Prefer data-layer hooks (Puter / localStorage when aliased).
              const project = await createProject.mutateAsync({
                data: {
                  name: projName,
                  description: `Auto-created from example "${label}".`,
                },
              });
              createdProjectId = project.id;
              if (loadIdRef.current !== id) {
                deleteProject.mutate({ id: project.id });
                return;
              }
              const scene = await createScene.mutateAsync({
                data: {
                  projectId: project.id,
                  name: label,
                  data,
                },
              });
              if (loadIdRef.current !== id) {
                deleteProject.mutate({ id: project.id });
                return;
              }
              setProject(project.id);
              loadScene(scene.id, scene.name, (scene.data as SceneData) ?? data);
              void qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
              void qc.invalidateQueries({ queryKey: getListScenesQueryKey(project.id) });
              void qc.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
              pushLog(
                "info",
                `Created project "${projName}" with example "${label}" (${data.entities.length} entities).`,
              );
              holdTimerRef.current = window.setTimeout(() => {
                holdTimerRef.current = null;
                if (loadIdRef.current === id) finalizeIfCurrent(id);
              }, DIALOG_HOLD_MS);
              return;
            } catch (err) {
              // Remote API often returns HTML 500 pages through Cloudflare.
              // Fall back to pure local Puter/guest provider so the example
              // still opens as a real project.
              if (createdProjectId != null) {
                try {
                  deleteProject.mutate({ id: createdProjectId });
                } catch {
                  /* ignore */
                }
              }
              try {
                const project = await localDp.createProject({
                  name: projName,
                  description: `Auto-created from example "${label}" (offline fallback).`,
                });
                const scene = await localDp.createScene({
                  projectId: project.id,
                  name: label,
                  data,
                });
                if (loadIdRef.current !== id) return;
                setProject(project.id);
                loadScene(scene.id, scene.name, (scene.data as SceneData) ?? data);
                void qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                pushLog(
                  "warn",
                  `API project create failed (${err instanceof Error ? err.message : String(err)}). Opened local project "${projName}" instead.`,
                );
                holdTimerRef.current = window.setTimeout(() => {
                  holdTimerRef.current = null;
                  if (loadIdRef.current === id) finalizeIfCurrent(id);
                }, DIALOG_HOLD_MS);
                return;
              } catch (fallbackErr) {
                pushLog(
                  "warn",
                  `Could not auto-create project: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}. Loading template into scratch scene.`,
                );
              }
            }
          }

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
    [
      setSceneData,
      setSceneName,
      pushLog,
      setProject,
      loadScene,
      createProject,
      createScene,
      deleteProject,
      qc,
    ],
  );

  const cancel = useCallback(() => {
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

  useEffect(() => {
    return () => {
      loadIdRef.current++;
      abortRef.current?.abort();
      if (holdTimerRef.current != null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, []);

  return {
    active,
    /** Convenience label for the loading dialog title. */
    activeLabel: active?.label ?? "",
    progress,
    start,
    cancel,
    isLoading: active != null,
  };
}
