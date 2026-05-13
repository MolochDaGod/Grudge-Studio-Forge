import {
  Box,
  Circle,
  Cylinder,
  Lightbulb,
  Square,
  Plus,
  Play,
  Pause,
  Square as Stop,
  Save,
  Move,
  RotateCw,
  Maximize,
  Loader2,
  PackageOpen,
  Camera,
  Eye,
  Map as MapIcon,
  Wand2,
  Orbit,
  User,
  Download,
  Upload,
  MoreVertical,
  FileStack,
  Sparkles as AISparkles,
  Gauge,
  Activity,
  Globe,
  Copy,
  CheckCircle2,
  CloudUpload,
  CloudDownload,
} from "lucide-react";
import { useRef } from "react";
import type { SceneData } from "@/scene/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditor } from "@/store/editor";
import { MapGenDialog } from "@/editor/MapGenDialog";
import { TemplateLoadingDialog } from "@/editor/TemplateLoadingDialog";
import { useTemplateLoader } from "@/editor/useTemplateLoader";
import {
  useUpdateScene,
  useCreateScene,
  useGetProject,
  useUpdatePrefab,
  useListTemplates,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListScenesQueryKey,
  getGetSceneQueryKey,
  getGetProjectSummaryQueryKey,
  getGetProjectQueryKey,
  getListPrefabsQueryKey,
  useListPrefabs,
} from "@workspace/api-client-react";
import type { EntityType, CameraMode } from "@/scene/types";
import type { PrefabPayload } from "@/scene/prefabPayload";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { InstallAppButton } from "@/editor/InstallAppButton";
import { ToolsPanel } from "@/editor/ToolsPanel";
import { Wrench } from "lucide-react";
import { UserMenu } from "@/editor/UserMenu";
import { useAuth } from "@/store/auth";
import { cloud, path as cloudPath } from "@/lib/cloud/puterCloud";
import { useToast } from "@/hooks/use-toast";
import { publishScene, type PublishResult } from "@/lib/puterPublish";
import { listScripts } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PRIMITIVES: { type: EntityType; label: string; Icon: typeof Box }[] = [
  { type: "box", label: "Box", Icon: Box },
  { type: "sphere", label: "Sphere", Icon: Circle },
  { type: "cylinder", label: "Cylinder", Icon: Cylinder },
  { type: "plane", label: "Plane", Icon: Square },
  { type: "light", label: "Light", Icon: Lightbulb },
];

