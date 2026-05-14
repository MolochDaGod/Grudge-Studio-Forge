/**
 * Default props + sizing per widget type, used by the palette (drag/drop a
 * fresh tile) and by the AI `ui_add_widget` tool when the model omits
 * optional fields. Keep defaults visually meaningful so a brand-new widget
 * is immediately recognisable on the canvas.
 */
import { nanoid } from "nanoid";
import type {
  Widget,
  WidgetType,
  PanelProps,
  TextProps,
  BarProps,
  ButtonProps,
  CircleButtonProps,
  HotbarProps,
  ImageProps,
} from "./types";

export interface WidgetDefault {
  w: number;
  h: number;
  props: Record<string, unknown>;
}

const PANEL: PanelProps = { variant: "stone", rivets: true, padding: 12 };
const TEXT: TextProps = {
  content: "Text",
  size: "md",
  color: "#f5e2c1",
  weight: 400,
  align: "left",
};
const BAR: BarProps = { kind: "hp", value: 78, showLabel: true, label: "HP" };
const BUTTON: ButtonProps = { label: "Action", variant: "primary" };
const CIRCLE: CircleButtonProps = { glyph: "⚔", active: false };
const HOTBAR: HotbarProps = { slots: 8, gap: 4, showKeys: true };
const IMAGE: ImageProps = { src: "", fit: "contain", alt: "" };

export const WIDGET_DEFAULTS: Record<WidgetType, WidgetDefault> = {
  panel: { w: 320, h: 200, props: PANEL as unknown as Record<string, unknown> },
  text: { w: 200, h: 28, props: TEXT as unknown as Record<string, unknown> },
  bar: { w: 200, h: 14, props: BAR as unknown as Record<string, unknown> },
  button: { w: 120, h: 36, props: BUTTON as unknown as Record<string, unknown> },
  "circle-button": {
    w: 36,
    h: 36,
    props: CIRCLE as unknown as Record<string, unknown>,
  },
  hotbar: {
    w: 8 * 48 + 7 * 4 + 16,
    h: 64,
    props: HOTBAR as unknown as Record<string, unknown>,
  },
  image: { w: 120, h: 120, props: IMAGE as unknown as Record<string, unknown> },
};

export const WIDGET_LABEL: Record<WidgetType, string> = {
  panel: "Panel",
  text: "Text",
  bar: "Bar",
  button: "Button",
  "circle-button": "Circle Button",
  hotbar: "Hotbar",
  image: "Image",
};

export function createWidget(
  type: WidgetType,
  pos: { x: number; y: number } = { x: 40, y: 40 },
  patch?: Partial<Pick<Widget, "w" | "h" | "name">> & {
    props?: Record<string, unknown>;
  },
): Widget {
  const def = WIDGET_DEFAULTS[type];
  return {
    id: nanoid(8),
    type,
    name: patch?.name ?? WIDGET_LABEL[type],
    x: pos.x,
    y: pos.y,
    w: patch?.w ?? def.w,
    h: patch?.h ?? def.h,
    props: { ...def.props, ...(patch?.props ?? {}) },
  };
}

export const WIDGET_TYPES: readonly WidgetType[] = [
  "panel",
  "hotbar",
  "bar",
  "button",
  "circle-button",
  "text",
  "image",
] as const;
