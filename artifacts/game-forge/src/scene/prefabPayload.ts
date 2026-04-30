import type { SceneEntity } from "./types";

/**
 * Shape of `prefab.data` (a JSON blob in the API row). The server stores
 * this opaquely, so adding fields here is a non-breaking change — older
 * clients just ignore the new keys.
 *
 *   `entities`        — the prefab's entity tree (re-rooted on spawn).
 *   `rootId`          — id of the entity considered the prefab root.
 *   `isPlayerPrefab`  — when true, `togglePlay()` will auto-spawn this
 *                       prefab as the player if the scene has no
 *                       controller-driven entity. At most one prefab
 *                       per project is expected to carry this flag —
 *                       toggling it on one auto-clears the others.
 */
export interface PrefabPayload {
  entities?: SceneEntity[];
  rootId?: string | null;
  isPlayerPrefab?: boolean;
}
