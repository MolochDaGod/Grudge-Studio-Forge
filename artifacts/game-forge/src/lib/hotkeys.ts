/**
 * Centralized hotkey registry. Keeping the list in one place lets us:
 *   - Render a "?" cheatsheet later
 *   - Avoid silent shortcut collisions across panels
 *   - Document each binding for maintainers
 *
 * Bindings are matched against `KeyboardEvent.key` (case-insensitive for
 * single letters) plus optional modifier flags. Returning `true` from the
 * action means "handled, preventDefault".
 */

export type HotkeyAction = (e: KeyboardEvent) => boolean | void;

export type HotkeyCategory =
  | "Gizmo"
  | "Camera"
  | "Selection"
  | "Edit"
  | "Playback"
  | "Scene"
  | "Panel"
  | "View"
  | "Misc";

export interface Hotkey {
  id: string;
  /** What the user sees in the cheatsheet, e.g. "Ctrl+Z". */
  label: string;
  /** What it does, plain English. */
  description: string;
  /** Grouping bucket for the `?` cheatsheet overlay. Defaults to "Misc". */
  category?: HotkeyCategory;
  /** Match: lowercase letter or named key ("Escape", "Delete", " ", "1"). */
  key: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  /** Fire even while playing? Defaults to false (most editor hotkeys). */
  whilePlaying?: boolean;
  /** Skip when typing in inputs. Default true — only set false for Escape. */
  ignoreInInputs?: boolean;
  action: HotkeyAction;
}

export interface HotkeyMatchEnv {
  isPlaying: boolean;
  inInputField: boolean;
}

export function isInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function matches(h: Hotkey, e: KeyboardEvent): boolean {
  const wantCtrl = !!h.ctrlOrMeta;
  const hasCtrl = e.ctrlKey || e.metaKey;
  if (wantCtrl !== hasCtrl) return false;
  const wantShift = !!h.shift;
  if (wantShift !== e.shiftKey) return false;
  // Single letters: case-insensitive
  if (h.key.length === 1 && /[a-zA-Z]/.test(h.key)) {
    return e.key.toLowerCase() === h.key.toLowerCase();
  }
  return e.key === h.key;
}

export function dispatchHotkey(
  hotkeys: Hotkey[],
  e: KeyboardEvent,
  env: HotkeyMatchEnv,
): boolean {
  for (const h of hotkeys) {
    if (!h.whilePlaying && env.isPlaying) continue;
    if ((h.ignoreInInputs ?? true) && env.inInputField) continue;
    if (!matches(h, e)) continue;
    const handled = h.action(e);
    if (handled !== false) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}
