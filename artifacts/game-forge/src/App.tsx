import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { lazy, Suspense, useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { Toolbar } from "@/editor/Toolbar";
import { Hierarchy } from "@/editor/Hierarchy";
import { Inspector } from "@/editor/Inspector";
import { BottomPanel } from "@/editor/BottomPanel";
import { ProjectPicker } from "@/editor/ProjectPicker";
import { AssetDropZone } from "@/editor/AssetDropZone";
import { AIWorkerPanel } from "@/editor/AIWorkerPanel";
import { useEditor } from "@/store/editor";
import { useListProjects } from "@workspace/api-client-react";
import { Sparkles, Plus } from "lucide-react";
import { dispatchHotkey, isInputFocused, type Hotkey } from "@/lib/hotkeys";

/**
 * The 3D viewport drags in three.js, R3F, drei, rapier, and postprocessing —
 * by far the heaviest sub-tree in the editor. Loading it lazily lets the
 * surrounding shell (toolbar, hierarchy, inspector, project picker) paint
 * immediately and shaves the time-to-interactive on first load. The Suspense
 * fallback below sits in the viewport pane while the chunk streams in.
 *
 * Two complementary mechanisms hide that fallback in practice:
 *  1. `main.tsx` calls `schedulePrefetchViewport()` from
 *     `@/lib/prefetch`, which fires this same dynamic import on the next
 *     idle frame.
 *  2. `vite.config.ts`'s `preloadViewportCandidate` plugin emits
 *     `<link rel="modulepreload">` tags for the resulting chunks at
 *     build time so the browser fetches them in parallel with the entry.
 *
 * Both routes go through `@/editor/viewportPreload`, the small re-export
 * "preload candidate" entry. Vite dedupes the dynamic import by
 * specifier, so all three call sites resolve to the same chunk and the
 * second/third invocations hit the module cache on the same tick.
 */
const Viewport = lazy(() =>
  import("@/editor/viewportPreload").then((m) => ({ default: m.Viewport })),
);

function ViewportFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-background grid-pattern">
      <div className="text-xs font-mono text-muted-foreground animate-pulse">
        Loading 3D viewport…
      </div>
    </div>
  );
}

