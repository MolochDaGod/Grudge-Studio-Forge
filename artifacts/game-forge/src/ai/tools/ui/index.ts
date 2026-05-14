/**
 * AI tools for the 2D UI editor.
 *
 * Drives `useUIScreens` directly so screens authored via chat appear in
 * the editor instantly — same pattern as the 3D scene tools driving
 * `useEditor`. Read-only tools (`ui_list_screens`, `ui_get_screen`,
 * `ui_export_html`) follow the same `{ defs, handlers,
 * destructiveToolNames }` shape as every other per-area tool folder so
 * `lib/aiTools.ts` can spread them in with a single import.
 *
 * Project resolution: tools default to the editor's currently-open
 * project (`useEditor.getState().projectId`). When no project is open we
 * fall back to the `"global"` bucket so the model can still create
 * screens during a fresh session — matches the editor's own behaviour
 * via `UIEditorSurface`.
 */
import { useEditor } from "@/store/editor";
import { useUIScreens, type ProjectKey } from "@/store/uiScreens";
import {
  WIDGET_TYPES,
  WIDGET_DEFAULTS,
  WIDGET_LABEL,
} from "@/lib/uiScreen/defaults";
import type { Widget, WidgetType } from "@/lib/uiScreen/types";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

function activeProject(): ProjectKey {
  const id = useEditor.getState().projectId;
  return typeof id === "number" ? id : "global";
}

const isWidgetType = (v: unknown): v is WidgetType =>
  typeof v === "string" && (WIDGET_TYPES as readonly string[]).includes(v);

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const widgetSummary = (w: Widget) => ({
  id: w.id,
  type: w.type,
  name: w.name,
  x: w.x,
  y: w.y,
  w: w.w,
  h: w.h,
  props: w.props,
});

// ── Definitions ──────────────────────────────────────────────────────

const LIST_SCREENS: ToolDef = {
  name: "ui_list_screens",
  description:
    "List all UI screens authored for the current project. Returns id, name, dimensions, widget count, and updatedAt for each.",
  input_schema: { type: "object", properties: {} },
};

const GET_SCREEN: ToolDef = {
  name: "ui_get_screen",
  description:
    "Read a single UI screen by id. Returns the full widget tree so you can reason about positions before adding/updating widgets.",
  input_schema: {
    type: "object",
    properties: { screenId: { type: "string" } },
    required: ["screenId"],
  },
};

const LIST_WIDGET_TYPES: ToolDef = {
  name: "ui_list_widget_types",
  description:
    "Enumerate the widget types the UI editor supports along with their default size and prop shape. Call this first if you're unsure what widgets exist.",
  input_schema: { type: "object", properties: {} },
};

const CREATE_SCREEN: ToolDef = {
  name: "ui_create_screen",
  description:
    "Create a new UI screen (e.g. an HUD overlay or main panel) in the current project. Defaults to 1920×1080 with the Grudge Warlords theme. Opens automatically in the editor.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
    },
  },
};

const RENAME_SCREEN: ToolDef = {
  name: "ui_rename_screen",
  description: "Rename an existing UI screen.",
  input_schema: {
    type: "object",
    properties: {
      screenId: { type: "string" },
      name: { type: "string" },
    },
    required: ["screenId", "name"],
  },
};

const DELETE_SCREEN: ToolDef = {
  name: "ui_delete_screen",
  description: "Permanently delete a UI screen and all of its widgets.",
  input_schema: {
    type: "object",
    properties: { screenId: { type: "string" } },
    required: ["screenId"],
  },
};

const ADD_WIDGET: ToolDef = {
  name: "ui_add_widget",
  description:
    "Add a widget to a UI screen. `type` must be one returned by ui_list_widget_types. `x/y/w/h` are in design-canvas pixels (top-left origin). `props` overrides the type's default prop bag.",
  input_schema: {
    type: "object",
    properties: {
      screenId: { type: "string" },
      type: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      w: { type: "number" },
      h: { type: "number" },
      name: { type: "string" },
      props: { type: "object" },
    },
    required: ["screenId", "type"],
  },
};

