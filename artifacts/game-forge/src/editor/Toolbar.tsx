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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditor } from "@/store/editor";
import { useUpdateScene, useCreateScene, useGetProject } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListScenesQueryKey,
  getGetSceneQueryKey,
  getGetProjectSummaryQueryKey,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import type { EntityType } from "@/scene/types";
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
  const setSceneName = useEditor((s) => s.setSceneName);
  const markSaved = useEditor((s) => s.markSaved);
  const loadScene = useEditor((s) => s.loadScene);
  const pushLog = useEditor((s) => s.pushLog);

  const qc = useQueryClient();
  const { data: project } = useGetProject(projectId ?? 0, {
    query: { queryKey: getGetProjectQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const updateScene = useUpdateScene();
  const createScene = useCreateScene();

  const [editingName, setEditingName] = useState(sceneName);
  useEffect(() => setEditingName(sceneName), [sceneName]);

  const onSave = async () => {
    if (!projectId) return;
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

  const saving = updateScene.isPending || createScene.isPending;

  return (
    <div className="h-12 flex items-center gap-2 px-3 border-b border-border bg-sidebar shrink-0">
      <button
        onClick={onOpenProjects}
        className="flex items-center gap-2 pl-1 pr-3 py-0.5 rounded-md hover-elevate text-sm font-semibold"
        data-testid="button-open-projects"
        title="Open / create a project"
      >
        <img src="/logo.png" alt="" className="size-7 rounded-sm" />
        <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-amber-200 bg-clip-text text-transparent">
          GameForge
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

      <Separator orientation="vertical" className="h-6 mx-1" />

      {!isPlaying ? (
        <Button
          size="sm"
          onClick={() => setPlaying(true)}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
          data-testid="button-play"
        >
          <Play className="size-4 mr-1 fill-current" /> Play
        </Button>
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
