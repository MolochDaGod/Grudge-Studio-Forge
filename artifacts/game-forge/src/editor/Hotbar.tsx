/**
 * Quick-prefab Hotbar — eight slots pinned to the bottom of the viewport.
 * - Click a slot or press 1-8 to spawn the assigned prefab into the scene.
 * - Right-click a slot to clear it.
 * - Right-click a prefab in the Prefabs panel and pick "Assign to slot N"
 *   (handled in PrefabsPanel.tsx) — or drag-drop a prefab onto a slot.
 *
 * Slots persist in the editor store (`hotbar`) for the session.
 */

import { useEffect, useMemo, useRef } from "react";
import { useEditor } from "@/store/editor";
import { isInputFocused } from "@/lib/hotkeys";
import {
  useListPrefabs,
  getListPrefabsQueryKey,
  type Prefab,
} from "@workspace/api-client-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { SceneEntity } from "@/scene/types";

interface PrefabPayload {
  entities?: SceneEntity[];
  rootId?: string | null;
}

export function Hotbar() {
  const projectId = useEditor((s) => s.projectId);
  const hotbar = useEditor((s) => s.hotbar);
  const setHotbarSlot = useEditor((s) => s.setHotbarSlot);
  const spawnPrefabEntities = useEditor((s) => s.spawnPrefabEntities);
  const pushLog = useEditor((s) => s.pushLog);
  const isPlaying = useEditor((s) => s.isPlaying);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);

  const { data: prefabs = [] } = useListPrefabs(projectId ?? 0, {
    query: { queryKey: getListPrefabsQueryKey(projectId ?? 0), enabled: !!projectId },
  });

  const prefabsById = useMemo(() => {
    const m = new Map<number, Prefab>();
    for (const p of prefabs) m.set(p.id, p);
    return m;
  }, [prefabs]);

  // Hold the freshest spawn closure in a ref so the keydown listener (bound
  // once on mount) always sees current store data without re-binding.
  const spawnSlotRef = useRef<(slot: number) => void>(() => {});

  const onSpawnSlot = (slot: number) => {
    const id = hotbar[slot];
    if (id == null) {
      pushLog("warn", `Hotbar slot ${slot + 1} is empty. Right-click a prefab in the Prefabs tab to assign it.`);
      return;
    }
    const p = prefabsById.get(id);
    if (!p) {
      pushLog("warn", `Hotbar slot ${slot + 1} references a missing prefab (id ${id}).`);
      return;
    }
    const data = p.data as PrefabPayload;
    if (!data?.entities || data.entities.length === 0) {
      pushLog("warn", `Prefab "${p.name}" is empty.`);
      return;
    }
    const root = spawnPrefabEntities(data.entities, p.id);
    if (root) pushLog("info", `Spawned "${p.name}" via slot ${slot + 1}.`);
  };
  spawnSlotRef.current = onSpawnSlot;

  // Keys 1..8 spawn the corresponding hotbar slot. We only bind the listener
  // when the hotbar is actually active (not playing, not in the prefab
  // sub-scene editor, and a project is loaded) so digit keys don't leak into
  // gameplay or prefab editing.
  const hotkeysActive = !isPlaying && !prefabSubScene && !!projectId;
  useEffect(() => {
    if (!hotkeysActive) return;
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key < "1" || e.key > "8") return;
      const slot = Number(e.key) - 1;
      e.preventDefault();
      spawnSlotRef.current(slot);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hotkeysActive]);

  // Hide while playing or in the prefab sub-scene editor (avoids accidental
  // spawns during play, and keeps the prefab editor focused on its subtree).
  if (isPlaying || prefabSubScene || !projectId) return null;

  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-2 py-1.5 rounded-lg bg-card/90 backdrop-blur border border-card-border shadow-lg pointer-events-auto select-none"
      data-testid="hotbar"
    >
      {hotbar.map((prefabId, idx) => {
        const p = prefabId != null ? prefabsById.get(prefabId) : undefined;
        const empty = !p;
        return (
          <ContextMenu key={idx}>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => onSpawnSlot(idx)}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("text/prefab-id")) {
                    e.preventDefault();
                  }
                }}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData("text/prefab-id");
                  if (!raw) return;
                  const id = Number(raw);
                  if (Number.isFinite(id)) setHotbarSlot(idx, id);
                }}
                title={
                  empty
                    ? `Slot ${idx + 1} — empty (assign a prefab from the Prefabs tab)`
                    : `Spawn ${p!.name} (key ${idx + 1})`
                }
                className={`relative w-14 h-14 rounded border text-[10px] font-heading uppercase tracking-[0.14em] flex flex-col items-center justify-center transition-colors ${
                  empty
                    ? "border-dashed border-border bg-background/40 text-muted-foreground/60 hover:border-primary/40"
                    : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover-gold-glow"
                }`}
                data-testid={`hotbar-slot-${idx}`}
              >
                <span className="absolute top-0.5 left-1 text-[9px] text-muted-foreground/80 font-mono">
                  {idx + 1}
                </span>
                <span className="px-1 text-center leading-tight line-clamp-2 mt-1">
                  {empty ? "—" : p!.name}
                </span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                disabled={empty}
                onClick={() => onSpawnSlot(idx)}
              >
                Spawn now
              </ContextMenuItem>
              <ContextMenuItem
                disabled={empty}
                onClick={() => setHotbarSlot(idx, null)}
              >
                Clear slot
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
