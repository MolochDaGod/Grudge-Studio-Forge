/**
 * Editor hotkey registry — single source of truth for both the keydown
 * dispatcher (in App.tsx) and the `?` cheatsheet overlay (in
 * editor/HotkeyCheatsheet.tsx).
 *
 * Keeping the list here means the cheatsheet automatically stays in
 * sync as new hotkeys are added: whoever adds a binding picks the
 * category, label, and description once and both surfaces pick it up.
 */

import { useEditor } from "@/store/editor";
import type { Hotkey } from "@/lib/hotkeys";
import { copySelectedEntity, pasteEntityClipboard } from "@/lib/entityClipboard";

/** Dependency callbacks the keydown actions need beyond the global store.
 *  Pulled into a typed shape so the cheatsheet can call this builder with
 *  no-op deps just to harvest the descriptor metadata. */
export interface EditorHotkeyDeps {
  /** Toggle the `?` cheatsheet overlay. */
  toggleCheatsheet: () => void;
}

/**
 * Build the editor's hotkey list. The returned array is the single
 * source of truth — the dispatcher iterates it for matches; the
 * cheatsheet iterates it again to render labels grouped by category.
 *
 * IMPORTANT: We deliberately DO NOT bind Space here. Space is the
 * canonical "jump" key in nearly every game and is exposed to user
 * scripts via `ctx.keys[' ']` / `ctx.keys.Space` — if the editor
 * swallowed it, jump would never reach the running game. Use `P` to
 * toggle play/stop, and `Escape` as an emergency stop while in Play
 * mode (matches three.js editor and most engines).
 */
