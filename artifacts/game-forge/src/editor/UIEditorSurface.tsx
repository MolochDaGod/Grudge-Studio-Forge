/**
 * UIEditorSurface — the 2D HUD design tab.
 *
 * Three panes inside a single ViewportTab:
 *   ┌────────┬───────────────────────┬──────────┐
 *   │palette │ canvas (scaled, snap) │ inspector│
 *   └────────┴───────────────────────┴──────────┘
 *
 * Selection / drag / resize are pointer-event based and write to the
 * shared `useUIScreens` store so the AI tools (`ui_update_widget` etc.)
 * and the inspector see the same source of truth. We deliberately mount
 * the same `<ScreenView>` renderer used by the HTML exporter so what
 * the user sees in the editor is exactly what the export emits.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Download, Layout, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useUIScreens, type ProjectKey } from "@/store/uiScreens";
import {
  WIDGET_DEFAULTS,
  WIDGET_LABEL,
  WIDGET_TYPES,
} from "@/lib/uiScreen/defaults";
import { ScreenView } from "@/lib/uiScreen/widgets";
import {
  ensureGrudgeThemeInjected,
  FONT_LINK_HREF,
} from "@/lib/uiScreen/theme";
import type { Widget, WidgetType } from "@/lib/uiScreen/types";

const SNAP = 4;
const ZOOM_PRESETS: Array<number | "fit"> = [0.25, 0.5, 1, "fit"];

const snap = (n: number) => Math.round(n / SNAP) * SNAP;

interface UIScreenTabPayload {
  screenId: string;
  screenName: string;
  project: ProjectKey;
}

export interface UIEditorSurfaceProps {
  payload: UIScreenTabPayload;
  tabId: string;
}

type DragMode =
  | { kind: "idle" }
  | {
      kind: "move";
      widgetId: string;
      pointerStart: { x: number; y: number };
      widgetStart: { x: number; y: number };
    }
  | {
      kind: "resize";
      widgetId: string;
      pointerStart: { x: number; y: number };
      widgetStart: { x: number; y: number; w: number; h: number };
    };

/** Inject the Cinzel/Crimson/JetBrains Mono link tag once per session. The
 *  exporter writes the same href, so the live editor matches the export. */
function useFontLink() {
  useEffect(() => {
    const id = "gw-font-link";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = FONT_LINK_HREF;
    document.head.appendChild(link);
  }, []);
}

