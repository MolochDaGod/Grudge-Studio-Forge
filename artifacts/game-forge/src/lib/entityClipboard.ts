/**
 * Entity clipboard for Ctrl+C / Ctrl+V in the Forge hierarchy.
 * In-memory first; also mirrors JSON to navigator.clipboard when available.
 */
import type { SceneEntity } from "@/scene/types";
import { cloneSubtree } from "@/lib/hierarchy";
import { useEditor } from "@/store/editor";
import { addEntitiesCommand } from "@/lib/commands";

export interface EntityClipboardPayload {
  version: 1;
  kind: "gameforge-entities";
  rootId: string;
  entities: SceneEntity[];
  copiedAt: string;
}

let mem: EntityClipboardPayload | null = null;

function makeStoreLike() {
  const get = useEditor.getState;
  return {
    getEntities: () => get().sceneData.entities,
    setEntities: (entities: SceneEntity[]) => {
      get().setEntities(entities);
    },
    selectEntity: (id: string | null) => get().selectEntity(id),
  };
}

/** Serialize selection (root + descendants) into the clipboard. */
export function copySelectedEntity(): boolean {
  const { selectedId, sceneData, pushLog } = useEditor.getState();
  if (!selectedId) {
    pushLog("warn", "Copy: nothing selected");
    return false;
  }
  const entities = sceneData.entities;
  const root = entities.find((e) => e.id === selectedId);
  if (!root) return false;
  // Clone with fresh ids reserved for paste; store source tree structure
  const subtreeIds = new Set([
    selectedId,
    ...entities
      .filter((e) => {
        // include via cloneSubtree logic — grab full subtree JSON snapshot
        return false;
      })
      .map((e) => e.id),
  ]);
  void subtreeIds;
  // Snapshot source entities (original ids) then re-id on paste
  const desc = getSubtreeEntities(entities, selectedId);
  const payload: EntityClipboardPayload = {
    version: 1,
    kind: "gameforge-entities",
    rootId: selectedId,
    entities: JSON.parse(JSON.stringify(desc)) as SceneEntity[],
    copiedAt: new Date().toISOString(),
  };
  mem = payload;
  try {
    void navigator.clipboard?.writeText(JSON.stringify(payload));
  } catch {
    /* in-memory still works */
  }
  pushLog(
    "info",
    `Copied "${root.name}" (${payload.entities.length} entity${payload.entities.length === 1 ? "" : "ies"})`,
  );
  return true;
}

function getSubtreeEntities(entities: SceneEntity[], rootId: string): SceneEntity[] {
  const byParent = new Map<string | null, SceneEntity[]>();
  for (const e of entities) {
    const p = e.parentId ?? null;
    const arr = byParent.get(p) ?? [];
    arr.push(e);
    byParent.set(p, arr);
  }
  const out: SceneEntity[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const e = entities.find((x) => x.id === id);
    if (!e) continue;
    out.push(e);
    for (const kid of byParent.get(id) ?? []) stack.push(kid.id);
  }
  return out;
}

/** Paste clipboard subtree under current selection parent (or scene root). */
export async function pasteEntityClipboard(): Promise<boolean> {
  const { selectedId, sceneData, pushLog, commandStack } = useEditor.getState();
  let payload = mem;

  if (!payload) {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text && text.includes("gameforge-entities")) {
        const parsed = JSON.parse(text) as EntityClipboardPayload;
        if (parsed?.kind === "gameforge-entities" && Array.isArray(parsed.entities)) {
          payload = parsed;
          mem = parsed;
        }
      }
    } catch {
      /* no clipboard permission */
    }
  }

  if (!payload || payload.entities.length === 0) {
    pushLog("warn", "Paste: clipboard empty — copy an entity first (Ctrl+C)");
    return false;
  }

  // Re-id via cloneSubtree from a temporary world containing only the snapshot
  const snapRoot = payload.rootId;
  const cloned = cloneSubtree(payload.entities, snapRoot, selectedId
    ? sceneData.entities.find((e) => e.id === selectedId)?.parentId ?? null
    : null);

  if (cloned.length === 0) {
    pushLog("error", "Paste: failed to clone clipboard entities");
    return false;
  }

  // Offset so paste is visible next to selection
  const offset = 1.25;
  if (selectedId) {
    const sel = sceneData.entities.find((e) => e.id === selectedId);
    if (sel) {
      cloned[0].transform = {
        ...cloned[0].transform,
        position: [
          sel.transform.position[0] + offset,
          sel.transform.position[1],
          sel.transform.position[2] + offset,
        ],
      };
    }
  } else {
    cloned[0].transform = {
      ...cloned[0].transform,
      position: [
        cloned[0].transform.position[0] + offset,
        cloned[0].transform.position[1],
        cloned[0].transform.position[2] + offset,
      ],
    };
  }
  cloned[0].name = `${cloned[0].name.replace(/ Copy$/, "")} Copy`;

  const store = makeStoreLike();
  commandStack.push(
    addEntitiesCommand(store, cloned, `Paste ${cloned[0].name}`, cloned[0].id),
  );
  useEditor.setState({ isDirty: true });
  pushLog(
    "info",
    `Pasted "${cloned[0].name}" (${cloned.length} entity${cloned.length === 1 ? "" : "ies"})`,
  );
  return true;
}

export function hasEntityClipboard(): boolean {
  return mem != null && mem.entities.length > 0;
}
