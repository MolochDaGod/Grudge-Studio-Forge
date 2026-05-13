import { nanoid } from "nanoid";
import type { SceneEntity } from "@/scene/types";
import type { PrefabPayload } from "@/scene/prefabPayload";

/**
 * Build a fresh prefab payload from a `.glb` / `.gltf` project asset
 * so the user can "Forge" the model — i.e. open it as a brand-new
 * prefab in the sub-scene editor (Unity-style Prefab Stage) and then
 * add children, colliders, scripts, and behaviors before saving.
 *
 *  - The model becomes the prefab ROOT (one `model` entity at the
 *    origin). Identity is `nanoid(8)` to match `defaultsByType` so
 *    Hierarchy / inspector / undo all behave consistently.
 *  - The prefab is named `Forge: <asset>` so it sorts next to
 *    hand-crafted prefabs in the list and is obviously a draft —
 *    users can rename it freely after saving.
 *  - `isPlayerPrefab` is FALSE on creation: a freshly forged glb
 *    must never silently steal the project's player slot from the
 *    user's existing player prefab.
 *
 * Pure helper: no I/O, no store reads, no React. The caller persists
 * via `useCreatePrefab().mutateAsync(...)` and then enters the editor
 * by calling `openPrefabSubScene(prefab.id, prefab.name, payload.entities)`.
 * Splitting persistence from payload construction keeps this trivially
 * unit-testable (see `forgeFromAsset.test.ts`).
 */
export function buildPrefabPayloadFromModelAsset(args: {
  assetName: string;
  url: string;
}): { name: string; payload: PrefabPayload } {
  const id = nanoid(8);
  // Trim + fall back to "Model" so a blank asset name doesn't render
  // as `Forge: ` (with a trailing space) in the prefab list.
  const trimmed = (args.assetName ?? "").trim();
  const display = trimmed || "Model";
  const root: SceneEntity = {
    id,
    name: display,
    type: "model",
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    // Mirrors `defaultsByType("model", …)` so the entity is
    // indistinguishable from one created via the toolbar's "Add
    // model" path — same renderer code path, same inspector layout.
    model: { url: args.url },
  };
  return {
    name: `Forge: ${display}`,
    payload: { entities: [root], rootId: id, isPlayerPrefab: false },
  };
}
