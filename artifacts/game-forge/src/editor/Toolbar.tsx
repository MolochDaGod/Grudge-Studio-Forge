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
  Orbit,
  User,
  Download,
  Upload,
  MoreVertical,
  FileStack,
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
import { SCENE_TEMPLATES } from "@/lib/sceneTemplates";
import { useEditor } from "@/store/editor";
import {
  useUpdateScene,
  useCreateScene,
  useGetProject,
  useUpdatePrefab,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListScenesQueryKey,
  getGetSceneQueryKey,
  getGetProjectSummaryQueryKey,
  getGetProjectQueryKey,
  getListPrefabsQueryKey,
} from "@workspace/api-client-react";
import type { EntityType, CameraMode } from "@/scene/types";
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

const PRIMITIVES: { type: EntityType; label: string; Icon: typeof Box }[] = [
  { type: "box", label: "Box", Icon: Box },
  { type: "sphere", label: "Sphere", Icon: Circle },
  { type: "cylinder", label: "Cylinder", Icon: Cylinder },
  { type: "plane", label: "Plane", Icon: Square },
  { type: "light", label: "Light", Icon: Lightbulb },
];

export function Toolbar({ onOpenProjects }: { onOpenProjects: () => void }) {
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
  const addEntity = useEditor((s) => s.addEntity);
  const setEnvironment = useEditor((s) => s.setEnvironment);
  const cameraMode: CameraMode = sceneData.environment.cameraMode ?? "editor";
  const setSceneName = useEditor((s) => s.setSceneName);
  const markSaved = useEditor((s) => s.markSaved);
  const loadScene = useEditor((s) => s.loadScene);
  const setSceneData = useEditor((s) => s.setSceneData);
  const pushLog = useEditor((s) => s.pushLog);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);
  const closePrefabSubScene = useEditor((s) => s.closePrefabSubScene);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadTemplate = (key: string) => {
    const tpl = SCENE_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    if (
      sceneData.entities.length > 0 &&
      !confirm(
        `Replace the current scene with "${tpl.label}"?\n\n${tpl.description}\n\nThis cannot be undone (Save first if you want to keep changes).`,
      )
    ) {
      return;
    }
    const data = tpl.build();
    setSceneData(data);
    setSceneName(tpl.label);
    pushLog("info", `Loaded template "${tpl.label}" (${data.entities.length} entities).`);
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

  const [editingName, setEditingName] = useState(sceneName);
  useEffect(() => setEditingName(sceneName), [sceneName]);

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
            GAMEFORGE
          </span>
          <span className="font-heading text-[8px] uppercase tracking-[0.22em] text-muted-foreground -mt-0.5">
            Grudge Studio
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
          <button
            onClick={() => {
              const ok = !isDirty ||
                confirm("Close prefab sub-scene? Unsaved prefab changes will be lost.");
              if (ok) closePrefabSubScene();
            }}
            className="ml-1 px-2 py-0.5 rounded font-heading text-[10px] uppercase tracking-[0.18em] text-primary/80 hover:text-primary hover:bg-primary/15"
            title={
              isDirty
                ? "Close sub-scene (unsaved prefab changes will be lost)"
                : "Close sub-scene (returns to your scene)"
            }
            data-testid="button-toolbar-close-prefab"
          >
            Close
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
              onClick={() => addEntity(p.type)}
              data-testid={`menu-add-${p.type}`}
            >
              <p.Icon className="size-4 mr-2" /> {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => addEntity("model", "Model")}>
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabled={!!prefabSubScene}
              data-testid="menu-templates"
            >
              <FileStack className="size-4 mr-2" /> Load template…
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[260px]">
              {SCENE_TEMPLATES.map((t) => (
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
              ))}
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
                onClick={() => setPlaying(true)}
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
              : "Enter Play Mode"}
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
    </div>
  );
}