const UPDATE_WIDGET: ToolDef = {
  name: "ui_update_widget",
  description:
    "Patch an existing widget. Any of `x/y/w/h/name/props` may be omitted; `props` is merged into the existing prop bag (not replaced).",
  input_schema: {
    type: "object",
    properties: {
      screenId: { type: "string" },
      widgetId: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      w: { type: "number" },
      h: { type: "number" },
      name: { type: "string" },
      props: { type: "object" },
    },
    required: ["screenId", "widgetId"],
  },
};

const REMOVE_WIDGET: ToolDef = {
  name: "ui_remove_widget",
  description: "Remove a widget from a UI screen by id.",
  input_schema: {
    type: "object",
    properties: {
      screenId: { type: "string" },
      widgetId: { type: "string" },
    },
    required: ["screenId", "widgetId"],
  },
};

const EXPORT_HTML: ToolDef = {
  name: "ui_export_html",
  description:
    "Serialize a UI screen to a single self-contained HTML string (Cinzel + Crimson Text + JetBrains Mono fonts via Google CDN, full Grudge theme inlined). Returns the html source so you can show a snippet to the user; the editor's Export button downloads the file directly.",
  input_schema: {
    type: "object",
    properties: { screenId: { type: "string" } },
    required: ["screenId"],
  },
};

// ── Handlers ─────────────────────────────────────────────────────────

const listScreensHandler: ToolHandler = async () => {
  const screens = useUIScreens.getState().listScreens(activeProject());
  return {
    ok: true,
    data: {
      screens: screens.map((s) => ({
        id: s.id,
        name: s.name,
        width: s.width,
        height: s.height,
        widgetCount: s.widgets.length,
        updatedAt: s.updatedAt,
      })),
    },
  };
};

const getScreenHandler: ToolHandler = async (input) => {
  const screenId = String(input.screenId ?? "");
  const screen = useUIScreens.getState().getScreen(activeProject(), screenId);
  if (!screen) return { ok: false, error: `screen ${screenId} not found` };
  return {
    ok: true,
    data: {
      id: screen.id,
      name: screen.name,
      width: screen.width,
      height: screen.height,
      theme: screen.theme,
      widgets: screen.widgets.map(widgetSummary),
    },
  };
};

const listWidgetTypesHandler: ToolHandler = async () => ({
  ok: true,
  data: {
    types: WIDGET_TYPES.map((t) => ({
      type: t,
      label: WIDGET_LABEL[t],
      defaultSize: { w: WIDGET_DEFAULTS[t].w, h: WIDGET_DEFAULTS[t].h },
      defaultProps: WIDGET_DEFAULTS[t].props,
    })),
  },
});

const createScreenHandler: ToolHandler = async (input) => {
  const project = activeProject();
  const screen = useUIScreens.getState().createScreen(project, {
    name: typeof input.name === "string" ? input.name : undefined,
    width:
      typeof input.width === "number" ? input.width : undefined,
    height:
      typeof input.height === "number" ? input.height : undefined,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("gameforge:openUIScreen", {
        detail: { screenId: screen.id, screenName: screen.name, project },
      }),
    );
  }
  return { ok: true, data: { id: screen.id, name: screen.name } };
};

const renameScreenHandler: ToolHandler = async (input) => {
  const project = activeProject();
  const screenId = String(input.screenId ?? "");
  const name = String(input.name ?? "");
  if (!useUIScreens.getState().getScreen(project, screenId))
    return { ok: false, error: `screen ${screenId} not found` };
  useUIScreens.getState().renameScreen(project, screenId, name);
  return { ok: true, data: { id: screenId, name } };
};

const deleteScreenHandler: ToolHandler = async (input) => {
  const project = activeProject();
  const screenId = String(input.screenId ?? "");
  if (!useUIScreens.getState().getScreen(project, screenId))
    return { ok: false, error: `screen ${screenId} not found` };
  useUIScreens.getState().deleteScreen(project, screenId);
  return { ok: true, data: { id: screenId, deleted: true } };
};