export function buildEditorHotkeys(deps: EditorHotkeyDeps): Hotkey[] {
  const get = useEditor.getState;
  return [
    // --- Gizmo modes
    {
      id: "gizmo.translate",
      label: "W",
      description: "Translate gizmo",
      category: "Gizmo",
      key: "w",
      action: () => {
        get().setTransformMode("translate");
      },
    },
    {
      id: "gizmo.rotate",
      label: "E",
      description: "Rotate gizmo",
      category: "Gizmo",
      key: "e",
      action: () => {
        get().setTransformMode("rotate");
      },
    },
    {
      id: "gizmo.scale",
      label: "R",
      description: "Scale gizmo",
      category: "Gizmo",
      key: "r",
      action: () => {
        get().setTransformMode("scale");
      },
    },
    {
      id: "gizmo.groundSnap",
      label: "Shift+Ctrl (hold)",
      description:
        "While dragging the translate gizmo, snap entity Y to the ground beneath",
      category: "Gizmo",
      // Pseudo-entry: there's no keydown to fire — the modifier is read
      // live in the viewport's TransformControls handler. Listed here so
      // the cheatsheet documents the behavior. Key set to a value that
      // can never match a printable keystroke.
      key: "__ground_snap_modifier__",
      action: () => false,
    },

    // --- Playback
    {
      id: "play.toggle",
      label: "P",
      description: "Toggle play / stop",
      category: "Playback",
      key: "p",
      whilePlaying: true,
      action: (e) => {
        if (e.repeat) return false;
        get().togglePlay();
        return true;
      },
    },
    {
      id: "play.escape",
      label: "Esc",
      description: "Stop play mode",
      category: "Playback",
      key: "Escape",
      whilePlaying: true,
      action: () => {
        if (!get().isPlaying) return false;
        get().togglePlay();
        return true;
      },
    },

    // --- Undo / redo
    {
      id: "edit.undo",
      label: "Ctrl+Z",
      description: "Undo last action",
      category: "Edit",
      key: "z",
      ctrlOrMeta: true,
      action: () => {
        const label = get().commandStack.undo();
        if (label) get().pushLog("info", `Undo: ${label}`);
      },
    },
    {
      id: "edit.redo.shift",
      label: "Ctrl+Shift+Z",
      description: "Redo",
      category: "Edit",
      key: "z",
      ctrlOrMeta: true,
      shift: true,
      action: () => {
        const label = get().commandStack.redo();
        if (label) get().pushLog("info", `Redo: ${label}`);
      },
    },
    {
      id: "edit.redo.y",
      label: "Ctrl+Y",
      description: "Redo (alt)",
      category: "Edit",
      key: "y",
      ctrlOrMeta: true,
      action: () => {
        const label = get().commandStack.redo();
        if (label) get().pushLog("info", `Redo: ${label}`);
      },
    },

    // --- Selection actions
    {
      id: "edit.delete",
      label: "Delete",
      description: "Delete selected entity",
      category: "Selection",
      key: "Delete",
      action: () => {
        const id = get().selectedId;
        if (!id) return false;
        get().cmdRemoveEntity(id);
        return true;
      },
    },
    {
      id: "edit.copy",
      label: "Ctrl+C",
      description: "Copy selected entity (+ hierarchy children)",
      category: "Edit",
      key: "c",
      ctrlOrMeta: true,
      action: () => {
        if (!get().selectedId) return false;
        return copySelectedEntity();
      },
    },
    {
      id: "edit.paste",
      label: "Ctrl+V",
      description: "Paste entity clipboard",
      category: "Edit",
      key: "v",
      ctrlOrMeta: true,
      action: () => {
        // Async clipboard read — fire and handle; hotkey system is sync
        void pasteEntityClipboard();
        return true;
      },
    },
    {
      id: "edit.duplicate",
      label: "Ctrl+D",
      description: "Duplicate selected entity",
      category: "Selection",
      key: "d",
      ctrlOrMeta: true,
      action: () => {
        const id = get().selectedId;
        if (!id) return false;
        get().cmdDuplicateEntity(id);
        return true;
      },
    },
    {
      id: "view.focus",
      label: "F",
      description: "Frame selected — keeps look direction (never auto)",
      category: "Camera",
      key: "f",
      action: () => {
        if (!get().selectedId) return false;
        get().requestFocus();
        return true;
      },
    },
    {
      id: "gizmo.ground",
      label: "G",
      description: "Snap selected to terrain (does not move camera)",
      category: "Gizmo",
      key: "g",
      action: () => {
        if (!get().selectedId) return false;
        get().requestGroundSnap();
        return true;
      },
    },
    {
      id: "edit.hide",
      label: "H",
      description: "Hide / show selected",
      category: "Selection",
      key: "h",
      action: () => {
        const id = get().selectedId;
        if (!id) return false;
        const e = get().sceneData.entities.find((x) => x.id === id);
        if (!e) return false;
        get().cmdSetEntityVisible(id, e.visible === false);
        return true;
      },
    },
    {
      id: "edit.unparent",
      label: "Ctrl+P",
      description: "Unparent selected (move to root)",
      category: "Selection",
      key: "p",
      ctrlOrMeta: true,
      action: () => {
        const id = get().selectedId;
        if (!id) return false;
        get().cmdSetEntityParent(id, null);
        return true;
      },
    },

    // --- Save (handled by Toolbar, dispatched as a window event)
    {
      id: "scene.save",
      label: "Ctrl+S",
      description: "Save scene / prefab",
      category: "Scene",
      key: "s",
      ctrlOrMeta: true,
      action: () => {
        window.dispatchEvent(new CustomEvent("gameforge:save"));
      },
    },

    // --- Forge selection as prefab (handled by Hierarchy)
    {
      id: "scene.forgePrefab",
      label: "Ctrl+G",
      description: "Forge selection as prefab",
      category: "Scene",
      key: "g",
      ctrlOrMeta: true,
      action: () => {
        const id = get().selectedId;
        if (!id) return false;
        window.dispatchEvent(
          new CustomEvent("gameforge:forgePrefab", { detail: { entityId: id } }),
        );
        return true;
      },
    },

    // --- Bottom panel tab shortcuts
    {
      id: "panel.console",
      label: "Ctrl+`",
      description: "Focus Console tab",
      category: "Panel",
      key: "`",
      ctrlOrMeta: true,
      action: () => {
        get().setBottomTab("console");
        return true;
      },
    },
    {
      id: "panel.scripts",
      label: "Ctrl+Shift+S",
      description: "Focus Scripts tab",
      category: "Panel",
      key: "s",
      ctrlOrMeta: true,
      shift: true,
      action: () => {
        get().setBottomTab("scripts");
        return true;
      },
    },
    {
      id: "panel.nodes",
      label: "Ctrl+Shift+N",
      description: "Focus Nodes tab",
      category: "Panel",
      key: "n",
      ctrlOrMeta: true,
      shift: true,
      action: () => {
        get().setBottomTab("nodes");
        return true;
      },
    },
    {
      id: "panel.library",
      label: "Ctrl+Shift+A",
      description: "Focus Library (Assets) tab",
      category: "Panel",
      key: "a",
      ctrlOrMeta: true,
      shift: true,
      action: () => {
        get().setBottomTab("assets");
        return true;
      },
    },
    {
      id: "panel.physics",
      label: "Ctrl+Shift+L",
      description: "Focus Physics (Layers) tab",
      category: "Panel",
      key: "l",
      ctrlOrMeta: true,
      shift: true,
      action: () => {
        get().setBottomTab("layers");
        return true;
      },
    },

    // --- View / cheatsheet
    {
      id: "view.cheatsheet",
      label: "?",
      description: "Show keyboard shortcuts",
      category: "View",
      key: "?",
      shift: true,
      action: () => {
        deps.toggleCheatsheet();
        return true;
      },
    },
  ];
}
