import type { SceneEntity } from "@/scene/types";
import { inferDefaultLayer } from "@workspace/scene-schema";
import { nanoid } from "nanoid";

/** Returns ids of all descendants (children, grandchildren, …) of `rootId`.
 *  Defensive against pre-existing cycles in imported/corrupt data via a
 *  `visited` set. */
export function getDescendants(entities: SceneEntity[], rootId: string): string[] {
  const out: string[] = [];
  const childrenMap = new Map<string, string[]>();
  for (const e of entities) {
    const p = e.parentId ?? null;
    if (p === null) continue;
    const arr = childrenMap.get(p) ?? [];
    arr.push(e.id);
    childrenMap.set(p, arr);
  }
  const visited = new Set<string>([rootId]);
  const stack = [...(childrenMap.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    out.push(id);
    const kids = childrenMap.get(id);
    if (kids) stack.push(...kids);
  }
  return out;
}

/** True if making `childId` a descendant of `newParentId` would create a cycle.
 *  (i.e. the new parent is the child itself or already a descendant of the child). */
export function wouldCycle(
  entities: SceneEntity[],
  childId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  if (newParentId === childId) return true;
  const desc = new Set(getDescendants(entities, childId));
  return desc.has(newParentId);
}

/** Build a children-by-parent map. Root entities live at key `null`. */
export function buildTree(entities: SceneEntity[]): Map<string | null, SceneEntity[]> {
  const m = new Map<string | null, SceneEntity[]>();
  // Seed for stable iteration order matching `entities` array
  for (const e of entities) {
    const p = e.parentId ?? null;
    const arr = m.get(p) ?? [];
    arr.push(e);
    m.set(p, arr);
  }
  return m;
}

/** Deep-clone an entity and all its descendants, generating new ids and
 *  remapping parentId references to the new ids. The new root keeps the
 *  same parentId as `rootId` unless `newRootParentId` is provided. */
export function cloneSubtree(
  entities: SceneEntity[],
  rootId: string,
  newRootParentId?: string | null,
): SceneEntity[] {
  const root = entities.find((e) => e.id === rootId);
  if (!root) return [];
  const idMap = new Map<string, string>();
  const subtreeIds = [rootId, ...getDescendants(entities, rootId)];
  for (const id of subtreeIds) idMap.set(id, nanoid(8));
  return subtreeIds.map((id) => {
    const e = entities.find((x) => x.id === id)!;
    const cloned: SceneEntity = JSON.parse(JSON.stringify(e));
    cloned.id = idMap.get(id)!;
    if (id === rootId) {
      cloned.parentId = newRootParentId ?? e.parentId ?? null;
    } else {
      cloned.parentId = idMap.get(e.parentId ?? "") ?? null;
    }
    return cloned;
  });
}

/** Defensively repair invalid hierarchy data on load/import. Three issues are
 *  handled, each of which would otherwise cause entities to silently disappear
 *  from both the Hierarchy panel and the Viewport (because `buildTree` only
 *  surfaces entities reachable from the `null` root):
 *
 *    1. parentId points at an id that doesn't exist in the scene → re-root.
 *    2. duplicate ids → keep the first, re-id later collisions, log a warning.
 *    3. parent cycle (a → b → a) → break the cycle on the second link by
 *       re-rooting the offending entity.
 *
 *  Returns the cleaned entity list and any human-readable warnings the caller
 *  may want to surface in the console panel. */
export function sanitizeEntities(
  entities: SceneEntity[],
): { entities: SceneEntity[]; warnings: string[] } {
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const cleaned: SceneEntity[] = [];

  // Pass 1: dedupe ids (keep first occurrence; re-id later duplicates).
  for (const e of entities) {
    if (!seenIds.has(e.id)) {
      seenIds.add(e.id);
      cleaned.push(e);
      continue;
    }
    const newId = nanoid(8);
    warnings.push(`Duplicate entity id "${e.id}" → re-id'd to "${newId}"`);
    cleaned.push({ ...e, id: newId });
    seenIds.add(newId);
  }

  // Pass 2: re-root entities whose parentId points at a missing entity.
  const idSet = new Set(cleaned.map((e) => e.id));
  for (const e of cleaned) {
    if (e.parentId && !idSet.has(e.parentId)) {
      warnings.push(
        `Entity "${e.name}" had missing parent "${e.parentId}" — re-rooted.`,
      );
      e.parentId = null;
    }
  }

  // Pass 3: break cycles. Walk each entity's parent chain; if we revisit it,
  // sever the link by re-rooting.
  for (const e of cleaned) {
    if (!e.parentId) continue;
    const visited = new Set<string>([e.id]);
    let cursor: string | null | undefined = e.parentId;
    while (cursor) {
      if (visited.has(cursor)) {
        warnings.push(`Cycle detected at "${e.name}" — re-rooted.`);
        e.parentId = null;
        break;
      }
      visited.add(cursor);
      const next = cleaned.find((x) => x.id === cursor);
      cursor = next?.parentId ?? null;
    }
  }

  // Pass 4: infer Unity-style physics layer for any entity that doesn't
  // already have one. Existing layers are never overwritten so user-set
  // values (or AI-set values) survive a reload untouched.
  for (const e of cleaned) {
    if (!e.layer) e.layer = inferDefaultLayer(e);
  }

  return { entities: cleaned, warnings };
}

/** Re-id every entity in a tree (used when spawning a prefab into a scene).
 *  Returns the new entities and the id of the new root. */
export function reidTree(
  entities: SceneEntity[],
  parentIdForRoots: string | null = null,
): { entities: SceneEntity[]; rootIds: string[] } {
  const idMap = new Map<string, string>();
  for (const e of entities) idMap.set(e.id, nanoid(8));
  const rootIds: string[] = [];
  const next = entities.map((e) => {
    const cloned: SceneEntity = JSON.parse(JSON.stringify(e));
    cloned.id = idMap.get(e.id)!;
    const oldParent = e.parentId ?? null;
    if (oldParent === null) {
      cloned.parentId = parentIdForRoots;
      rootIds.push(cloned.id);
    } else {
      const mapped = idMap.get(oldParent);
      cloned.parentId = mapped ?? parentIdForRoots;
      if (!mapped) rootIds.push(cloned.id);
    }
    return cloned;
  });
  return { entities: next, rootIds };
}
