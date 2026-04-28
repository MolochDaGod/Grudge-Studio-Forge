import { Box, Circle, Cylinder, Lightbulb, Square, PackageOpen, Trash2, Copy, Layers, Search, X } from "lucide-react";
import { useEditor } from "@/store/editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useListScenes, useCreateScene, useDeleteScene, useGetScene } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListScenesQueryKey,
  getGetProjectSummaryQueryKey,
  getGetSceneQueryKey,
} from "@workspace/api-client-react";
import { useEffect, useState, useMemo } from "react";
import type { EntityType, SceneData } from "@/scene/types";

const ICONS: Record<EntityType, typeof Box> = {
  box: Box,
  sphere: Circle,
  cylinder: Cylinder,
  plane: Square,
  light: Lightbulb,
  camera: Square,
  model: PackageOpen,
  empty: Square,
};

export function Hierarchy() {
  const projectId = useEditor((s) => s.projectId);
  const sceneId = useEditor((s) => s.sceneId);
  const entities = useEditor((s) => s.sceneData.entities);
  const selectedId = useEditor((s) => s.selectedId);
  const selectEntity = useEditor((s) => s.selectEntity);
  const removeEntity = useEditor((s) => s.removeEntity);
  const duplicateEntity = useEditor((s) => s.duplicateEntity);
  const loadScene = useEditor((s) => s.loadScene);

  const qc = useQueryClient();
  const { data: scenes = [] } = useListScenes(projectId ?? 0, {
    query: { queryKey: getListScenesQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const { data: currentScene } = useGetScene(sceneId ?? 0, {
    query: { queryKey: getGetSceneQueryKey(sceneId ?? 0), enabled: !!sceneId },
  });
  const createScene = useCreateScene();
  const deleteScene = useDeleteScene();

  const [filter, setFilter] = useState("");
  const filteredEntities = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
    );
  }, [entities, filter]);
  const selectedHidden =
    !!selectedId && !!filter.trim() && !filteredEntities.some((e) => e.id === selectedId);

  // Auto-load first scene when project changes
  useEffect(() => {
    if (!projectId) return;
    if (sceneId) return;
    if (scenes.length > 0) {
      const first = scenes[0];
      loadScene(first.id, first.name, first.data as SceneData);
    }
  }, [projectId, sceneId, scenes, loadScene]);

  // Refresh in-memory scene if backend version changes
  useEffect(() => {
    if (!currentScene || !sceneId) return;
    // We don't blindly overwrite local edits — only update name if user hasn't touched it
  }, [currentScene, sceneId]);

  const newScene = async () => {
    if (!projectId) return;
    const res = await createScene.mutateAsync({
      data: { projectId, name: `Scene ${scenes.length + 1}` },
    });
    qc.invalidateQueries({ queryKey: getListScenesQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    loadScene(res.id, res.name, res.data as SceneData);
  };

  const removeScene = async (id: number) => {
    if (!projectId) return;
    await deleteScene.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListScenesQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    if (sceneId === id) {
      loadScene(0, "Untitled Scene", { entities: [], environment: {} });
    }
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Scenes */}
      <div className="px-3 py-2 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <Layers className="size-3" /> Scenes
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={newScene}
            disabled={!projectId}
            data-testid="button-new-scene"
          >
            + New
          </Button>
        </div>
        <ScrollArea className="max-h-32">
          <div className="space-y-0.5">
            {scenes.map((s) => (
              <div
                key={s.id}
                onClick={() => loadScene(s.id, s.name, s.data as SceneData)}
                className={`group flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer hover-elevate ${
                  sceneId === s.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
                }`}
                data-testid={`scene-item-${s.id}`}
              >
                <span className="truncate">{s.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete scene "${s.name}"?`)) removeScene(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
            {scenes.length === 0 && projectId && (
              <p className="text-xs text-muted-foreground px-2 py-2">
                No scenes yet. Click "+ New" to create one.
              </p>
            )}
            {!projectId && (
              <p className="text-xs text-muted-foreground px-2 py-2">Open a project to begin.</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Entities */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-sidebar-border space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Hierarchy
              <span className="ml-1.5 text-muted-foreground/70">
                ({filteredEntities.length}
                {filter ? `/${entities.length}` : ""})
              </span>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(ev) => setFilter(ev.target.value)}
              placeholder="Filter entities…"
              className="h-6 pl-6 pr-6 text-[11px]"
              data-testid="input-hierarchy-filter"
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
                title="Clear filter"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          {selectedHidden && (
            <button
              onClick={() => setFilter("")}
              className="w-full text-left text-[10px] text-amber-400/90 hover:text-amber-300"
              title="Clear filter to reveal selected entity"
            >
              Selected entity is hidden by the filter — click to clear.
            </button>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1">
            {filteredEntities.map((e) => {
              const Icon = ICONS[e.type] ?? Box;
              const selected = selectedId === e.id;
              return (
                <div
                  key={e.id}
                  onClick={() => selectEntity(e.id)}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover-elevate ${
                    selected ? "bg-primary/15 text-primary border border-primary/30" : ""
                  }`}
                  data-testid={`entity-${e.id}`}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">{e.name}</span>
                  {e.scriptId && <span className="text-[10px] text-accent font-mono">{"<>"}</span>}
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        duplicateEntity(e.id);
                      }}
                      className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground"
                      title="Duplicate"
                    >
                      <Copy className="size-3" />
                    </button>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        removeEntity(e.id);
                      }}
                      className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            {entities.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-6 text-center">
                Empty scene.
                <br />
                Use <span className="text-foreground font-medium">+ Add</span> in the toolbar.
              </p>
            )}
            {entities.length > 0 && filteredEntities.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                No entities match "{filter}".
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
