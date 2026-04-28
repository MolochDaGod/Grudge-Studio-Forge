import {
  Box,
  Circle,
  Cylinder,
  Lightbulb,
  Square,
  PackageOpen,
  Trash2,
  Copy,
  Layers,
  Search,
  X,
  ChevronRight,
  Package,
  CornerLeftUp,
} from "lucide-react";
import { useEditor } from "@/store/editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useListScenes,
  useCreateScene,
  useDeleteScene,
  useGetScene,
  useCreatePrefab,
  getListPrefabsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListScenesQueryKey,
  getGetProjectSummaryQueryKey,
  getGetSceneQueryKey,
} from "@workspace/api-client-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import type { EntityType, SceneData, SceneEntity } from "@/scene/types";
import { buildTree, wouldCycle } from "@/lib/hierarchy";

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

interface RowProps {
  entity: SceneEntity;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  selected: boolean;
  matchesFilter: boolean;
  onPick: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUnparent: () => void;
  onSavePrefab: () => void;
  onDragStart: (id: string) => void;
  onDragOverRow: (id: string, e: React.DragEvent) => void;
  onDragLeaveRow: (id: string) => void;
  onDropRow: (id: string) => void;
  dropTargetId: string | null;
  draggedId: string | null;
}

function HierarchyRow({
  entity,
  depth,
  hasChildren,
  collapsed,
  selected,
  matchesFilter,
  onPick,
  onToggle,
  onDuplicate,
  onDelete,
  onUnparent,
  onSavePrefab,
  onDragStart,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
  dropTargetId,
  draggedId,
}: RowProps) {
  const Icon = ICONS[entity.type] ?? Box;
  const isDropTarget = dropTargetId === entity.id;
  const isPrefabInstance = !!entity.prefabId;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/entity-id", entity.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(entity.id);
      }}
      onDragOver={(e) => onDragOverRow(entity.id, e)}
      onDragLeave={() => onDragLeaveRow(entity.id)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropRow(entity.id);
      }}
      onClick={onPick}
      style={{ paddingLeft: 6 + depth * 14 }}
      className={`group flex items-center gap-1 pr-2 py-1 rounded text-sm cursor-pointer hover-elevate ${
        selected ? "bg-primary/15 text-primary border border-primary/30" : ""
      } ${!matchesFilter ? "opacity-40" : ""} ${
        isDropTarget && draggedId !== entity.id ? "outline outline-1 outline-amber-400/70 bg-amber-400/10" : ""
      }`}
      data-testid={`entity-${entity.id}`}
    >
      {hasChildren ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="size-3.5 flex items-center justify-center text-muted-foreground hover:text-foreground"
          title={collapsed ? "Expand" : "Collapse"}
        >
          <ChevronRight
            className={`size-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        </button>
      ) : (
        <span className="size-3.5" />
      )}
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="flex-1 truncate">{entity.name}</span>
      {isPrefabInstance && (
        <span
          className="text-[9px] font-mono px-1 rounded bg-accent/15 text-accent border border-accent/40"
          title="Instance of a Prefab"
        >
          P
        </span>
      )}
      {entity.scriptId && <span className="text-[10px] text-accent font-mono">{"<>"}</span>}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
        {entity.parentId && (
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              onUnparent();
            }}
            className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground"
            title="Unparent (move to root)"
          >
            <CornerLeftUp className="size-3" />
          </button>
        )}
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onSavePrefab();
          }}
          className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-accent"
          title="Save subtree as Prefab"
        >
          <Package className="size-3" />
        </button>
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onDuplicate();
          }}
          className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground"
          title="Duplicate (with children)"
        >
          <Copy className="size-3" />
        </button>
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete();
          }}
          className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-destructive"
          title="Delete (cascades to children)"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}

export function Hierarchy() {
  const projectId = useEditor((s) => s.projectId);
  const sceneId = useEditor((s) => s.sceneId);
  const entities = useEditor((s) => s.sceneData.entities);
  const selectedId = useEditor((s) => s.selectedId);
  const selectEntity = useEditor((s) => s.selectEntity);
  const removeEntity = useEditor((s) => s.removeEntity);
  const duplicateEntity = useEditor((s) => s.duplicateEntity);
  const setEntityParent = useEditor((s) => s.setEntityParent);
  const toggleCollapsed = useEditor((s) => s.toggleCollapsed);
  const snapshotSubtree = useEditor((s) => s.snapshotSubtree);
  const pushLog = useEditor((s) => s.pushLog);
  const setBottomTab = useEditor((s) => s.setBottomTab);
  const loadScene = useEditor((s) => s.loadScene);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);

  const qc = useQueryClient();
  const { data: scenes = [] } = useListScenes(projectId ?? 0, {
    query: { queryKey: getListScenesQueryKey(projectId ?? 0), enabled: !!projectId && !prefabSubScene },
  });
  const { data: currentScene } = useGetScene(sceneId ?? 0, {
    query: { queryKey: getGetSceneQueryKey(sceneId ?? 0), enabled: !!sceneId },
  });
  const createScene = useCreateScene();
  const deleteScene = useDeleteScene();
  const createPrefab = useCreatePrefab();

  const [filter, setFilter] = useState("");
  const filterQ = filter.trim().toLowerCase();
  const matchSet = useMemo(() => {
    if (!filterQ) return null;
    const m = new Set<string>();
    for (const e of entities) {
      if (e.name.toLowerCase().includes(filterQ) || e.type.toLowerCase().includes(filterQ)) {
        m.add(e.id);
      }
    }
    return m;
  }, [entities, filterQ]);
  const selectedHidden =
    !!selectedId && matchSet !== null && !matchSet.has(selectedId);

  const childrenByParent = useMemo(() => buildTree(entities), [entities]);
  const roots = childrenByParent.get(null) ?? [];

  // Drag/drop reparenting
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const onDragStart = (id: string) => setDraggedId(id);
  const onDragOverRow = (id: string, e: React.DragEvent) => {
    if (!draggedId || draggedId === id) return;
    if (wouldCycle(entities, draggedId, id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetId !== id) setDropTargetId(id);
  };
  const onDragLeaveRow = (id: string) => {
    if (dropTargetId === id) setDropTargetId(null);
  };
  const onDropRow = (id: string) => {
    if (!draggedId) return;
    if (draggedId === id) {
      setDraggedId(null);
      setDropTargetId(null);
      return;
    }
    if (wouldCycle(entities, draggedId, id)) {
      pushLog("warn", "Cannot reparent — would create a cycle.");
    } else {
      setEntityParent(draggedId, id);
    }
    setDraggedId(null);
    setDropTargetId(null);
  };
  const onDropRoot = useCallback(() => {
    if (!draggedId) return;
    setEntityParent(draggedId, null);
    setDraggedId(null);
    setDropTargetId(null);
  }, [draggedId, setEntityParent]);

  const onSavePrefab = async (rootId: string) => {
    if (!projectId) return;
    const root = entities.find((e) => e.id === rootId);
    if (!root) return;
    const subtree = snapshotSubtree(rootId);
    const defaultName = root.name.replace(/ Copy$/i, "");
    const name = window.prompt("Prefab name:", defaultName);
    if (!name) return;
    try {
      await createPrefab.mutateAsync({
        data: {
          projectId,
          name,
          data: { entities: subtree, rootId: subtree[0]?.id ?? null },
        },
      });
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      pushLog("info", `Saved prefab "${name}" (${subtree.length} entities)`);
      setBottomTab("prefabs");
    } catch (err) {
      pushLog("error", `Save prefab failed: ${(err as Error).message}`);
    }
  };

  // Auto-load first scene when project changes (skip in prefab mode)
  useEffect(() => {
    if (!projectId || prefabSubScene) return;
    if (sceneId) return;
    if (scenes.length > 0) {
      const first = scenes[0];
      loadScene(first.id, first.name, first.data as SceneData);
    }
  }, [projectId, sceneId, scenes, loadScene, prefabSubScene]);

  useEffect(() => {
    if (!currentScene || !sceneId) return;
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

  // Recursive renderer that respects collapsed nodes
  const renderNode = (entity: SceneEntity, depth: number): React.ReactNode[] => {
    const kids = childrenByParent.get(entity.id) ?? [];
    const collapsed = !!entity.collapsed;
    const matchesFilter = matchSet === null ? true : matchSet.has(entity.id);
    const out: React.ReactNode[] = [
      <HierarchyRow
        key={entity.id}
        entity={entity}
        depth={depth}
        hasChildren={kids.length > 0}
        collapsed={collapsed}
        selected={selectedId === entity.id}
        matchesFilter={matchesFilter}
        onPick={() => selectEntity(entity.id)}
        onToggle={() => toggleCollapsed(entity.id)}
        onDuplicate={() => duplicateEntity(entity.id)}
        onDelete={() => removeEntity(entity.id)}
        onUnparent={() => setEntityParent(entity.id, null)}
        onSavePrefab={() => onSavePrefab(entity.id)}
        onDragStart={onDragStart}
        onDragOverRow={onDragOverRow}
        onDragLeaveRow={onDragLeaveRow}
        onDropRow={onDropRow}
        dropTargetId={dropTargetId}
        draggedId={draggedId}
      />,
    ];
    if (!collapsed) {
      for (const c of kids) out.push(...renderNode(c, depth + 1));
    }
    return out;
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Scenes — hidden in prefab edit mode to keep focus on the prefab */}
      {!prefabSubScene && (
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
      )}

      {prefabSubScene && (
        <div className="px-3 py-2 border-b border-amber-500/50 bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-400">
            <Package className="size-3" /> Editing Prefab
          </div>
          <div className="mt-1 text-xs font-medium text-foreground truncate">
            {prefabSubScene.prefabName}
          </div>
        </div>
      )}

      {/* Entities */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-sidebar-border space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Hierarchy
              <span className="ml-1.5 text-muted-foreground/70">({entities.length})</span>
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
          <div
            className="p-1 min-h-full"
            onDragOver={(e) => {
              if (draggedId) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDropRoot();
            }}
          >
            {roots.flatMap((e) => renderNode(e, 0))}
            {entities.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-6 text-center">
                Empty scene.
                <br />
                Use <span className="text-foreground font-medium">+ Add</span> in the toolbar.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