export function UIEditorSurface({ payload }: UIEditorSurfaceProps) {
  const { project, screenId } = payload;

  // Subscribe directly to the screen list so any mutation (palette add,
  // AI tool, inspector edit) re-renders the canvas without an extra
  // selector layer.
  const screen = useUIScreens((s) =>
    (s.byProject[String(project)] ?? []).find((x) => x.id === screenId),
  );
  const selectedWidgetId = useUIScreens((s) => s.selectedWidgetId);
  const setSelected = useUIScreens((s) => s.setSelected);
  const addWidget = useUIScreens((s) => s.addWidget);
  const updateWidget = useUIScreens((s) => s.updateWidget);
  const removeWidget = useUIScreens((s) => s.removeWidget);
  const bringToFront = useUIScreens((s) => s.bringToFront);
  const renameScreen = useUIScreens((s) => s.renameScreen);
  const downloadHtml = useUIScreens((s) => s.downloadHtml);

  ensureGrudgeThemeInjected();
  useFontLink();

  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [drag, setDrag] = useState<DragMode>({ kind: "idle" });
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  // Track the scrollable frame's client size so "Fit" can recompute
  // when the user opens/closes other panels.
  useEffect(() => {
    const el = canvasFrameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const effectiveZoom = useMemo(() => {
    if (!screen) return 1;
    if (zoom !== "fit") return zoom;
    if (!frameSize.w || !frameSize.h) return 0.5;
    const pad = 48;
    const sx = (frameSize.w - pad) / screen.width;
    const sy = (frameSize.h - pad) / screen.height;
    return Math.max(0.1, Math.min(1, Math.min(sx, sy)));
  }, [zoom, frameSize, screen]);

  // Keyboard: Delete removes the selected widget. Scoped to the surface
  // root via tabIndex so it doesn't fight with global hotkeys.
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedWidgetId &&
        screen
      ) {
        e.preventDefault();
        removeWidget(project, screen.id, selectedWidgetId);
      }
      if (e.key === "Escape") setSelected(null);
    };
    const el = surfaceRef.current;
    if (!el) return;
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [selectedWidgetId, screen, removeWidget, setSelected, project]);

  if (!screen) {
    return (
      <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground bg-background grid-pattern">
        UI screen not found. It may have been deleted.
      </div>
    );
  }

  // ── Pointer handlers (canvas-coordinate space, design pixels) ──────
  const startMove = (e: ReactPointerEvent, w: Widget) => {
    e.stopPropagation();
    setSelected(w.id);
    bringToFront(project, screen.id, w.id);
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({
      kind: "move",
      widgetId: w.id,
      pointerStart: { x: e.clientX, y: e.clientY },
      widgetStart: { x: w.x, y: w.y },
    });
  };

  const startResize = (e: ReactPointerEvent, w: Widget) => {
    e.stopPropagation();
    setSelected(w.id);
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({
      kind: "resize",
      widgetId: w.id,
      pointerStart: { x: e.clientX, y: e.clientY },
      widgetStart: { x: w.x, y: w.y, w: w.w, h: w.h },
    });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (drag.kind === "idle") return;
    const dx = (e.clientX - drag.pointerStart.x) / effectiveZoom;
    const dy = (e.clientY - drag.pointerStart.y) / effectiveZoom;
    if (drag.kind === "move") {
      updateWidget(project, screen.id, drag.widgetId, {
        x: snap(drag.widgetStart.x + dx),
        y: snap(drag.widgetStart.y + dy),
      });
    } else if (drag.kind === "resize") {
      updateWidget(project, screen.id, drag.widgetId, {
        w: Math.max(SNAP * 2, snap(drag.widgetStart.w + dx)),
        h: Math.max(SNAP * 2, snap(drag.widgetStart.h + dy)),
      });
    }
  };
  const onPointerUp = () => setDrag({ kind: "idle" });

  const selected = screen.widgets.find((w) => w.id === selectedWidgetId);

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="w-full h-full flex flex-col bg-background outline-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
        <Layout className="size-4 text-muted-foreground" />
        <Input
          value={screen.name}
          onChange={(e) => renameScreen(project, screen.id, e.target.value)}
          className="h-8 w-56"
          data-testid="ui-screen-name"
        />
        <span className="text-xs text-muted-foreground">
          {screen.width}×{screen.height}
        </span>
        <div className="flex-1" />
        <Label className="text-xs text-muted-foreground">Zoom</Label>
        <Select
          value={String(zoom)}
          onValueChange={(v) => setZoom(v === "fit" ? "fit" : Number(v))}
        >
          <SelectTrigger className="h-8 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZOOM_PRESETS.map((z) => (
              <SelectItem key={String(z)} value={String(z)}>
                {z === "fit" ? "Fit" : `${Math.round(z * 100)}%`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="default"
          onClick={() => downloadHtml(project, screen.id)}
          data-testid="ui-export-html"
        >
          <Download className="size-4 mr-1" />
          Export HTML
        </Button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ── Palette ───────────────────────────────────────────── */}
        <div className="w-48 border-r bg-card/40 flex flex-col">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            Widgets
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 grid grid-cols-1 gap-1">
              {WIDGET_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const w = addWidget(project, screen.id, t, {
                      x: 80,
                      y: 80,
                    });
                    if (w) setSelected(w.id);
                  }}
                  className="flex items-center gap-2 px-2 py-2 rounded border bg-background hover:bg-accent text-left text-sm"
                  data-testid={`palette-add-${t}`}
                >
                  <Plus className="size-3.5 text-muted-foreground" />
                  {WIDGET_LABEL[t]}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* ── Canvas ────────────────────────────────────────────── */}
        <div
          ref={canvasFrameRef}
          className="flex-1 min-w-0 overflow-auto bg-neutral-950/40 grid-pattern relative"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div
            className="relative mx-auto my-6"
            style={{
              width: screen.width * effectiveZoom,
              height: screen.height * effectiveZoom,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: screen.width,
                height: screen.height,
                transform: `scale(${effectiveZoom})`,
                transformOrigin: "top left",
                background:
                  "repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 32px), repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 32px), #1a1614",
                outline: "1px solid rgba(180, 140, 70, 0.4)",
              }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setSelected(null);
              }}
            >
              <ScreenView screen={screen} />
              {/* Selection / drag overlay — one absolutely-positioned
                   div per widget on top of the rendered widget. */}
              {screen.widgets.map((w) => {
                const isSelected = w.id === selectedWidgetId;
                const overlay: CSSProperties = {
                  position: "absolute",
                  left: w.x,
                  top: w.y,
                  width: w.w,
                  height: w.h,
                  cursor: "move",
                  border: isSelected
                    ? "2px solid #d4a64a"
                    : "1px dashed rgba(255,255,255,0.08)",
                  background: "transparent",
                  boxSizing: "border-box",
                };
                return (
                  <div
                    key={w.id}
                    style={overlay}
                    onPointerDown={(e) => startMove(e, w)}
                    data-testid={`ui-widget-${w.id}`}
                  >
                    {isSelected && (
                      <div
                        onPointerDown={(e) => startResize(e, w)}
                        style={{
                          position: "absolute",
                          right: -6,
                          bottom: -6,
                          width: 12,
                          height: 12,
                          background: "#d4a64a",
                          border: "2px solid #1a1614",
                          cursor: "nwse-resize",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Inspector ─────────────────────────────────────────── */}
        <div className="w-72 border-l bg-card/40 flex flex-col">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground border-b">
            Inspector
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              {!selected && (
                <p className="text-xs text-muted-foreground">
                  Select a widget on the canvas to edit its properties.
                </p>
              )}
              {selected && (
                <Inspector
                  key={selected.id}
                  widget={selected}
                  onChange={(patch) =>
                    updateWidget(project, screen.id, selected.id, patch)
                  }
                  onDelete={() =>
                    removeWidget(project, screen.id, selected.id)
                  }
                />
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

// ── Inspector ────────────────────────────────────────────────────────

interface InspectorProps {
  widget: Widget;
  onChange: (
    patch: Partial<Omit<Widget, "id" | "type">> & {
      props?: Record<string, unknown>;
    },
  ) => void;
  onDelete: () => void;
}

function NumField({
  label,
  value,
  onChange,
  testid,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  testid?: string;
}) {
  return (
    <div className="flex-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8 mt-1"
        data-testid={testid}
      />
    </div>
  );
}

function Inspector({ widget, onChange, onDelete }: InspectorProps) {
  const def = WIDGET_DEFAULTS[widget.type as WidgetType];
  const props = { ...def.props, ...widget.props } as Record<string, unknown>;

  const setProp = (key: string, value: unknown) =>
    onChange({ props: { ...widget.props, [key]: value } });

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Name
        </Label>
        <Input
          value={widget.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-8 mt-1"
          data-testid="ui-inspector-name"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {WIDGET_LABEL[widget.type as WidgetType]} · {widget.id}
        </p>
      </div>

      <div className="flex gap-2">
        <NumField
          label="X"
          value={widget.x}
          onChange={(n) => onChange({ x: n })}
          testid="ui-inspector-x"
        />
        <NumField
          label="Y"
          value={widget.y}
          onChange={(n) => onChange({ y: n })}
          testid="ui-inspector-y"
        />
      </div>
      <div className="flex gap-2">
        <NumField
          label="W"
          value={widget.w}
          onChange={(n) => onChange({ w: Math.max(8, n) })}
          testid="ui-inspector-w"
        />
        <NumField
          label="H"
          value={widget.h}
          onChange={(n) => onChange({ h: Math.max(8, n) })}
          testid="ui-inspector-h"
        />
      </div>

      <div className="border-t pt-3 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Properties
        </div>
        <PropFields
          type={widget.type as WidgetType}
          props={props}
          setProp={setProp}
        />
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        className="w-full"
        data-testid="ui-inspector-delete"
      >
        <Trash2 className="size-4 mr-1" />
        Delete widget
      </Button>
    </div>
  );
}

/** Per-type prop fields. We render the small fixed prop bag from
 *  `WIDGET_DEFAULTS` rather than a fully dynamic schema so the inspector
 *  feels purpose-built for each widget. */
function PropFields({
  type,
  props,
  setProp,
}: {
  type: WidgetType;
  props: Record<string, unknown>;
  setProp: (key: string, value: unknown) => void;
}) {
  const str = (k: string) => (typeof props[k] === "string" ? (props[k] as string) : "");
  const num = (k: string) =>
    typeof props[k] === "number" ? (props[k] as number) : 0;
  const bool = (k: string) => Boolean(props[k]);

  const StringField = (k: string, label: string) => (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        value={str(k)}
        onChange={(e) => setProp(k, e.target.value)}
        className="h-8 mt-1"
      />
    </div>
  );
  const SelectField = (k: string, label: string, opts: string[]) => (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Select value={str(k) || opts[0]} onValueChange={(v) => setProp(k, v)}>
        <SelectTrigger className="h-8 mt-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const NumberField = (k: string, label: string) => (
    <NumField
      label={label}
      value={num(k)}
      onChange={(n) => setProp(k, n)}
    />
  );
  const SwitchField = (k: string, label: string) => (
    <div className="flex items-center justify-between">
      <Label className="text-xs">{label}</Label>
      <Switch checked={bool(k)} onCheckedChange={(v) => setProp(k, v)} />
    </div>
  );

  switch (type) {
    case "panel":
      return (
        <div className="space-y-2">
          {SelectField("variant", "Variant", ["stone", "dark", "ghost"])}
          {SwitchField("rivets", "Rivets")}
          {NumberField("padding", "Padding")}
        </div>
      );
    case "text":
      return (
        <div className="space-y-2">
          {StringField("content", "Content")}
          {SelectField("size", "Size", ["sm", "md", "lg", "title"])}
          {SelectField("align", "Align", ["left", "center", "right"])}
          {StringField("color", "Color")}
        </div>
      );
    case "bar":
      return (
        <div className="space-y-2">
          {SelectField("kind", "Kind", ["hp", "mp", "sp", "xp"])}
          {NumberField("value", "Value (0-100)")}
          {SwitchField("showLabel", "Show label")}
          {StringField("label", "Label")}
        </div>
      );
    case "button":
      return (
        <div className="space-y-2">
          {StringField("label", "Label")}
          {SelectField("variant", "Variant", [
            "primary",
            "secondary",
            "ghost",
          ])}
          {StringField("keyHint", "Key hint")}
        </div>
      );
    case "circle-button":
      return (
        <div className="space-y-2">
          {StringField("glyph", "Glyph")}
          {SwitchField("active", "Active")}
          {StringField("keyHint", "Key hint")}
        </div>
      );
    case "hotbar":
      return (
        <div className="space-y-2">
          {NumberField("slots", "Slots")}
          {NumberField("gap", "Gap (px)")}
          {SwitchField("showKeys", "Show keys")}
        </div>
      );
    case "image":
      return (
        <div className="space-y-2">
          {StringField("src", "Src URL")}
          {SelectField("fit", "Fit", ["contain", "cover", "fill"])}
          {StringField("alt", "Alt text")}
        </div>
      );
  }
}
