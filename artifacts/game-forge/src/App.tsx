import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { UpdateToast } from "@/editor/UpdateToast";
import { BakeProgressToasts } from "@/editor/BakeProgressToasts";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { bootstrapAuth, installStudioSsoHydrateListener } from "@/lib/authBootstrap";
import { Toolbar } from "@/editor/Toolbar";
import { MenuBar } from "@/editor/MenuBar";
import { Hierarchy } from "@/editor/Hierarchy";
import { Inspector } from "@/editor/Inspector";
import { BottomPanel } from "@/editor/BottomPanel";
import { ProjectPicker } from "@/editor/ProjectPicker";
import { AssetDropZone } from "@/editor/AssetDropZone";
import { AIWorkerPanel } from "@/editor/AIWorkerPanel";
import { WelcomeModal } from "@/editor/WelcomeModal";
import { ViewportTabBar } from "@/editor/ViewportTabBar";
import { ViewportHost } from "@/editor/ViewportHost";
import { useViewportLaunchQueue } from "@/lib/launchQueue";
import { useEditor } from "@/store/editor";
import { startEcsSync } from "@/lib/ecs";
import {
  useEditorAutosave,
  useEditorDraftMirror,
  useUnsavedChangesGuard,
  useGlobalErrorCapture,
} from "@/lib/editorPersistence";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { useListProjects } from "@workspace/api-client-react";
import { Sparkles, Plus } from "lucide-react";
import { dispatchHotkey, isInputFocused } from "@/lib/hotkeys";
import { buildEditorHotkeys } from "@/lib/editorHotkeys";
import { HotkeyCheatsheet } from "@/editor/HotkeyCheatsheet";

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

  // Persistence + crash-resilience layer:
  //   - autosave 2 s after any dirty mutation (existing scene / prefab only)
  //   - mirror sceneData into localStorage every 500 ms as a crash backup
  //   - prompt before tab close while there are unsaved changes
  //   - route uncaught errors / unhandled rejections into the editor console
  // See @/lib/editorPersistence for the rationale on each piece.
  useEditorAutosave();
  useEditorDraftMirror();
  useUnsavedChangesGuard();
  useGlobalErrorCapture();

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

  // Published-scene auto-loader.
  //
  // When someone opens a Puter-hosted scene, the bootstrapper redirects
  // here with `?scene=<absolute-url>`. We fetch the JSON, install it into
  // the editor (without a sceneId — it's transient), and immediately
  // enter play mode. The query param is then stripped from the URL so a
  // refresh doesn't re-fetch (and so the user can keep editing without
  // a stale URL). Failures only log; we never block the editor on a
  // bad shared URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sceneUrl = params.get("scene");
    if (!sceneUrl) return;
    // ?edit=1 (or edit=true) keeps the editor editable — do not auto-enter play.
    // Used by gameopen / fleet deep links for AI-assisted authoring.
    const editMode =
      params.get("edit") === "1" ||
      params.get("edit") === "true" ||
      params.get("mode") === "edit";
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(sceneUrl, { mode: "cors" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { entities?: unknown; environment?: unknown };
        if (cancelled) return;
        if (!data || !Array.isArray(data.entities)) {
          throw new Error("Scene JSON missing 'entities' array");
        }
        const store = useEditor.getState();
        // command-stack: bypass — load of a published scene from URL is a
        // wholesale scene replace, not an undoable user edit.
        store.setSceneData({
          entities: data.entities as never,
          environment: (data.environment as never) ?? {},
        });
        store.setSceneName(editMode ? "Loaded Scene (Edit)" : "Published Scene");
        store.setPlaying(!editMode);
        store.pushLog(
          "info",
          `Loaded scene from ${sceneUrl}${editMode ? " · edit mode (AI + inspector ready)" : " · play mode"}`,
        );
      } catch (err) {
        if (!cancelled) {
          pushLog("error", `Failed to load shared scene: ${(err as Error).message}`);
        }
      } finally {
        // Strip ?scene= / ?edit= so a refresh keeps the now-live scene rather
        // than re-fetching (and the URL stays clean for the user).
        const url = new URL(window.location.href);
        url.searchParams.delete("scene");
        url.searchParams.delete("edit");
        url.searchParams.delete("mode");
        window.history.replaceState({}, "", url.toString());
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rehydrate the auth store from the session cookie. Runs once on
  // mount; failures are non-fatal (the user just stays anonymous).
  // Also listen for Grudge Studio (dev tool) SSO hydrate after inject.
  useEffect(() => {
    void bootstrapAuth();
    return installStudioSsoHydrateListener();
  }, []);

  // Mirror the scene store into the miniplex ECS so AI bulk queries
  // (count_entities / query_entities) stay O(1) regardless of how many
  // entities the user / AI spawn. Idempotent + cleans up on unmount so
  // StrictMode's double-invocation is safe.
  useEffect(() => {
    return startEcsSync();
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
    const HOTKEYS = buildEditorHotkeys({
      toggleCheatsheet: () =>
        window.dispatchEvent(new CustomEvent("gameforge:toggleHotkeyCheatsheet")),
    });

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
      <MenuBar
        onOpenProjects={() => setPickerOpen(true)}
        onToggleAIWorker={() => setAiOpen((v) => !v)}
      />
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

      <WelcomeModal />

      <AIWorkerPanel open={aiOpen} onClose={() => setAiOpen(false)} />

      <HotkeyCheatsheet />

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
        {/* AppErrorBoundary contains EditorShell only — toasts and the
            update toast must keep working even if the shell crashes,
            so they live OUTSIDE the boundary. */}
        <AppErrorBoundary>
          <EditorShell />
        </AppErrorBoundary>
        <Toaster />
        <BakeProgressToasts />
        <UpdateToast />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
