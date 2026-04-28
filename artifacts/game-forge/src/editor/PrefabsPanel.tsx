import { Package, Trash2, Plus, ExternalLink, Loader2 } from "lucide-react";
import {
  useListPrefabs,
  useDeletePrefab,
  useUpdatePrefab,
  getListPrefabsQueryKey,
} from "@workspace/api-client-react";
import type { Prefab } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditor } from "@/store/editor";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SceneEntity } from "@/scene/types";

interface PrefabPayload {
  entities?: SceneEntity[];
  rootId?: string | null;
}

export function PrefabsPanel() {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const spawnPrefabEntities = useEditor((s) => s.spawnPrefabEntities);
  const openPrefabSubScene = useEditor((s) => s.openPrefabSubScene);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);
  const closePrefabSubScene = useEditor((s) => s.closePrefabSubScene);
  const getPrefabBufferEntities = useEditor((s) => s.getPrefabBufferEntities);
  const isDirty = useEditor((s) => s.isDirty);
  const markSaved = useEditor((s) => s.markSaved);

  const qc = useQueryClient();
  const { data: prefabs = [], isLoading } = useListPrefabs(projectId ?? 0, {
    query: { queryKey: getListPrefabsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const deletePrefab = useDeletePrefab();
  const updatePrefab = useUpdatePrefab();

  const onSpawn = (p: Prefab) => {
    const data = p.data as PrefabPayload;
    if (!data?.entities || data.entities.length === 0) {
      pushLog("warn", `Prefab "${p.name}" is empty.`);
      return;
    }
    const root = spawnPrefabEntities(data.entities, p.id);
    if (root) pushLog("info", `Spawned prefab "${p.name}" → ${root.name}`);
  };

  const onOpen = (p: Prefab) => {
    const data = p.data as PrefabPayload;
    if (!data?.entities || data.entities.length === 0) {
      pushLog("warn", `Prefab "${p.name}" is empty — open with Save-as-Prefab from the hierarchy first.`);
      return;
    }
    openPrefabSubScene(p.id, p.name, data.entities);
    pushLog("info", `Opened prefab "${p.name}" for editing in sub-scene.`);
  };

  const onSavePrefabBuffer = async () => {
    if (!prefabSubScene || !projectId) return;
    const entities = getPrefabBufferEntities();
    try {
      await updatePrefab.mutateAsync({
        id: prefabSubScene.prefabId,
        data: {
          name: prefabSubScene.prefabName,
          data: { entities, rootId: entities[0]?.id ?? null },
        },
      });
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      markSaved();
      pushLog("info", `Saved prefab "${prefabSubScene.prefabName}" (${entities.length} entities)`);
    } catch (err) {
      pushLog("error", `Save prefab failed: ${(err as Error).message}`);
    }
  };

  const onCloseSubScene = () => {
    if (isDirty) {
      const ok = confirm(
        "Close prefab sub-scene? You have unsaved prefab changes — they will be discarded.",
      );
      if (!ok) return;
    }
    closePrefabSubScene();
  };

  const onDelete = async (p: Prefab) => {
    if (!projectId) return;
    if (!confirm(`Delete prefab "${p.name}"? Existing scene instances will remain.`)) return;
    try {
      await deletePrefab.mutateAsync({ id: p.id });
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      if (prefabSubScene?.prefabId === p.id) {
        // Skip the dirty-check here — the prefab is gone, so changes can't
        // be saved anyway. Just restore the parent scene.
        closePrefabSubScene();
      }
      pushLog("info", `Deleted prefab "${p.name}".`);
    } catch (err) {
      pushLog("error", `Delete prefab failed: ${(err as Error).message}`);
    }
  };

  if (!projectId) {
    return (
      <div className="p-4 text-xs text-muted-foreground">Open a project to manage prefabs.</div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Package className="size-3" /> Prefabs ({prefabs.length})
        </div>
        {prefabSubScene && (
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={onSavePrefabBuffer}
              disabled={updatePrefab.isPending}
              data-testid="button-save-prefab-buffer"
            >
              {updatePrefab.isPending ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <Package className="size-3 mr-1" />
              )}
              Save Prefab
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onCloseSubScene}
              data-testid="button-close-prefab-subscene"
            >
              Close Sub-scene
            </Button>
          </div>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">
          {isLoading && (
            <div className="text-xs text-muted-foreground">Loading prefabs…</div>
          )}
          {!isLoading && prefabs.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center">
              No prefabs yet. Select an entity in the hierarchy and click the
              <Package className="size-3 inline mx-1 align-text-bottom" />
              icon to save its subtree as a prefab.
            </div>
          )}
          {prefabs.map((p) => {
            const data = p.data as PrefabPayload;
            const count = data?.entities?.length ?? 0;
            const editing = prefabSubScene?.prefabId === p.id;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-2 py-2 rounded-md border ${
                  editing
                    ? "bg-amber-500/10 border-amber-500/50"
                    : "bg-card border-card-border hover-elevate"
                }`}
                data-testid={`prefab-${p.id}`}
              >
                <Package className="size-4 text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {count} {count === 1 ? "entity" : "entities"} · #{p.id}
                    {editing && <span className="ml-2 text-amber-400">· editing</span>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onSpawn(p)}
                  disabled={!!prefabSubScene}
                  title="Spawn an instance into the current scene"
                  data-testid={`button-spawn-prefab-${p.id}`}
                >
                  <Plus className="size-3 mr-1" /> Spawn
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onOpen(p)}
                  disabled={!!prefabSubScene && !editing}
                  title="Open prefab in its own sub-scene editor"
                  data-testid={`button-open-prefab-${p.id}`}
                >
                  <ExternalLink className="size-3 mr-1" /> Open
                </Button>
                <button
                  onClick={() => onDelete(p)}
                  className="p-1.5 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                  title="Delete prefab"
                  data-testid={`button-delete-prefab-${p.id}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