export function Toolbar({
  onOpenProjects,
  onToggleAIWorker,
  aiWorkerOpen,
}: {
  onOpenProjects: () => void;
  onToggleAIWorker: () => void;
  aiWorkerOpen: boolean;
}) {
  const projectId = useEditor((s) => s.projectId);
  const sceneId = useEditor((s) => s.sceneId);
  const sceneName = useEditor((s) => s.sceneName);
  const sceneData = useEditor((s) => s.sceneData);
  const isDirty = useEditor((s) => s.isDirty);
  const isPlaying = useEditor((s) => s.isPlaying);
  const isPaused = useEditor((s) => s.isPaused);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const togglePlay = useEditor((s) => s.togglePlay);
  const setPaused = useEditor((s) => s.setPaused);
  const setPlaying = useEditor((s) => s.setPlaying);
  const cmdAddEntity = useEditor((s) => s.cmdAddEntity);
  const spawnPlayerPrefab = useEditor((s) => s.spawnPlayerPrefab);
  const [mapGenOpen, setMapGenOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<
    "converter" | "unzipper" | "deployer" | "scripts"
  >("converter");

  // Listen for native menu → "Tools → 3D Converter" etc. dispatched by
  // the Electron shell over IPC. The preload forwards them as
  // `menu:openTool` events on `window`. Web build never receives them.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const tab =
        detail === "unzipper" || detail === "deployer" || detail === "scripts"
          ? detail
          : "converter";
      setToolsTab(tab);
      setToolsOpen(true);
    };
    window.addEventListener("gameforge:openTool", handler);
    return () => window.removeEventListener("gameforge:openTool", handler);
  }, []);
  const setEnvironment = useEditor((s) => s.cmdSetEnvironment);
  const cameraMode: CameraMode = sceneData.environment.cameraMode ?? "editor";
  const setSceneName = useEditor((s) => s.setSceneName);
  const markSaved = useEditor((s) => s.markSaved);
  const loadScene = useEditor((s) => s.loadScene);
  const setSceneData = useEditor((s) => s.setSceneData);
  const pushLog = useEditor((s) => s.pushLog);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);
  const closePrefabSubScene = useEditor((s) => s.closePrefabSubScene);
  const renderQuality = useEditor((s) => s.renderQuality);
  const showStats = useEditor((s) => s.showStats);
  const setRenderQuality = useEditor((s) => s.setRenderQuality);
  const setShowStats = useEditor((s) => s.setShowStats);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Templates now stream from the api-server (backed by object storage)
  // instead of being bundled into the editor JS. The picker reads the
  // manifest via React Query; selecting one streams the SceneData JSON
  // with a real progress bar.
  //
  // Defensive: React Query hands back the raw fetcher result for `data`,
  // and the OpenAPI contract pins it to `TemplateManifestEntry[]`. Even
  // so, we coerce to an array on the consumer side so a transient API
  // misbehaviour (proxy interception page, JSON wrapper, undefined while
  // loading) cannot crash the entire toolbar — instead the picker just
  // shows "Loading template list…" until the next poll succeeds.
  const tplQuery = useListTemplates();
  const templateManifest = Array.isArray(tplQuery.data) ? tplQuery.data : [];
  if (
    import.meta.env.DEV &&
    tplQuery.data !== undefined &&
    !Array.isArray(tplQuery.data)
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      "[Forge] useListTemplates returned non-array data — coercing to []",
      tplQuery.data,
    );
  }
  const templateLoader = useTemplateLoader();

  const loadTemplate = (key: string) => {
    const tpl = templateManifest.find((t) => t.key === key);
    if (!tpl) return;
    if (
      sceneData.entities.length > 0 &&
      !confirm(
        `Replace the current scene with "${tpl.label}"?\n\n${tpl.description}\n\nThis cannot be undone (Save first if you want to keep changes).`,
      )
    ) {
      return;
    }
    templateLoader.start(tpl.key, tpl.label);
  };

  const exportScene = () => {
    let json: string;
    try {
      json = JSON.stringify(sceneData, null, 2);
    } catch (err) {
      pushLog("error", `Export failed: ${(err as Error).message}`);
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (sceneName || "scene").replace(/[^a-z0-9_-]+/gi, "_");
    a.href = url;
    a.download = `${safeName}.gfscene.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pushLog("info", `Exported "${a.download}"`);
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<SceneData>;
      if (!parsed || !Array.isArray(parsed.entities)) {
        pushLog("error", `${file.name}: missing 'entities' array`);
        return;
      }
      // command-stack: bypass — wholesale scene replace on import (same
      // contract as the documented setSceneData bypass in store/editor.ts).
      setSceneData({ entities: parsed.entities, environment: parsed.environment ?? {} });
      const cleanName = file.name.replace(/\.(gfscene\.)?json$/i, "").replace(/\.gfscene$/i, "");
      setSceneName(cleanName || "Imported Scene");
      pushLog("info", `Imported "${file.name}" (${parsed.entities.length} entities). Save to keep.`);
    } catch (err) {
      pushLog("error", `Import failed: ${(err as Error).message}`);
    }
  };

  const qc = useQueryClient();
  const { data: project } = useGetProject(projectId ?? 0, {
    query: { queryKey: getGetProjectQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const updateScene = useUpdateScene();
  const createScene = useCreateScene();
  const updatePrefab = useUpdatePrefab();
  // Subscribe to the project's prefab list so we can register the
  // "default Player" prefab (the one flagged `data.isPlayerPrefab`) with
  // the editor store. The store consumes it on every entry into play
  // mode, which means BOTH the toolbar play button AND the global `P`
  // hotkey share the same auto-spawn path — they can't drift.
  const { data: prefabsForPlay } = useListPrefabs(projectId ?? 0, {
    query: {
      queryKey: getListPrefabsQueryKey(projectId ?? 0),
      enabled: !!projectId,
    },
  });
  const setPlayerPrefabResolver = useEditor((s) => s.setPlayerPrefabResolver);

  // Keep the store's resolver in sync with the live prefab list. We
  // register a closure rather than a snapshot so a play-button press
  // sees whichever prefab is currently flagged — even if the list
  // updated between toggle and now.
  useEffect(() => {
    if (!prefabsForPlay) {
      setPlayerPrefabResolver(null);
      return;
    }
    setPlayerPrefabResolver(() => {
      const found = prefabsForPlay.find((p) => {
        const d = (p.data as PrefabPayload | undefined) ?? {};
        return d.isPlayerPrefab === true && (d.entities?.length ?? 0) > 0;
      });
      if (!found) return null;
      const d = found.data as PrefabPayload;
      return {
        entities: d.entities ?? [],
        prefabId: found.id,
        name: found.name,
      };
    });
    return () => {
      setPlayerPrefabResolver(null);
    };
  }, [prefabsForPlay, setPlayerPrefabResolver]);

  /**
   * Toolbar Play button. Just warms the Blazor runtime in the background
   * (so the user's first script frame doesn't pay the JIT cost) and
   * delegates to `setPlaying(true)`. The auto-spawn for a default
   * Player prefab is handled inside the store — see
   * `setPlaying`/`playerPrefabResolver` — so this entry path stays in
   * lock-step with the `P` hotkey.
   */
  const onPressPlay = () => {
    void import("@/scene/PlayRuntime").then((m) => m.warmBlazorRuntime());
    setPlaying(true);
  };

  const [editingName, setEditingName] = useState(sceneName);
  useEffect(() => setEditingName(sceneName), [sceneName]);

  // ----- Publish (T005) -----
  const authStatus = useAuth((s) => s.status);
  const isSignedIn = authStatus === "signedIn";
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onPublish = async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      // The bootstrapper redirects back to *this* editor page (with
      // ?scene=… appended), so we need our origin + the artifact's base
      // path. import.meta.env.BASE_URL is provided by Vite and already
      // ends with a trailing slash.
      const editorOrigin = `${window.location.origin}${import.meta.env.BASE_URL}`;
      // Snapshot scripts at publish time so the player bundle ships with
      // the same gameplay tick the editor's play mode runs. Best-effort:
      // if the projectId is missing (unsaved scratch scene) or the fetch
      // fails, we publish without scripts rather than blocking the user.
      let scripts: Awaited<ReturnType<typeof listScripts>> = [];
      if (projectId) {
        try {
          scripts = await listScripts(projectId);
        } catch (err) {
          pushLog("warn", `Could not load scripts for publish: ${(err as Error).message}`);
        }
      }
      const res = await publishScene({
        sceneData,
        // sceneId keeps the published subdomain stable across republishes.
        // Falsy (unsaved scratch scene) → publishScene falls back to a
        // content hash so the slug is still deterministic per content.
        sceneId: sceneId ?? null,
        editorOrigin,
        scripts,
      });
      setPublishResult(res);
      pushLog("info", `Published to ${res.shareUrl}`);
    } catch (err) {
      const msg = (err as Error).message;
      setPublishError(msg);
      pushLog("error", `Publish failed: ${msg}`);
    } finally {
      setPublishing(false);
    }
  };

  const onCopyShareUrl = async () => {
    if (!publishResult) return;
    try {
      await navigator.clipboard.writeText(publishResult.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard can fail in iframes without permissions; surface a hint
      pushLog("warn", "Clipboard blocked — copy the URL manually.");
    }
  };

  const onSave = async () => {
    if (!projectId) return;
    // In prefab sub-scene mode, "Save" persists the prefab buffer rather
    // than touching scenes (which would create a stray scene from the
    // prefab's contents).
    if (prefabSubScene) {
      const entities = sceneData.entities;
      const res = await updatePrefab.mutateAsync({
        id: prefabSubScene.prefabId,
        data: {
          name: prefabSubScene.prefabName,
          data: { entities, rootId: entities[0]?.id ?? null },
        },
      });
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      markSaved();
      pushLog("info", `Saved prefab "${res.name}" (${entities.length} entities)`);
      return;
    }
    if (sceneId) {
      const res = await updateScene.mutateAsync({ id: sceneId, data: { name: sceneName, data: sceneData } });
      qc.invalidateQueries({ queryKey: getListScenesQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getGetSceneQueryKey(sceneId) });
      qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      markSaved();
      pushLog("info", `Saved scene "${res.name}"`);
    } else {
      const res = await createScene.mutateAsync({ data: { projectId, name: sceneName, data: sceneData } });
      loadScene(res.id, res.name, res.data as typeof sceneData);
      qc.invalidateQueries({ queryKey: getListScenesQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      pushLog("info", `Created scene "${res.name}" (id: ${res.id})`);
    }
  };

  const saving = updateScene.isPending || createScene.isPending || updatePrefab.isPending;

  // Bridge for the centralized hotkey registry: Ctrl+S triggers a window
  // event so the keyboard handler in App.tsx doesn't need to know about
  // this component's mutation state. The autosave hook in
  // editorPersistence.ts dispatches the SAME event with
  // `detail.autosave === true` — in that case we additionally refuse to
  // run the "create new scene" branch, so a brand-new untitled scene
  // doesn't get silently materialized as a row on every keystroke.
  useEffect(() => {
    const onSaveEvt = (evt: Event) => {
      if (saving || !projectId) return;
      const isAutosave =
        evt instanceof CustomEvent && evt.detail && evt.detail.autosave === true;
      if (isAutosave && !sceneId && !prefabSubScene) return;
      void onSave().catch((err) => {
        // Surface autosave failures into the editor console so a
        // network blip doesn't corrupt the user's mental model of
        // "saved". The localStorage draft mirror is the safety net.
        const msg = err instanceof Error ? err.message : String(err);
        useEditor.getState().pushLog(
          "error",
          `${isAutosave ? "Autosave" : "Save"} failed: ${msg}`,
        );
      });
    };
    const onOpenMapGen = () => setMapGenOpen(true);
    window.addEventListener("gameforge:save", onSaveEvt);
    window.addEventListener("gameforge:openMapGen", onOpenMapGen);
    return () => {
      window.removeEventListener("gameforge:save", onSaveEvt);
      window.removeEventListener("gameforge:openMapGen", onOpenMapGen);
    };
    // onSave closes over store + mutation hooks; we re-register whenever
    // those change so the latest implementation is invoked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, projectId, sceneId, sceneName, sceneData, prefabSubScene]);

  return (
    <div className="h-12 flex items-center gap-2 px-3 border-b border-border bg-sidebar shrink-0">
      <button
        onClick={onOpenProjects}
        className="group flex items-center gap-2.5 pl-1 pr-3 py-0.5 rounded-md hover-elevate"
        data-testid="button-open-projects"
        title="Open / create a project"
      >
        <img
          src="/logo.png"
          alt="Grudge Studio"
          className="size-7 rounded-sm transition-shadow group-hover:gold-glow-sm"
        />
        <span className="flex flex-col leading-none items-start">
          <span className="font-display text-[15px] font-bold brand-gold tracking-wider">
            STUDIO FORGE
          </span>
          <span className="font-heading text-[8px] uppercase tracking-[0.22em] text-muted-foreground -mt-0.5">
            Grudge GameForge
          </span>
        </span>
      </button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <div className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
        {project ? project.name : "No project"}
      </div>

      <span className="text-muted-foreground">/</span>

      <Input
        value={editingName}
        onChange={(e) => setEditingName(e.target.value)}
        onBlur={() => editingName !== sceneName && setSceneName(editingName)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-7 w-44 bg-transparent border-transparent focus-visible:bg-background"
        placeholder="Scene name"
        data-testid="input-scene-name"
      />

      {isDirty && <span className="size-2 rounded-full bg-amber-400" title="Unsaved changes" />}

      {prefabSubScene && (
        <div className="ml-1 flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-md bg-primary/10 border border-primary/40 gold-glow-sm">
          <span className="font-heading text-[10px] uppercase tracking-[0.22em] text-primary">
            Editing Prefab
          </span>
          <span className="text-primary/40">·</span>
          <span className="font-display text-[12px] tracking-wide brand-gold">
            {prefabSubScene.prefabName}
          </span>
          {/* Inline Save action so users don't have to hunt down the
              Prefabs panel (or remember Ctrl+S) to persist the buffer.
              Reuses the toolbar's existing onSave path which already
              branches on prefabSubScene → updatePrefab — no extra
              save logic introduced here. */}
          <button
            onClick={() => {
              if (saving || !projectId) return;
              window.dispatchEvent(new CustomEvent("gameforge:save"));
            }}
            disabled={saving || !projectId}
            className="ml-1 px-2 py-0.5 rounded font-heading text-[10px] uppercase tracking-[0.18em] text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50"
            title={
              isDirty
                ? "Save prefab changes (Ctrl+S)"
                : "No unsaved prefab changes — saves anyway as a no-op"
            }
            data-testid="button-toolbar-save-prefab"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => {
              const ok = !isDirty ||
                confirm("Close prefab sub-scene? Unsaved prefab changes will be lost.");
              if (ok) closePrefabSubScene();
            }}
            className="px-2 py-0.5 rounded font-heading text-[10px] uppercase tracking-[0.18em] text-primary/80 hover:text-primary hover:bg-primary/15"
            title={
              isDirty
                ? "Close sub-scene (unsaved prefab changes will be lost)"
                : "Close sub-scene (returns to your scene)"
            }
            data-testid="button-toolbar-close-prefab"
          >
            Back to Scene
          </button>
        </div>
      )}

      <Separator orientation="vertical" className="h-6 mx-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="button-add-entity">
            <Plus className="size-4 mr-1" /> Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRIMITIVES.map((p) => (
            <DropdownMenuItem
              key={p.type}
              onClick={() => cmdAddEntity(p.type)}
              data-testid={`menu-add-${p.type}`}
            >
              <p.Icon className="size-4 mr-2" /> {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => cmdAddEntity("model", "Model")}>
            <PackageOpen className="size-4 mr-2" /> Empty Model Slot
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <div className="flex gap-1">
        {(["translate", "rotate", "scale"] as const).map((m) => {
          const Icon = m === "translate" ? Move : m === "rotate" ? RotateCw : Maximize;
          return (
            <Tooltip key={m}>
              <TooltipTrigger asChild>
                <Button
                  variant={transformMode === m ? "default" : "ghost"}
                  size="icon"
                  className="size-8"
                  onClick={() => setTransformMode(m)}
                  data-testid={`button-transform-${m}`}
                >
                  <Icon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{`${m[0].toUpperCase()}${m.slice(1)} (W/E/R)`}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Select
              value={cameraMode}
              onValueChange={(v) => setEnvironment({ cameraMode: v as CameraMode })}
            >
              <SelectTrigger
                className="h-8 w-[170px] text-xs"
                data-testid="select-camera-mode"
              >
                <Camera className="size-3.5 mr-1.5 opacity-70" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">
                  <Orbit className="size-3.5 mr-2 inline" /> Editor (orbit)
                </SelectItem>
                <SelectItem value="rts">
                  <MapIcon className="size-3.5 mr-2 inline" /> RTS top-down
                </SelectItem>
                <SelectItem value="thirdPerson">
                  <User className="size-3.5 mr-2 inline" /> Third-person
                </SelectItem>
                <SelectItem value="firstPerson">
                  <Eye className="size-3.5 mr-2 inline" /> First-person
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">Active camera in Play Mode</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <UserMenu />

      <Separator orientation="vertical" className="h-6 mx-1" />

      <InstallAppButton />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setToolsTab("converter");
              setToolsOpen(true);
            }}
            data-testid="button-open-tools"
          >
            <Wrench className="size-4 mr-1.5" /> Tools
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          3D converter, unzipper, scene deployer, script editor
        </TooltipContent>
      </Tooltip>

      <ToolsPanel
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        initialTab={toolsTab}
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={aiWorkerOpen ? "default" : "ghost"}
            size="sm"
            onClick={onToggleAIWorker}
            className={aiWorkerOpen ? "" : "text-primary hover:text-primary"}
            data-testid="button-toggle-ai-worker"
          >
            <AISparkles className="size-4 mr-1.5" />
            AI Worker
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Open the AI assistant — it can build scenes, write scripts, generate
          maps, and more.
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={onSave}
        disabled={!projectId || saving}
        data-testid="button-save"
      >
        {saving ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
        Save
      </Button>

      <CloudSaveButton />
      <CloudOpenButton />

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onPublish}
              disabled={
                !isSignedIn ||
                publishing ||
                !!prefabSubScene ||
                sceneData.entities.length === 0
              }
              data-testid="button-publish"
            >
              {publishing ? (
                <Loader2 className="size-4 mr-1 animate-spin" />
              ) : (
                <Globe className="size-4 mr-1" />
              )}
              Publish
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {!isSignedIn
            ? "Sign in with Puter to publish"
            : prefabSubScene
              ? "Close the prefab sub-scene first"
              : sceneData.entities.length === 0
                ? "Add some entities first"
                : "Publish to a free Puter-hosted page"}
        </TooltipContent>
      </Tooltip>

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.gfscene,.gfscene.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportFile(f);
          if (importInputRef.current) importInputRef.current.value = "";
        }}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" data-testid="button-scene-menu">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Scene
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={exportScene} data-testid="menu-export-scene">
            <Download className="size-4 mr-2" /> Export scene JSON
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => importInputRef.current?.click()}
            data-testid="menu-import-scene"
          >
            <Upload className="size-4 mr-2" /> Import scene JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setMapGenOpen(true)}
            disabled={!!prefabSubScene || !projectId}
            data-testid="menu-generate-map"
          >
            <Wand2 className="size-4 mr-2" /> Generate map…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Render
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => setRenderQuality(renderQuality === "high" ? "perf" : "high")}
            data-testid="menu-toggle-quality"
          >
            <Gauge className="size-4 mr-2" />
            Quality:{" "}
            <span className="ml-1 text-accent">
              {renderQuality === "high" ? "Cinematic" : "Performance"}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowStats(!showStats)}
            data-testid="menu-toggle-stats"
          >
            <Activity className="size-4 mr-2" />
            FPS overlay: <span className="ml-1 text-accent">{showStats ? "On" : "Off"}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabled={!!prefabSubScene}
              data-testid="menu-templates"
            >
              <FileStack className="size-4 mr-2" /> Load template…
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[260px]">
              {tplQuery.isError ||
              (tplQuery.data !== undefined && !Array.isArray(tplQuery.data)) ? (
                <>
                  <DropdownMenuItem
                    disabled
                    className="text-xs text-destructive whitespace-normal leading-tight"
                  >
                    Couldn't load templates from the server.
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void tplQuery.refetch()}
                    className="text-xs"
                    data-testid="menu-templates-retry"
                  >
                    Retry
                  </DropdownMenuItem>
                </>
              ) : templateManifest.length === 0 ? (
                <DropdownMenuItem disabled className="text-xs">
                  Loading template list…
                </DropdownMenuItem>
              ) : (
                templateManifest.map((t) => (
                  <DropdownMenuItem
                    key={t.key}
                    onClick={() => loadTemplate(t.key)}
                    className="flex flex-col items-start gap-0.5 py-2"
                    data-testid={`menu-template-${t.key}`}
                  >
                    <span className="text-sm font-medium">{t.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight whitespace-normal">
                      {t.description}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {!isPlaying ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                onClick={onPressPlay}
                disabled={!!prefabSubScene}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                data-testid="button-play"
              >
                <Play className="size-4 mr-1 fill-current" /> Play
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {prefabSubScene
              ? "Close the prefab sub-scene to play the main scene"
              : "Enter Play Mode (P)"}
          </TooltipContent>
        </Tooltip>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPaused(!isPaused)}
            data-testid="button-pause"
          >
            <Pause className="size-4 mr-1" /> {isPaused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="destructive" onClick={togglePlay} data-testid="button-stop">
            <Stop className="size-4 mr-1 fill-current" /> Stop
          </Button>
        </>
      )}

      <MapGenDialog open={mapGenOpen} onOpenChange={setMapGenOpen} />

      <TemplateLoadingDialog
        open={templateLoader.isLoading}
        label={templateLoader.activeLabel}
        progress={templateLoader.progress}
        onCancel={templateLoader.cancel}
      />

      <Dialog
        open={!!publishResult || !!publishError}
        onOpenChange={(open) => {
          if (!open) {
            setPublishResult(null);
            setPublishError(null);
          }
        }}
      >
        <DialogContent data-testid="publish-dialog">
          <DialogHeader>
            <DialogTitle>
              {publishResult ? "Scene published" : "Publish failed"}
            </DialogTitle>
            <DialogDescription>
              {publishResult
                ? "Anyone with this link can play your scene in their browser. The link is yours forever — re-publish to push updates."
                : publishError ?? ""}
            </DialogDescription>
          </DialogHeader>
          {publishResult && (
            <div className="space-y-3">
              <div className="rounded-md border border-card-border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                  Share URL
                </div>
                <div
                  className="text-xs font-mono break-all text-accent"
                  data-testid="publish-share-url"
                >
                  {publishResult.shareUrl}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Subdomain:{" "}
                <span className="font-mono">{publishResult.subdomain}</span>
                {publishResult.reused
                  ? " — updated in place (existing share link still works)."
                  : " — newly created."}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {publishResult.bootstrapper === "player"
                  ? "Visitors get the chrome-free standalone player."
                  : "Visitors are redirected back to the editor in play mode (legacy fallback)."}
              </div>
            </div>
          )}
          <DialogFooter>
            {publishResult && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCopyShareUrl}
                data-testid="button-copy-share-url"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="size-4 mr-1.5" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-1.5" /> Copy link
                  </>
                )}
              </Button>
            )}
            {publishResult && (
              <Button
                size="sm"
                onClick={() => window.open(publishResult.shareUrl, "_blank")}
              >
                <Globe className="size-4 mr-1.5" /> Open in new tab
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =====================================================================
// Cloud Save / Open from Cloud
// =====================================================================
//
// Two thin Toolbar buttons that go through `puterCloud` for signed-in
// users. Saves land at `Grudge/projects/<projectId>/scene.json` (matches
// the AI `cloud_save_project` tool) and the picker reads back the
// `grudge:projects:index` KV index. Guests see a disabled button with a
// "Sign in with Puter" tooltip — no broken state.
//
// We persist a per-user storage preference under `grudge.storage.<uuid>`
// so users who explicitly cloud-save once are silently re-saved to the
// cloud on subsequent edits as well (handled by `gameforge:save` listener
// elsewhere — recorded here as the source of truth).
function CloudSaveButton() {
  const projectId = useEditor((s) => s.projectId);
  const sceneData = useEditor((s) => s.sceneData);
  const sceneName = useEditor((s) => s.sceneName);
  const sceneId = useEditor((s) => s.sceneId);
  const pushLog = useEditor((s) => s.pushLog);
  const isSignedIn = useAuth((s) => s.status === "signedIn");
  const userUuid = useAuth((s) => s.user?.puter?.uuid);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const scenePath = cloudPath("Grudge/projects", String(projectId), "scene.json");
      const metaPath = cloudPath("Grudge/projects", String(projectId), "meta.json");
      const meta = {
        projectId,
        name: sceneName,
        sceneId: sceneId ?? null,
        entityCount: sceneData.entities.length,
        updatedAt: new Date().toISOString(),
      };
      const w = await cloud.fs.write(scenePath, JSON.stringify(sceneData));
      if (!w.ok) throw new Error(w.message ?? w.reason);
      await cloud.fs.write(metaPath, JSON.stringify(meta));

      // Update the KV index so Open-from-Cloud sees this entry.
      const idxRes = await cloud.kv.get<Array<Record<string, unknown>>>("grudge:projects:index");
      const idx = idxRes.ok && Array.isArray(idxRes.data) ? idxRes.data : [];
      const without = idx.filter((e) => (e as { projectId?: number }).projectId !== projectId);
      without.push({ projectId, name: sceneName, updatedAt: meta.updatedAt, scenePath });
      await cloud.kv.set("grudge:projects:index", without);

      // Remember this user prefers the cloud as their save target.
      if (userUuid) {
        try {
          localStorage.setItem(`grudge.storage.${userUuid}`, "cloud");
        } catch {
          /* private mode — non-fatal */
        }
      }
      toast({ title: "Saved to your Puter cloud" });
      pushLog("info", `Cloud-saved "${sceneName}" → ${scenePath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Cloud save failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            disabled={!isSignedIn || !projectId || busy}
            data-testid="button-cloud-save"
          >
            {busy ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <CloudUpload className="size-4 mr-1" />
            )}
            Cloud Save
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isSignedIn
          ? "Snapshot the current scene to your Puter drive."
          : "Sign in with Puter to save to the cloud."}
      </TooltipContent>
    </Tooltip>
  );
}

