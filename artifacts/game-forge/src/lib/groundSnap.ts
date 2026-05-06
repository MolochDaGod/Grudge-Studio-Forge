/**
 * Ground-snap helpers for the editor's translate gizmo.
 *
 * When the user holds Shift+Ctrl (or Shift+Meta on macOS) while dragging
 * the move gizmo, the dragged entity continuously snaps its Y to the
 * ground surface beneath its current XZ. This module isolates the small
 * pure helpers (modifier check + Y override) so the React viewport wiring
 * stays thin and the behavior is unit-testable without WebGL.
 *
 * The downward raycast itself is delegated to `groundProbe` from
 * `@/scene/PlayRuntime` so the editor uses the SAME machinery as
 * `PlayRuntime` (per task: "uses the same `groundProbe` raycast").
 */

import type { Object3D } from "three";

export interface GroundSnapHit {
  /** World-space hit point — only `[1]` (Y) is used for snap. */
  point: [number, number, number];
  /** Surface tag found by walking the hit's parent chain (defaults to
   *  `"walk"` in `groundProbe` for unmarked geometry). */
  surface?: string;
}

/** Surface tags the ground-snap modifier treats as "ground / walkable
 *  terrain". Anything outside this set won't pull a dragged entity to
 *  it — Shift+Ctrl over a wall, lava, or a regular prop should NOT
 *  teleport the entity onto its top. The default mirrors PlayRuntime's
 *  groundProbe convention where unmarked geometry is "walk". */
export const DEFAULT_WALKABLE_SURFACES: readonly string[] = ["walk", "terrain"];

export interface ShouldGroundSnapOptions {
  /** Result of the downward groundProbe under the dragged entity, or
   *  `null` if nothing was within reach. */
  hit: GroundSnapHit | null;
  /** Surface tag of the DRAGGED entity itself (walked up its own
   *  three.js chain via `userData.surface`). When the dragged entity
   *  is itself terrain (e.g. a Map), snapping is disabled — terrain
   *  shouldn't snap to other terrain underneath it. `null` means
   *  "untagged / regular prop". */
  draggedEntitySurface: string | null;
  /** Override the walkable-surface allow-list. Defaults to
   *  {@link DEFAULT_WALKABLE_SURFACES}. */
  walkableSurfaces?: readonly string[];
}

/**
 * Decision helper for the editor's translate-gizmo ground-snap.
 *
 * Returns true iff the drag should currently snap the entity's Y to
 * the probed ground. Encapsulates the two acceptance gates:
 *
 *   1. The hit must lie on a WALKABLE surface (`"walk"` / `"terrain"`).
 *   2. The DRAGGED entity must NOT itself be terrain (no
 *      terrain-onto-terrain re-snap when the user is repositioning a
 *      Map).
 *
 * Pure / synchronous so it can be unit-tested without WebGL.
 */
export function shouldGroundSnap(opts: ShouldGroundSnapOptions): boolean {
  if (!opts.hit) return false;
  const allowed = opts.walkableSurfaces ?? DEFAULT_WALKABLE_SURFACES;
  if (opts.draggedEntitySurface && allowed.includes(opts.draggedEntitySurface)) {
    return false;
  }
  const hitSurface = opts.hit.surface ?? "walk";
  return allowed.includes(hitSurface);
}

/** Walk an Object3D's parent chain and return the first
 *  `userData.surface` tag encountered, or `null` if none. Mirrors the
 *  inspector pattern used by groundProbe / raycastEntities. */
export function getObjectSurfaceTag(obj: Object3D | null | undefined): string | null {
  let cur: Object3D | null = obj ?? null;
  while (cur) {
    const ud = cur.userData as { surface?: string } | undefined;
    if (ud?.surface) return ud.surface;
    cur = cur.parent;
  }
  return null;
}

/**
 * Resolve the surface tag for an ENTITY's three.js group.
 *
 * EntityRenderer stamps `userData.entityId` on the entity group itself
 * but stamps `userData.surface` on a DESCENDANT (the loaded model's
 * cloned root for `LoadedModel`, or the named "Map" wrapper). So
 * checking only the object + its ancestors misses the tag for terrain
 * entities like Maps — which is exactly the case ground-snap must
 * recognize to avoid "snap terrain onto terrain".
 *
 * Order of checks:
 *   1. The object itself + its parent chain (cheap, hits the common
 *      "ancestor stamped the tag" case).
 *   2. The full descendant subtree (covers EntityRenderer's model /
 *      Map case where the tag lives on a child).
 *
 * Returns `null` for plain props with no surface metadata anywhere.
 */
export function getEntitySurfaceTag(obj: Object3D | null | undefined): string | null {
  if (!obj) return null;
  const fromAncestors = getObjectSurfaceTag(obj);
  if (fromAncestors) return fromAncestors;
  let found: string | null = null;
  obj.traverse((child) => {
    if (found) return;
    const ud = child.userData as { surface?: string } | undefined;
    if (ud?.surface) found = ud.surface;
  });
  return found;
}

/** Returns true iff the dragger should currently snap to ground. The
 *  contract is "Shift AND (Ctrl OR Meta)" so it works on both Windows /
 *  Linux (Ctrl) and macOS (Meta / ⌘). */
export function isGroundSnapModifierHeld(e: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  if (!e.shiftKey) return false;
  return !!(e.ctrlKey || e.metaKey);
}

/**
 * Override the dragged object's local Y to the hit's world Y.
 *
 * Returns true when a snap happened, false when no hit was provided
 * (caller can branch on this to keep free-Y behavior).
 *
 * Note: the dragged object's TransformControls is operating directly on
 * its own `position` (drei wraps a `THREE.Group` via `<TransformControls
 * object={selectedRef}>`), so the relevant value really is local-space Y
 * — provided the object is a scene-root entity, which is the only
 * configuration the gizmo supports today (the inspector reparents
 * children before editing).
 */
export function applyGroundSnap(object: Object3D, hit: GroundSnapHit | null): boolean {
  if (!hit) return false;
  object.position.y = hit.point[1];
  return true;
}
