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

  // Published-scene auto-loader + Pipeline pack import.
  //
  // When someone opens a Puter-hosted scene, the bootstrapper redirects
  // here with `?scene=<absolute-url>`. We fetch the JSON, install it into
  // the editor (without a sceneId — it's transient), and immediately
  // enter play mode. The query param is then stripped from the URL so a
  // refresh doesn't re-fetch (and so the user can keep editing without
  // a stale URL). Failures only log; we never block the editor on a
  // bad shared URL.
  //
  // Pipeline (grudge-pipeline.vercel.app) can also:
  //   • ?asset=<cdn-glb-url>&edit=1 — spawn a single model entity
  //   • ?awaitImport=1&from=pipeline — postMessage handshake for full pack
  //     { entities, environment, scripts[], assets[] }
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sceneUrl = params.get("scene");
    const assetUrl = params.get("asset");
    const awaitImport =
      params.get("awaitImport") === "1" || params.get("from") === "pipeline";
    // ?edit=1 (or edit=true) keeps the editor editable — do not auto-enter play.
    // Used by gameopen / fleet deep links for AI-assisted authoring.
    const editMode =
      params.get("edit") === "1" ||
      params.get("edit") === "true" ||
      params.get("mode") === "edit" ||
      awaitImport;
    let cancelled = false;

    const applyScene = (
      data: {
        entities?: unknown;
        environment?: unknown;
        _pipelinePack?: { scripts?: unknown[]; assets?: unknown[]; name?: string };
      },
      label: string,
    ) => {
      if (!data || !Array.isArray(data.entities)) {
        throw new Error("Scene JSON missing 'entities' array");
      }
      const store = useEditor.getState();
      store.setSceneData({
        entities: data.entities as never,
        environment: (data.environment as never) ?? {},
      });
      const packName = data._pipelinePack?.name;
      store.setSceneName(
        packName
          ? String(packName)
          : editMode
            ? "Loaded Scene (Edit)"
            : label || "Published Scene",
      );
      store.setPlaying(!editMode);
      const scripts = data._pipelinePack?.scripts;
      const assets = data._pipelinePack?.assets;
      if (Array.isArray(scripts) && scripts.length) {
        try {
          localStorage.setItem(
            "gameforge:pipelineScripts",
            JSON.stringify(scripts),
          );
        } catch {
          /* private mode */
        }
        store.pushLog(
          "info",
          `Pipeline pack: ${scripts.length} script(s) stored (AI / Script panel). Assets: ${Array.isArray(assets) ? assets.length : 0}`,
        );
      }
      store.pushLog(
        "info",
        `Loaded ${data.entities.length} entities · ${editMode ? "edit mode" : "play mode"} · ${label}`,
      );
    };

    // ── postMessage from grudge-pipeline (full pack with scripts + assets) ──
    const onPipelineMsg = (ev: MessageEvent) => {
      if (cancelled) return;
      const data = ev.data;
      if (!data || data.type !== "grudge:pipeline:import-scene") return;
      // Trust pipeline production origin + localhost for dev
      const okOrigin =
        typeof ev.origin === "string" &&
        (ev.origin.includes("grudge-pipeline") ||
          ev.origin.includes("localhost") ||
          ev.origin.includes("127.0.0.1") ||
          ev.origin.endsWith(".vercel.app"));
      if (!okOrigin) return;
      try {
        const pack = data.pack as {
          name?: string;
          scene?: { entities?: unknown; environment?: unknown };
          scripts?: unknown[];
          assets?: unknown[];
        };
        const scene = pack?.scene;
        if (!scene || !Array.isArray(scene.entities)) {
          throw new Error("pipeline pack missing scene.entities");
        }
        applyScene(
          {
            entities: scene.entities,
            environment: scene.environment,
            _pipelinePack: {
              name: pack.name,
              scripts: pack.scripts,
              assets: pack.assets,
            },
          },
          "pipeline postMessage",
        );
        // ACK so pipeline stops retrying
        try {
          (ev.source as Window | null)?.postMessage?.(
            { type: "grudge:forge:import-ack", ok: true },
            ev.origin,
          );
        } catch {
          /* */
        }
      } catch (err) {
        pushLog("error", `Pipeline import failed: ${(err as Error).message}`);
      }
    };
    window.addEventListener("message", onPipelineMsg);
    // Tell opener we're ready
    try {
      window.opener?.postMessage?.(
        { type: "grudge:forge:ready" },
        "*",
      );
    } catch {
      /* */
    }

    // ── Single asset deep link ──
    if (assetUrl && !sceneUrl) {
      try {
        const id = `ent-pipeline-${Date.now().toString(36)}`;
        applyScene(
          {
            entities: [
              {
                id: "ent-ground",
                name: "Ground",
                type: "plane",
                transform: {
                  position: [0, 0, 0],
                  rotation: [-Math.PI / 2, 0, 0],
                  scale: [60, 60, 1],
                },
                parentId: null,
                material: { color: "#2a3530", metalness: 0, roughness: 1 },
                physics: {
                  bodyType: "fixed",
                  colliderType: "cuboid",
                  mass: 0,
                  restitution: 0.2,
                  friction: 1,
                },
                layer: "Terrain",
                surface: "Walk",
              },
              {
                id,
                name: params.get("meshName") || "Pipeline Asset",
                type: "model",
                model: { url: assetUrl },
                transform: {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
                parentId: null,
                layer: "Default",
                surface: "None",
              },
            ],
            environment: {
              skyColor: "#9ec8e8",
              ambientIntensity: 0.5,
              sunIntensity: 1.1,
              gravity: [0, -9.81, 0],
            },
          },
          assetUrl,
        );
      } catch (err) {
        pushLog("error", `Asset import failed: ${(err as Error).message}`);
      }
    }

    // ── Remote / hosted scene URL ──
    if (sceneUrl && /^https?:\/\//i.test(sceneUrl)) {
      (async () => {
        try {
          const res = await fetch(sceneUrl, { mode: "cors" });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = (await res.json()) as {
            entities?: unknown;
            environment?: unknown;
            _pipelinePack?: { scripts?: unknown[]; assets?: unknown[]; name?: string };
          };
          if (cancelled) return;
          applyScene(data, sceneUrl);
        } catch (err) {
          if (!cancelled) {
            pushLog("error", `Failed to load shared scene: ${(err as Error).message}`);
          }
        } finally {
          const url = new URL(window.location.href);
          url.searchParams.delete("scene");
          url.searchParams.delete("edit");
          url.searchParams.delete("mode");
          url.searchParams.delete("asset");
          url.searchParams.delete("awaitImport");
          window.history.replaceState({}, "", url.toString());
        }
      })();
    } else if (assetUrl || awaitImport) {
      // Strip one-shot params after handling asset / handshake setup
      const url = new URL(window.location.href);
      url.searchParams.delete("asset");
      url.searchParams.delete("awaitImport");
      // keep edit briefly for UX; strip from so refresh is clean
      url.searchParams.delete("from");
      window.history.replaceState({}, "", url.toString());
    }

    return () => {
      cancelled = true;
      window.removeEventListener("message", onPipelineMsg);
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
