/**
 * UI Editor — widget tree types.
 *
 * A `UIScreen` is a flat list of `Widget`s positioned with absolute
 * coordinates inside a fixed-size design canvas (default 1920×1080).
 * Nesting is intentionally NOT supported in PR-1 to keep drag/select/
 * inspector logic trivial — composite widgets like `hotbar` render N
 * slots inline based on their `slots` prop instead of holding child
 * Widget records.
 *
 * The same renderer is used in:
 *   1. The editor canvas (live, selectable, draggable)
 *   2. The exported standalone HTML file (no React, just static markup)
 * so what-you-see is what-you-export.
 */

export type WidgetType =
  | "panel"
  | "text"
  | "bar"
  | "button"
  | "circle-button"
  | "hotbar"
  | "image";

export type BarKind = "hp" | "mp" | "sp" | "xp";
export type PanelVariant = "stone" | "dark" | "ghost";
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type TextSize = "sm" | "md" | "lg" | "title";
export type ImageFit = "contain" | "cover" | "fill";

/** Per-widget-type prop bag. Stored on `Widget.props` as
 *  `Record<string, unknown>` for serialization simplicity; helpers in
 *  `defaults.ts` cast to the typed shapes below. */
export interface PanelProps {
  variant: PanelVariant;
  rivets: boolean;
  padding: number;
}
export interface TextProps {
  content: string;
  size: TextSize;
  color: string;
  weight: 400 | 600 | 700 | 900;
  align: "left" | "center" | "right";
}
export interface BarProps {
  kind: BarKind;
  value: number; // 0..100
  showLabel: boolean;
  label?: string;
}
export interface ButtonProps {
  label: string;
  variant: ButtonVariant;
  keyHint?: string;
}
export interface CircleButtonProps {
  glyph: string;
  active: boolean;
  keyHint?: string;
}
export interface HotbarProps {
  slots: number; // 1..12
  gap: number;
  showKeys: boolean;
}
export interface ImageProps {
  src: string;
  fit: ImageFit;
  alt: string;
}

export interface Widget {
  id: string;
  type: WidgetType;
  name: string;
  /** All coordinates are in design-canvas px relative to the screen origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  props: Record<string, unknown>;
}

export type ThemeId = "grudge";

export interface UIScreen {
  id: string;
  name: string;
  width: number;
  height: number;
  theme: ThemeId;
  widgets: Widget[];
  /** ms epoch — used to sort the screen list newest-first. */
  updatedAt: number;
}
