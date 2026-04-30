import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { bootstrapAuth } from "@/lib/authBootstrap";
import { Toolbar } from "@/editor/Toolbar";
import { Hierarchy } from "@/editor/Hierarchy";
import { Inspector } from "@/editor/Inspector";
import { BottomPanel } from "@/editor/BottomPanel";
import { ProjectPicker } from "@/editor/ProjectPicker";
import { AssetDropZone } from "@/editor/AssetDropZone";
import { AIWorkerPanel } from "@/editor/AIWorkerPanel";
import { ViewportTabBar } from "@/editor/ViewportTabBar";
import { ViewportHost } from "@/editor/ViewportHost";
import { useViewportLaunchQueue } from "@/lib/launchQueue";
import { useEditor } from "@/store/editor";
import { useListProjects } from "@workspace/api-client-react";
import { Sparkles, Plus } from "lucide-react";
import { dispatchHotkey, isInputFocused, type Hotkey } from "@/lib/hotkeys";

function EditorShell() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const projectId = useEditor((s) => s.projectId);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const pushLog = useEditor((s) => s.pushLog);
  const isPlaying = useEditor((s) => s.isPlaying);
  const togglePlay = useEditor((s) => s.togglePlay);

  // Listens for files passed via the OS file-handler ("Open with Grudge
  // GameForge"). Each file is opened in a fresh viewer tab so existing
  // tabs are never disturbed.
  useViewportLaunchQueue();

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

  // Rehydrate the auth store from the session cookie. Runs once on
  // mount; failures are non-fatal (the user just stays anonymous).
  useEffect(() => {
    void bootstrapAuth();
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
                <div className="relative w-full h-full flex flex-col">
                  <ViewportTabBar />
                  <div className="relative flex-1 min-h-0">
                    <ViewportHost />
                    {!projectId && !pickerOpen && (
                      <button
                        onClick={() => setPickerOpen(true)}
                        aria-label="Open or create a project"
                        title="Open or create a project"
                        data-testid="button-open-or-create-project"
                        style={{
                          position: "absolute",
                          right: 16,
                          bottom: 16,
                          zIndex: 50,
                          width: 48,
                          height: 48,
                        }}
                        className="rounded-full bg-primary/15 text-primary border border-primary/40 backdrop-blur flex items-center justify-center shadow-2xl hover-elevate"
                      >
                        <Plus className="size-6" />
                      </button>
                    )}
                  </div>
                </div>
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
