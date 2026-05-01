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
  Pencil,
  Plus,
  Crosshair,
  Sparkles,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  onRename: () => void;
  onAddChild: () => void;
  onFocus: () => void;
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
  onRename,
  onAddChild,
  onFocus,
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
  const rowInner = (
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
      onDoubleClick={onFocus}
      onContextMenu={onPick}
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
          className="font-heading text-[9px] uppercase tracking-[0.18em] px-1.5 py-px rounded-sm bg-primary/15 text-primary border border-primary/40"
          title="Instance of a Prefab"
        >
          Prefab
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
            className="px-1.5 py-0.5 rounded font-heading text-[9px] uppercase tracking-[0.18em] hover:bg-sidebar-accent text-muted-foreground hover:text-accent"
            title="Unparent (move to root)"
          >
            Unparent
          </button>
        )}
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onSavePrefab();
          }}
          className="px-1.5 py-0.5 rounded font-heading text-[9px] uppercase tracking-[0.18em] hover:bg-sidebar-accent text-muted-foreground hover:text-accent"
          title="Save subtree as Prefab"
        >
          Forge
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowInner}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px]">
        <ContextMenuItem onClick={onRename}>
          <Pencil className="size-3.5 mr-2" /> Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate}>
          <Copy className="size-3.5 mr-2" /> Duplicate
          <span className="ml-auto text-[10px] text-muted-foreground">⌘D</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete}>
          <Trash2 className="size-3.5 mr-2" /> Delete
          <span className="ml-auto text-[10px] text-muted-foreground">Del</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onAddChild}>
          <Plus className="size-3.5 mr-2" /> Add empty child
        </ContextMenuItem>
        <ContextMenuItem onClick={onSavePrefab}>
          <Sparkles className="size-3.5 mr-2" /> Forge as prefab
          <span className="ml-auto text-[10px] text-muted-foreground">⌘G</span>
        </ContextMenuItem>
        {entity.parentId && (
          <ContextMenuItem onClick={onUnparent}>
            <ChevronRight className="size-3.5 mr-2 -rotate-90" /> Unparent
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onFocus}>
          <Crosshair className="size-3.5 mr-2" /> Focus camera
          <span className="ml-auto text-[10px] text-muted-foreground">F</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function Hierarchy() {
  const projectId = useEditor((s) => s.projectId);
  const sceneId = useEditor((s) => s.sceneId);
  const entities = useEditor((s) => s.sceneData.entities);
  const selectedId = useEditor((s) => s.selectedId);
  const selectEntity = useEditor((s) => s.selectEntity);
  const cmdRemoveEntity = useEditor((s) => s.cmdRemoveEntity);
  const cmdDuplicateEntity = useEditor((s) => s.cmdDuplicateEntity);
  const cmdSetEntityParent = useEditor((s) => s.cmdSetEntityParent);
  const cmdRenameEntity = useEditor((s) => s.cmdRenameEntity);
  const cmdAddEmptyChild = useEditor((s) => s.cmdAddEmptyChild);
  const requestFocus = useEditor((s) => s.requestFocus);
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
      cmdSetEntityParent(draggedId, id);
    }
    setDraggedId(null);
    setDropTargetId(null);
  };
  const onDropRoot = useCallback(() => {
    if (!draggedId) return;
    cmdSetEntityParent(draggedId, null);
    setDraggedId(null);
    setDropTargetId(null);
  }, [draggedId, cmdSetEntityParent]);

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

  // Bridge: Ctrl+G dispatches "gameforge:forgePrefab" with the selected
  // entity id; we run the existing prefab-save flow.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ entityId?: string }>).detail;
      const id = detail?.entityId ?? selectedId;
      if (!id) return;
      onSavePrefab(id);
    };
    window.addEventListener("gameforge:forgePrefab", handler);
    return () => window.removeEventListener("gameforge:forgePrefab", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, projectId, entities]);

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
        onDuplicate={() => cmdDuplicateEntity(entity.id)}
        onDelete={() => cmdRemoveEntity(entity.id)}
        onUnparent={() => cmdSetEntityParent(entity.id, null)}
        onSavePrefab={() => onSavePrefab(entity.id)}
        onRename={() => {
          const next = window.prompt("Rename entity:", entity.name);
          if (next && next.trim() && next !== entity.name) cmdRenameEntity(entity.id, next.trim());
        }}
        onAddChild={() => cmdAddEmptyChild(entity.id)}
        onFocus={() => {
          selectEntity(entity.id);
          requestFocus();
        }}
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
        <div className="px-3 py-2 border-b border-primary/50 bg-primary/10 gold-glow-sm">
          <div className="font-heading text-[10px] uppercase tracking-[0.22em] text-primary">
            Editing Prefab
          </div>
          <div className="mt-1 font-display text-sm tracking-wide brand-gold truncate">
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
