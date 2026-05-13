/**
 * Terrain-aware spawn placement.
 *
 * Scene templates (and any AI-spawn or drag-drop flow) can mark a fresh
 * entity with `pendingTerrainSnap: true`. After that entity's renderer
 * has mounted (and — critically — after any GLB the entity references
 * has finished loading), `EntityRenderer.LoadedModel` calls
 * {@link snapEntityToTerrainOnce} which:
 *
 *   1. Casts a downward ray from a point well above the entity's
 *      current XZ position.
 *   2. Filters the candidate hits to meshes whose ancestry has
 *      `userData.surface === "Walk"` (the same convention the navmesh
 *      baker + ground-snap helpers already use). Self-intersection with
 *      the entity's own meshes is excluded.
 *   3. If a hit is found, updates the entity's `transform.position[1]`
 *      to the hit Y coordinate.
 *   4. Clears `pendingTerrainSnap` so the snap is one-shot — re-mounts
 *      and play/stop cycles never re-fire it.
 *
 * On no hit (no walkable terrain mounted yet, entity over a hole, or
 * raycast against a dynamically-loaded map that hasn't finished
 * loading), we leave the entity where it was and log a warning. Loud
 * is better than silently buried.
 *
 * Tied to `userData.surface === "Walk"` rather than layer === "Terrain"
 * because surface is the per-mesh navmesh-driving signal — a designer
 * can mark a single platform mesh as Walk inside an otherwise non-walk
 * group, and we want characters to land on that platform.
 */
import * as THREE from "three";
import { useEditor } from "@/store/editor";

const RAY_FROM_HEIGHT = 200;
const RAY_MAX_DISTANCE = 500;

function getEditorScene(): THREE.Object3D | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { __editorScene?: THREE.Object3D }).__editorScene ??
    null
  );
}

/** Walk an object's parent chain looking for `userData.surface`. The
 *  same lookup PlayRuntime + groundProbe use, kept inline here so this
 *  helper has no scene-runtime dependency. */
function inheritedSurface(obj: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const s = (cur.userData as { surface?: string }).surface;
    if (typeof s === "string" && s.length > 0) return s;
    cur = cur.parent;
  }
  return null;
}

/** Walk an object's parent chain looking for `userData.entityId`. Used
 *  to filter out self-intersections so a character can't snap to its
 *  own mesh. */
function inheritedEntityId(obj: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const id = (cur.userData as { entityId?: string }).entityId;
    if (typeof id === "string" && id.length > 0) return id;
    cur = cur.parent;
  }
  return null;
}

/** Run the snap pass once for the given entity and clear its
 *  `pendingTerrainSnap` flag. Safe to call repeatedly — the store
 *  update is a no-op once the flag is false. */
export function snapEntityToTerrainOnce(entityId: string): {
  snapped: boolean;
  reason: "ok" | "no-flag" | "no-scene" | "no-hit" | "no-entity";
  hitY?: number;
} {
  const store = useEditor.getState();
  const entity = store.sceneData.entities.find((e) => e.id === entityId);
  if (!entity) return { snapped: false, reason: "no-entity" };
  if (!entity.pendingTerrainSnap) return { snapped: false, reason: "no-flag" };

  const scene = getEditorScene();
  if (!scene) return { snapped: false, reason: "no-scene" };

  const [px, , pz] = entity.transform.position;
  const origin = new THREE.Vector3(px, RAY_FROM_HEIGHT, pz);
  const dir = new THREE.Vector3(0, -1, 0);
  const raycaster = new THREE.Raycaster(origin, dir, 0, RAY_MAX_DISTANCE);
  // Recurse so per-mesh inherited surface tags (Map → MapModel → child
  // meshes) are reachable, then walk up each hit's ancestry.
  const candidates = raycaster.intersectObject(scene, true);

  for (const hit of candidates) {
    // Compare case-insensitively: scene-schema's SurfaceKind enum uses
    // "Walk" (capitalized), but EntityRenderer stamps `userData.surface`
    // lower-case (`entity.surface.toLowerCase()` or default "walk"). The
    // inheritance walker also normalizes its source, so accept both.
    const surf = inheritedSurface(hit.object);
    if (!surf || surf.toLowerCase() !== "walk") continue;
    if (inheritedEntityId(hit.object) === entityId) continue;
    const hitY = hit.point.y;
    store.updateEntity(entityId, (e) => {
      e.transform.position = [
        e.transform.position[0],
        hitY,
        e.transform.position[2],
      ];
      e.pendingTerrainSnap = false;
    });
    // eslint-disable-next-line no-console
    console.log(
      `[TERRAIN-SNAP] entity=${entityId} (${entity.name}) snapped to y=${hitY.toFixed(3)}`,
    );
    return { snapped: true, reason: "ok", hitY };
  }

  // No walkable hit — clear the flag anyway so we don't re-attempt
  // every render, and warn so a sunk/floating character is visible in
  // the console rather than a silent mystery.
  store.updateEntity(entityId, (e) => {
    e.pendingTerrainSnap = false;
  });
  // eslint-disable-next-line no-console
  console.warn(
    `[TERRAIN-SNAP] entity=${entityId} (${entity.name}) no Walk-tagged terrain under (${px.toFixed(2)}, ${pz.toFixed(2)}); leaving at y=${entity.transform.position[1].toFixed(3)}.`,
  );
  return { snapped: false, reason: "no-hit" };
}