interface CloudProjectEntry {
  projectId: number;
  name: string;
  updatedAt: string;
  scenePath: string;
}

function CloudOpenButton() {
  const isSignedIn = useAuth((s) => s.status === "signedIn");
  const setSceneData = useEditor((s) => s.setSceneData);
  const setSceneName = useEditor((s) => s.setSceneName);
  const pushLog = useEditor((s) => s.pushLog);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<CloudProjectEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadIndex = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await cloud.kv.get<CloudProjectEntry[]>("grudge:projects:index");
      if (!r.ok) {
        setError(r.message ?? r.reason);
        setEntries([]);
        return;
      }
      const list = Array.isArray(r.data)
        ? r.data
            .filter(
              (e): e is CloudProjectEntry =>
                !!e &&
                typeof e.projectId === "number" &&
                typeof e.scenePath === "string",
            )
            .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
        : [];
      setEntries(list);
    } finally {
      setLoading(false);
    }
  };

  const onTrigger = () => {
    setOpen(true);
    void loadIndex();
  };

  const onPick = async (e: CloudProjectEntry) => {
    setLoading(true);
    try {
      const r = await cloud.fs.readJson<SceneData>(e.scenePath);
      if (!r.ok) throw new Error(r.message ?? r.reason);
      const parsed = r.data;
      if (!parsed || !Array.isArray(parsed.entities)) {
        throw new Error("Cloud file is not a valid scene.");
      }
      // Open-from-Cloud is "Save As New" semantics: detach from any
      // currently-bound API scene id so a subsequent Save creates a
      // fresh scene record instead of overwriting whichever scene the
      // user happened to have open. The store's onSave already branches
      // on sceneId, so clearing it (via direct setState — there's no
      // dedicated setSceneId on the store API) is enough.
      useEditor.setState({ sceneId: null });
      setSceneName(e.name);
      setSceneData(parsed);
      pushLog(
        "info",
        `Loaded "${e.name}" from cloud (${parsed.entities.length} entities). Save to create a new scene record in this project.`,
      );
      toast({
        title: `Loaded "${e.name}" from cloud`,
        description: "Click Save to create a new scene record from this snapshot.",
      });
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Cloud open failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onTrigger}
              disabled={!isSignedIn}
              data-testid="button-cloud-open"
            >
              <CloudDownload className="size-4 mr-1" />
              Open from Cloud
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isSignedIn
            ? "Open a scene previously saved to your Puter drive."
            : "Sign in with Puter to access cloud projects."}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-cloud-open">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudDownload className="size-4" /> Open from Cloud
            </DialogTitle>
            <DialogDescription>
              Pick a scene previously saved to your Puter drive. This
              replaces the current viewport — save first if you want to
              keep your in-progress work.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          )}
          {!loading && error && (
            <p className="text-xs text-destructive py-2" data-testid="text-cloud-error">
              {error}
            </p>
          )}
          {!loading && !error && entries.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              No cloud projects yet — use Cloud Save to add one.
            </p>
          )}
          {!loading && entries.length > 0 && (
            <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="list-cloud-projects">
              {entries.map((e) => (
                <li key={`${e.projectId}-${e.scenePath}`}>
                  <button
                    onClick={() => void onPick(e)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs flex items-center justify-between gap-2"
                    data-testid={`item-cloud-project-${e.projectId}`}
                  >
                    <span className="truncate font-medium">{e.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground font-mono">
                      {e.updatedAt?.slice(0, 10) ?? ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
