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
  Wand2,
  Move,
  Mountain,
  Anchor,
  Route,
  User as UserIcon,
  Skull,
  PackagePlus,
  MessageSquare,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useEditor } from "@/store/editor";
import { Globe2 } from "lucide-react";
import {
  resolveInheritedFields,
  indexEntitiesById,
  type InheritedFields,
} from "@workspace/scene-schema";
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
  // Soft / dynamic Material entity types — visualised in the
  // hierarchy with thematic stand-ins so users can scan a tree of
  // mixed-Material entities at a glance.
  cloth: Square,
  flag: Square,
  particles: Circle,
  terrain: Square,
};

/** Visual presentation tables for the hierarchy inheritance chips.
 *  Kept here (not in `scene-schema`) because they're purely UI-side —
 *  the schema package shouldn't know about Tailwind colors. The 3-letter
 *  layer codes match what users see in collision-matrix tooltips so the
 *  vocabulary is consistent across the editor. */
const LAYER_BADGE: Record<string, { code: string; cls: string; label: string }> = {
  Default:       { code: "Def", cls: "bg-slate-500/20 text-slate-300 border-slate-500/40",   label: "Default — generic prop" },
  Terrain:       { code: "Ter", cls: "bg-amber-700/20 text-amber-300 border-amber-700/40",   label: "Terrain — static ground/walls" },
  Player:        { code: "Plr", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "Player — controlled by user" },
  NPC:           { code: "NPC", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40",       label: "NPC — AI-driven character" },
  Item:          { code: "Itm", cls: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40", label: "Item — pickup / loot" },
  Projectile:    { code: "Prj", cls: "bg-orange-500/20 text-orange-300 border-orange-500/40", label: "Projectile — bullets, arrows" },
  Trigger:       { code: "Trg", cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",       label: "Trigger — sensor volume" },
  Water:         { code: "Wtr", cls: "bg-sky-500/20 text-sky-300 border-sky-500/40",          label: "Water — swimmable / sensor" },
  IgnoreRaycast: { code: "IgR", cls: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40",       label: "IgnoreRaycast — hidden from rays" },
  UI3D:          { code: "UI",  cls: "bg-violet-500/20 text-violet-300 border-violet-500/40", label: "UI3D — decorative, no physics" },
};
const SURFACE_BADGE: Record<string, { code: string; cls: string; label: string }> = {
  Walk:  { code: "W", cls: "text-emerald-300", label: "Walk — ground locomotion" },
  Climb: { code: "C", cls: "text-amber-300",   label: "Climb — vertical traversal" },
  Swim:  { code: "S", cls: "text-sky-300",     label: "Swim — water locomotion" },
  Jump:  { code: "J", cls: "text-fuchsia-300", label: "Jump — must be jumped onto" },
  Dig:   { code: "D", cls: "text-orange-300",  label: "Dig — destructible terrain" },
  None:  { code: "·", cls: "text-muted-foreground", label: "None — non-traversable" },
};
const MATERIAL_BADGE: Record<string, { code: string; cls: string; label: string }> = {
  Solid:    { code: "▣", cls: "text-slate-300",   label: "Solid" },
  Metal:    { code: "M", cls: "text-zinc-300",    label: "Metal" },
  Glass:    { code: "G", cls: "text-cyan-200",    label: "Glass" },
  Wood:     { code: "W", cls: "text-amber-700",   label: "Wood" },
  Stone:    { code: "S", cls: "text-stone-400",   label: "Stone" },
  Cloth:    { code: "C", cls: "text-rose-300",    label: "Cloth" },
  Flag:     { code: "F", cls: "text-rose-400",    label: "Flag" },
  Foliage:  { code: "L", cls: "text-emerald-400", label: "Foliage" },
  Liquid:   { code: "~", cls: "text-sky-300",     label: "Liquid" },
  Particle: { code: "•", cls: "text-fuchsia-300", label: "Particle" },
  Smoke:    { code: "~", cls: "text-zinc-400",    label: "Smoke" },
};

/** Per-row inheritance chip. `own=true` renders bold/solid (the value is
 *  set on this entity); `own=false` renders dim/italic and the tooltip
 *  notes which ancestor it was inherited from — so users can scan a
 *  parent's tags propagating down a subtree at a glance. */
function InheritChip({
  entry,
  own,
  fromName,
  testid,
}: {
  entry: { code: string; cls: string; label: string };
  own: boolean;
  fromName?: string;
  testid?: string;
}) {
  const tip = own ? entry.label : `${entry.label} — inherited from "${fromName ?? "parent"}"`;
  return (
    <span
      title={tip}
      className={`inline-flex items-center justify-center px-1 min-w-4 h-4 rounded-sm border text-[9px] font-mono leading-none ${
        entry.cls
      } ${own ? "" : "italic opacity-55 border-transparent"}`}
      data-testid={testid}
    >
      {entry.code}
    </span>
  );
}

interface RowProps {
  entity: SceneEntity;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  selected: boolean;
  matchesFilter: boolean;
  /** Resolved tri-axis tags (own value wins, else nearest ancestor).
   *  Pre-computed once per render in the parent for O(N) cost across
   *  the whole tree instead of O(N·depth) if each row resolved itself. */
  inherited: InheritedFields;
  /** Display name of the ancestor each axis was inherited from (for the
   *  chip tooltip). Undefined when the value is set on this entity. */
  inheritedFrom: { layer?: string; surface?: string; material?: string };
  onPick: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUnparent: () => void;
  onSavePrefab: () => void;
  onRename: () => void;
  onAddChild: () => void;
  onFocus: () => void;
  onSmartSetup: (kind: "terrain" | "pickup" | "spawn" | "enemy" | "npc") => void;
  onMoveTo: (target: "terrain" | "parent" | "navmesh") => void;
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
  inherited,
  inheritedFrom,
  onPick,
  onToggle,
  onDuplicate,
  onDelete,
  onUnparent,
  onSavePrefab,
  onRename,
  onAddChild,
  onFocus,
  onSmartSetup,
  onMoveTo,
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
      {/* Tri-axis inheritance chips. Compact one-letter / 3-letter
        * badges so a 30-row hierarchy still scans at a glance. We
        * only render a chip when the resolved value is "interesting"
        * — Default layer / None surface are omitted unless the user
        * explicitly set them (avoids visual noise on prop-heavy
        * scenes). Italic+dim = inherited from an ancestor; solid =
        * set on this entity. */}
      {(() => {
        const layerName = inherited.layer;
        const showLayer = layerName && (entity.layer || layerName !== "Default");
        const surfaceName = inherited.surface;
        const showSurface = surfaceName && (entity.surface || surfaceName !== "None");
        const matKind = inherited.materialKind;
        const showMat = matKind && (entity.material?.kind || matKind !== "Solid");
        if (!showLayer && !showSurface && !showMat) return null;
        return (
          <div className="flex items-center gap-0.5 mr-1 shrink-0">
            {showLayer && LAYER_BADGE[layerName] && (
              <InheritChip
                entry={LAYER_BADGE[layerName]}
                own={!!entity.layer}
                fromName={inheritedFrom.layer}
                testid={`row-${entity.id}-layer`}
              />
            )}
            {showSurface && SURFACE_BADGE[surfaceName] && (
              <InheritChip
                entry={SURFACE_BADGE[surfaceName]}
                own={!!entity.surface}
                fromName={inheritedFrom.surface}
                testid={`row-${entity.id}-surface`}
              />
            )}
            {showMat && MATERIAL_BADGE[matKind] && (
              <InheritChip
                entry={MATERIAL_BADGE[matKind]}
                own={!!entity.material?.kind}
                fromName={inheritedFrom.material}
                testid={`row-${entity.id}-material`}
              />
            )}
          </div>
        );
      })()}
      {isPrefabInstance && (
        <span
          className="font-heading text-[9px] uppercase tracking-[0.18em] px-1.5 py-px rounded-sm bg-primary/15 text-primary border border-primary/40"
          title="Instance of a Prefab"
        >
          Prefab
        </span>
      )}
      {entity.behavior && (
        <span
          className="text-[9px] font-mono text-fuchsia-300/90 px-1 py-px rounded-sm bg-fuchsia-500/15 border border-fuchsia-500/30"
          title={`Built-in behavior: ${entity.behavior}`}
        >
          AI
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
        {/* Move-to submenu — physics-aware snap actions. "Terrain" and
          * "Pathfinding" need access to the live THREE scene + the
          * cached navmesh, so they fire a custom DOM event the
          * Viewport's effect picks up (mirrors the existing
          * `gameforge:forgePrefab` pattern). "Parent" is a pure local
          * mutation (zero out the local position) so it stays in this
          * component's onMoveTo callback. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Move className="size-3.5 mr-2" /> Move to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[200px]">
            <ContextMenuItem onClick={() => onMoveTo("terrain")}>
              <Mountain className="size-3.5 mr-2" /> Terrain (snap to ground)
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onMoveTo("navmesh")}>
              <Route className="size-3.5 mr-2" /> Pathfinding (nearest navmesh)
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onMoveTo("parent")}
              disabled={!entity.parentId}
            >
              <Anchor className="size-3.5 mr-2" /> Parent origin
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {/* Smart Setup — one-click presets that combine layer + surface
          * + behavior tagging so designers don't have to fish through
          * three inspector dropdowns to make a working pickup, enemy,
          * or spawnpoint. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Wand2 className="size-3.5 mr-2" /> Smart setup
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[220px]">
            <ContextMenuItem onClick={() => onSmartSetup("terrain")}>
              <Mountain className="size-3.5 mr-2" /> Walkable terrain
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSmartSetup("pickup")}>
              <PackagePlus className="size-3.5 mr-2" /> Pickup trigger
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSmartSetup("spawn")}>
              <Sparkles className="size-3.5 mr-2" /> Player spawnpoint
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSmartSetup("enemy")}>
              <Skull className="size-3.5 mr-2" /> Enemy NPC
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSmartSetup("npc")}>
              <MessageSquare className="size-3.5 mr-2" /> Friendly NPC (dialog)
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
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
  const cmdUpdateEntity = useEditor((s) => s.cmdUpdateEntity);
  const cmdSetEntityTransform = useEditor((s) => s.cmdSetEntityTransform);
  const requestFocus = useEditor((s) => s.requestFocus);
  const toggleCollapsed = useEditor((s) => s.cmdToggleCollapsed);
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

  // Build the entity index + per-entity resolved inheritance ONCE per
  // hierarchy render. resolveInheritedFields walks the parent chain
  // (capped at depth 64) so doing this in the parent is O(N·avg_depth)
  // total instead of O(N²) if every row resolved itself. The
  // `inheritedFrom` map records WHICH ancestor each axis came from so
  // the chip tooltip can name it ("inherited from 'Map root'").
  const { inheritedById, inheritedFromById } = useMemo(() => {
    const idx = indexEntitiesById(entities);
    const inh = new Map<string, InheritedFields>();
    const from = new Map<string, { layer?: string; surface?: string; material?: string }>();
    for (const e of entities) {
      const r = resolveInheritedFields(e, idx);
      inh.set(e.id, r);
      // Walk up to find the ancestor that actually defined each axis,
      // for the tooltip. We re-walk here (cheap — bounded by depth)
      // because resolveInheritedFields doesn't return provenance.
      const provenance: { layer?: string; surface?: string; material?: string } = {};
      if (!e.layer && r.layer) {
        let cur = e.parentId ? idx.get(e.parentId) : undefined;
        while (cur) {
          if (cur.layer) { provenance.layer = cur.name; break; }
          cur = cur.parentId ? idx.get(cur.parentId) : undefined;
        }
      }
      if (!e.surface && r.surface) {
        let cur = e.parentId ? idx.get(e.parentId) : undefined;
        while (cur) {
          if (cur.surface) { provenance.surface = cur.name; break; }
          cur = cur.parentId ? idx.get(cur.parentId) : undefined;
        }
      }
      if (!e.material?.kind && r.materialKind) {
        let cur = e.parentId ? idx.get(e.parentId) : undefined;
        while (cur) {
          if (cur.material?.kind) { provenance.material = cur.name; break; }
          cur = cur.parentId ? idx.get(cur.parentId) : undefined;
        }
      }
      from.set(e.id, provenance);
    }
    return { inheritedById: inh, inheritedFromById: from };
  }, [entities]);

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
        inherited={inheritedById.get(entity.id) ?? {}}
        inheritedFrom={inheritedFromById.get(entity.id) ?? {}}
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
        onSmartSetup={(kind) => {
          // Combined layer + surface + behavior preset. Each preset
          // mirrors the manual sequence a designer would do across the
          // inspector's three dropdowns; bundling them avoids fishing
          // for the right combination from a 10-layer × 6-surface ×
          // 8-behavior matrix.
          cmdUpdateEntity(entity.id, (d) => {
            switch (kind) {
              case "terrain":
                d.layer = "Terrain";
                d.surface = "Walk";
                break;
              case "pickup":
                // Layer "Trigger" auto-spawns the body as a Rapier
                // sensor (see DEFAULT_SENSOR_LAYERS), so no per-entity
                // sensor flag needed — `pickup-trigger` behavior reads
                // the intersection events from there.
                d.layer = "Trigger";
                d.behavior = "pickup-trigger";
                d.physics = { ...(d.physics ?? {}), bodyType: "fixed" };
                break;
              case "spawn":
                d.layer = "Trigger";
                d.behavior = "spawnpoint";
                break;
              case "enemy":
                d.layer = "NPC";
                d.behavior = "enemy-deathmatch";
                break;
              case "npc":
                d.layer = "NPC";
                d.behavior = "npc-dialog";
                if (!d.npcLine) d.npcLine = "Hello, traveler!";
                break;
            }
          });
          pushLog("info", `Smart-setup applied: ${kind} → "${entity.name}"`);
        }}
        onMoveTo={(target) => {
          if (target === "parent") {
            // "Move to parent" = local position [0,0,0]. Disabled in
            // the menu when the entity has no parent.
            cmdSetEntityTransform(entity.id, "position", [0, 0, 0]);
            return;
          }
          // Terrain / navmesh snapping needs the live THREE scene +
          // (for navmesh) the cached recast blob. Both live in
          // Viewport so we cross the boundary via a custom DOM event,
          // mirroring the existing `gameforge:forgePrefab` pattern.
          window.dispatchEvent(
            new CustomEvent("gameforge:moveTo", {
              detail: { entityId: entity.id, target },
            }),
          );
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
            {/* Environment pseudo-row — always first, always present.
              * Selecting it clears the entity selection so the inspector
              * shows the scene-wide Environment panel (sky, fog, sun,
              * ambient, gravity). Before this users had to deselect
              * everything and hope the inspector panel was open to find
              * those settings. */}
            <div
              onClick={() => selectEntity(null)}
              className={`group flex items-center gap-1 pr-2 py-1 rounded text-sm cursor-pointer hover-elevate ${
                selectedId === null
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : ""
              }`}
              style={{ paddingLeft: 6 }}
              title="Scene environment — sky, fog, sun, ambient, gravity"
              data-testid="row-environment"
            >
              <span className="size-3.5" />
              <Globe2 className="size-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate font-heading text-[11px] uppercase tracking-[0.18em]">
                Environment
              </span>
              <span className="text-[9px] text-muted-foreground font-mono">
                sky · fog · sun
              </span>
            </div>
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