function EditorShell() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const projectId = useEditor((s) => s.projectId);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const pushLog = useEditor((s) => s.pushLog);
  const isPlaying = useEditor((s) => s.isPlaying);
  const togglePlay = useEditor((s) => s.togglePlay);

  const { data: projects } = useListProjects();

  // Auto-open picker if no project loaded
  useEffect(() => {
    if (!projectId && projects && projects.length === 0) {
      setPickerOpen(true);
    }
  }, [projectId, projects]);

  // Welcome log
  useEffect(() => {
    pushLog("info", "GameForge ready · Three.js · Rapier · R3F · Blazor C# transpiler loaded");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Centralized editor hotkeys.
  //
  // IMPORTANT: We deliberately DO NOT bind Space here. Space is the canonical
  // "jump" key in nearly every game and is exposed to user scripts via
  // `ctx.keys[' ']` / `ctx.keys.Space` — if the editor swallowed it, jump
  // would never reach the running game. Use `P` to toggle play/stop, and
  // `Escape` as an emergency stop while in Play mode (matches three.js editor
  // and most engines).
  //
  // The list below is the single source of truth — it can later be rendered
  // as a "?" cheatsheet without re-deriving anything from the handler.
  useEffect(() => {
    const get = useEditor.getState;
    const HOTKEYS: Hotkey[] = [
      // --- Gizmo modes
      { id: "gizmo.translate", label: "W", description: "Translate gizmo", key: "w",
        action: () => { get().setTransformMode("translate"); } },
      { id: "gizmo.rotate", label: "E", description: "Rotate gizmo", key: "e",
        action: () => { get().setTransformMode("rotate"); } },
      { id: "gizmo.scale", label: "R", description: "Scale gizmo", key: "r",
        action: () => { get().setTransformMode("scale"); } },

      // --- Playback
      { id: "play.toggle", label: "P", description: "Toggle play / stop", key: "p",
        whilePlaying: true,
        action: (e) => {
          if (e.repeat) return false;
          get().togglePlay();
          return true;
        } },
      { id: "play.escape", label: "Esc", description: "Stop play mode", key: "Escape",
        whilePlaying: true,
        action: () => {
          if (!get().isPlaying) return false;
          get().togglePlay();
          return true;
        } },

      // --- Undo / redo (Ctrl+Y also accepted as Windows convention)
      { id: "edit.undo", label: "Ctrl+Z", description: "Undo last action", key: "z",
        ctrlOrMeta: true,
        action: () => {
          const label = get().commandStack.undo();
          if (label) get().pushLog("info", `Undo: ${label}`);
        } },
      { id: "edit.redo.shift", label: "Ctrl+Shift+Z", description: "Redo", key: "z",
        ctrlOrMeta: true, shift: true,
        action: () => {
          const label = get().commandStack.redo();
          if (label) get().pushLog("info", `Redo: ${label}`);
        } },
      { id: "edit.redo.y", label: "Ctrl+Y", description: "Redo (alt)", key: "y",
        ctrlOrMeta: true,
        action: () => {
          const label = get().commandStack.redo();
          if (label) get().pushLog("info", `Redo: ${label}`);
        } },

      // --- Selection actions
      { id: "edit.delete", label: "Delete", description: "Delete selected entity", key: "Delete",
        action: () => {
          const id = get().selectedId;
          if (!id) return false;
          get().cmdRemoveEntity(id);
          return true;
        } },
      { id: "edit.duplicate", label: "Ctrl+D", description: "Duplicate selected entity", key: "d",
        ctrlOrMeta: true,
        action: () => {
          const id = get().selectedId;
          if (!id) return false;
          get().cmdDuplicateEntity(id);
          return true;
        } },
      { id: "view.focus", label: "F", description: "Focus camera on selection", key: "f",
        action: () => {
          if (!get().selectedId) return false;
          get().requestFocus();
          return true;
        } },

      // --- Save (handled by Toolbar, dispatched as a window event)
      { id: "scene.save", label: "Ctrl+S", description: "Save scene / prefab", key: "s",
        ctrlOrMeta: true,
        action: () => { window.dispatchEvent(new CustomEvent("gameforge:save")); } },

      // --- Forge selection as prefab (handled by Hierarchy)
      { id: "scene.forgePrefab", label: "Ctrl+G", description: "Forge selection as prefab", key: "g",
        ctrlOrMeta: true,
        action: () => {
          const id = get().selectedId;
          if (!id) return false;
          window.dispatchEvent(new CustomEvent("gameforge:forgePrefab", { detail: { entityId: id } }));
          return true;
        } },
    ];

    const handler = (e: KeyboardEvent) => {
      dispatchHotkey(HOTKEYS, e, {
        isPlaying: get().isPlaying,
        inInputField: isInputFocused(),
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <AssetDropZone>
    <div className="h-screen w-screen flex flex-col overflow-hidden text-foreground">
      <Toolbar
        onOpenProjects={() => setPickerOpen(true)}
        onToggleAIWorker={() => setAiOpen((v) => !v)}
        aiWorkerOpen={aiOpen}
      />

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={70} minSize={30}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={18} minSize={12} maxSize={30}>
                <Hierarchy />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={62}>
                <Suspense fallback={<ViewportFallback />}>
                  <Viewport />
                </Suspense>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={20} minSize={14} maxSize={32}>
                <Inspector />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={30} minSize={12}>
            <BottomPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ProjectPicker open={pickerOpen} onOpenChange={setPickerOpen} />

      <AIWorkerPanel open={aiOpen} onClose={() => setAiOpen(false)} />

      {!projectId && !pickerOpen && (
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="Open or create a project"
          title="Open or create a project"
          data-testid="button-open-or-create-project"
          style={{
            position: "fixed",
            right: 24,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 50,
            width: 48,
            height: 48,
          }}
          className="rounded-full bg-primary/15 text-primary border border-primary/40 backdrop-blur flex items-center justify-center shadow-2xl hover-elevate"
        >
          <Plus className="size-6" />
        </button>
      )}

      {isPlaying && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-accent/20 border border-accent text-accent text-xs font-mono pointer-events-none shadow-lg">
          PLAY MODE · Esc or P to stop · Space is yours (jump)
        </div>
      )}
    </div>
    </AssetDropZone>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EditorShell />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