const addWidgetHandler: ToolHandler = async (input) => {
  const project = activeProject();
  const screenId = String(input.screenId ?? "");
  if (!useUIScreens.getState().getScreen(project, screenId))
    return { ok: false, error: `screen ${screenId} not found` };
  if (!isWidgetType(input.type))
    return {
      ok: false,
      error: `unknown widget type. valid: ${WIDGET_TYPES.join(", ")}`,
    };
  const def = WIDGET_DEFAULTS[input.type];
  const widget = useUIScreens
    .getState()
    .addWidget(
      project,
      screenId,
      input.type,
      { x: num(input.x, 40), y: num(input.y, 40) },
      {
        w: typeof input.w === "number" ? input.w : def.w,
        h: typeof input.h === "number" ? input.h : def.h,
        name: typeof input.name === "string" ? input.name : undefined,
        props:
          input.props && typeof input.props === "object"
            ? (input.props as Record<string, unknown>)
            : undefined,
      },
    );
  if (!widget) return { ok: false, error: "addWidget returned no widget" };
  return { ok: true, data: widgetSummary(widget) };
};

const updateWidgetHandler: ToolHandler = async (input) => {
  const project = activeProject();
  const screenId = String(input.screenId ?? "");
  const widgetId = String(input.widgetId ?? "");
  const screen = useUIScreens.getState().getScreen(project, screenId);
  if (!screen) return { ok: false, error: `screen ${screenId} not found` };
  if (!screen.widgets.some((w) => w.id === widgetId))
    return { ok: false, error: `widget ${widgetId} not found in screen` };
  const patch: Parameters<
    ReturnType<typeof useUIScreens.getState>["updateWidget"]
  >[3] = {};
  if (typeof input.x === "number") patch.x = input.x;
  if (typeof input.y === "number") patch.y = input.y;
  if (typeof input.w === "number") patch.w = input.w;
  if (typeof input.h === "number") patch.h = input.h;
  if (typeof input.name === "string") patch.name = input.name;
  if (input.props && typeof input.props === "object")
    patch.props = input.props as Record<string, unknown>;
  useUIScreens.getState().updateWidget(project, screenId, widgetId, patch);
  const fresh = useUIScreens
    .getState()
    .getScreen(project, screenId)
    ?.widgets.find((w) => w.id === widgetId);
  return { ok: true, data: fresh ? widgetSummary(fresh) : { id: widgetId } };
};

const removeWidgetHandler: ToolHandler = async (input) => {
  const project = activeProject();
  const screenId = String(input.screenId ?? "");
  const widgetId = String(input.widgetId ?? "");
  if (!useUIScreens.getState().getScreen(project, screenId))
    return { ok: false, error: `screen ${screenId} not found` };
  useUIScreens.getState().removeWidget(project, screenId, widgetId);
  return { ok: true, data: { id: widgetId, removed: true } };
};

const exportHtmlHandler: ToolHandler = async (input) => {
  const project = activeProject();
  const screenId = String(input.screenId ?? "");
  const html = useUIScreens.getState().exportHtml(project, screenId);
  if (!html) return { ok: false, error: `screen ${screenId} not found` };
  return { ok: true, data: { screenId, html, byteLength: html.length } };
};

// ── Bundled exports ──────────────────────────────────────────────────

export const defs: ToolDef[] = [
  LIST_SCREENS,
  GET_SCREEN,
  LIST_WIDGET_TYPES,
  CREATE_SCREEN,
  RENAME_SCREEN,
  DELETE_SCREEN,
  ADD_WIDGET,
  UPDATE_WIDGET,
  REMOVE_WIDGET,
  EXPORT_HTML,
];

export const handlers: Record<string, ToolHandler> = {
  ui_list_screens: listScreensHandler,
  ui_get_screen: getScreenHandler,
  ui_list_widget_types: listWidgetTypesHandler,
  ui_create_screen: createScreenHandler,
  ui_rename_screen: renameScreenHandler,
  ui_delete_screen: deleteScreenHandler,
  ui_add_widget: addWidgetHandler,
  ui_update_widget: updateWidgetHandler,
  ui_remove_widget: removeWidgetHandler,
  ui_export_html: exportHtmlHandler,
};

export const destructiveToolNames: string[] = [
  "ui_delete_screen",
  "ui_remove_widget",
];
