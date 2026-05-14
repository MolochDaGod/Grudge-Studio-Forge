/**
 * Per-project UI screen store.
 *
 * Why a separate store?
 *   - The 3D editor store (`useEditor`) is large and mutated at 60 fps
 *     by transform drags. UI screen edits are slower and shouldn't force
 *     scene-graph subscribers to re-evaluate.
 *   - PR-1 keeps server persistence out of scope; screens live in
 *     `localStorage` keyed by project id and survive reloads. A future
 *     PR can swap the persistence backend without touching consumers.
 *
 * Selection key (`selectedWidgetId`) is colocated here so the inspector
 * and canvas always agree without prop-drilling.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { UIScreen, Widget, WidgetType } from "@/lib/uiScreen/types";
import { createWidget } from "@/lib/uiScreen/defaults";
import {
  serializeScreenToHtml,
  downloadScreenHtml,
} from "@/lib/uiScreen/exportHtml";
import { useViewportTabs } from "@/store/viewportTabs";

/** Top-level project id type. We accept `number | "global"` so screens can
 *  be authored before any project is opened (rare but handy for testing). */
export type ProjectKey = number | "global";

interface ScreensByProject {
  [project: string]: UIScreen[];
}

interface UIScreensState {
  /** Outer key is the stringified project id (or `"global"`). */
  byProject: ScreensByProject;
  selectedWidgetId: string | null;

  // ── Screen lifecycle ─────────────────────────────────────────────
  listScreens: (project: ProjectKey) => UIScreen[];
  getScreen: (project: ProjectKey, screenId: string) => UIScreen | undefined;
  createScreen: (
    project: ProjectKey,
    opts?: { name?: string; width?: number; height?: number },
  ) => UIScreen;
  renameScreen: (project: ProjectKey, screenId: string, name: string) => void;
  deleteScreen: (project: ProjectKey, screenId: string) => void;

  // ── Widget mutations ─────────────────────────────────────────────
  addWidget: (
    project: ProjectKey,
    screenId: string,
    type: WidgetType,
    pos?: { x: number; y: number },
    patch?: Partial<Pick<Widget, "w" | "h" | "name">> & {
      props?: Record<string, unknown>;
    },
  ) => Widget | undefined;
  updateWidget: (
    project: ProjectKey,
    screenId: string,
    widgetId: string,
    patch: Partial<Omit<Widget, "id" | "type">> & {
      props?: Record<string, unknown>;
    },
  ) => void;
  removeWidget: (
    project: ProjectKey,
    screenId: string,
    widgetId: string,
  ) => void;
  bringToFront: (
    project: ProjectKey,
    screenId: string,
    widgetId: string,
  ) => void;

  setSelected: (widgetId: string | null) => void;

  // ── Export ───────────────────────────────────────────────────────
  exportHtml: (project: ProjectKey, screenId: string) => string | null;
  downloadHtml: (project: ProjectKey, screenId: string) => void;
}

const projectKey = (p: ProjectKey) => String(p);

function mutateScreen(
  byProject: ScreensByProject,
  project: ProjectKey,
  screenId: string,
  fn: (s: UIScreen) => UIScreen,
): ScreensByProject {
  const key = projectKey(project);
  const list = byProject[key] ?? [];
  const next = list.map((s) =>
    s.id === screenId ? { ...fn(s), updatedAt: Date.now() } : s,
  );
  return { ...byProject, [key]: next };
}

export const useUIScreens = create<UIScreensState>()(
  persist(
    (set, get) => ({
      byProject: {},
      selectedWidgetId: null,

      listScreens: (project) => {
        const list = get().byProject[projectKey(project)] ?? [];
        return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
      },

      getScreen: (project, screenId) =>
        (get().byProject[projectKey(project)] ?? []).find(
          (s) => s.id === screenId,
        ),

      createScreen: (project, opts) => {
        const screen: UIScreen = {
          id: nanoid(8),
          name: opts?.name ?? "HUD Overlay",
          width: opts?.width ?? 1920,
          height: opts?.height ?? 1080,
          theme: "grudge",
          widgets: [],
          updatedAt: Date.now(),
        };
        set((s) => {
          const key = projectKey(project);
          const list = s.byProject[key] ?? [];
          return { byProject: { ...s.byProject, [key]: [...list, screen] } };
        });
        return screen;
      },

      renameScreen: (project, screenId, name) => {
        set((s) => ({
          byProject: mutateScreen(s.byProject, project, screenId, (sc) => ({
            ...sc,
            name,
          })),
        }));
        // Keep any open ui-screen tab title in sync with the rename so
        // both inspector edits and AI `ui_rename_screen` calls update the
        // tab pill, not just the surface. Tabs don't store dedupeKey, so
        // we match by payload shape directly.
        const tab = useViewportTabs.getState().tabs.find(
          (t) =>
            t.payload.kind === "ui-screen" &&
            t.payload.data.screenId === screenId &&
            t.payload.data.project === project,
        );
        if (tab) useViewportTabs.getState().renameTab(tab.id, name);
      },

      deleteScreen: (project, screenId) =>
        set((s) => {
          const key = projectKey(project);
          const list = s.byProject[key] ?? [];
          return {
            byProject: {
              ...s.byProject,
              [key]: list.filter((sc) => sc.id !== screenId),
            },
          };
        }),

      addWidget: (project, screenId, type, pos, patch) => {
        const w = createWidget(type, pos ?? { x: 40, y: 40 }, patch);
        set((s) => ({
          byProject: mutateScreen(s.byProject, project, screenId, (sc) => ({
            ...sc,
            widgets: [...sc.widgets, w],
          })),
          selectedWidgetId: w.id,
        }));
        return w;
      },

      updateWidget: (project, screenId, widgetId, patch) =>
        set((s) => ({
          byProject: mutateScreen(s.byProject, project, screenId, (sc) => ({
            ...sc,
            widgets: sc.widgets.map((w) =>
              w.id !== widgetId
                ? w
                : {
                    ...w,
                    ...patch,
                    props: patch.props ? { ...w.props, ...patch.props } : w.props,
                  },
            ),
          })),
        })),

      removeWidget: (project, screenId, widgetId) =>
        set((s) => ({
          byProject: mutateScreen(s.byProject, project, screenId, (sc) => ({
            ...sc,
            widgets: sc.widgets.filter((w) => w.id !== widgetId),
          })),
          selectedWidgetId:
            s.selectedWidgetId === widgetId ? null : s.selectedWidgetId,
        })),

      bringToFront: (project, screenId, widgetId) =>
        set((s) => ({
          byProject: mutateScreen(s.byProject, project, screenId, (sc) => {
            const w = sc.widgets.find((x) => x.id === widgetId);
            if (!w) return sc;
            return {
              ...sc,
              widgets: [...sc.widgets.filter((x) => x.id !== widgetId), w],
            };
          }),
        })),

      setSelected: (widgetId) => set({ selectedWidgetId: widgetId }),

      exportHtml: (project, screenId) => {
        const screen = get().getScreen(project, screenId);
        return screen ? serializeScreenToHtml(screen) : null;
      },

      downloadHtml: (project, screenId) => {
        const screen = get().getScreen(project, screenId);
        if (screen) downloadScreenHtml(screen);
      },
    }),
    {
      name: "grudge.ui.screens.v1",
      partialize: (s) => ({ byProject: s.byProject }),
    },
  ),
);
