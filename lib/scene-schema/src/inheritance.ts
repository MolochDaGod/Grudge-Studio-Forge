/**
 * Parent-chain inheritance for the three orthogonal entity axes —
 * {@link LayerName}, {@link SurfaceKind}, and {@link MaterialComponent}.
 *
 * A child entity that doesn't set its own `layer` / `surface` /
 * `material.kind` inherits the nearest ancestor that does. This
 * matches what spatial queries see: the runtime EntityRenderer stamps
 * each axis on `userData` and consumers walk the THREE.Object3D
 * parent chain to find the first non-empty value. The pure helper
 * here lets the editor, AI tools, and tests reproduce that lookup
 * against the persisted scene tree (without needing a live R3F
 * scene).
 */

import type { LayerName } from "./layers";
import type { MaterialComponent, MaterialKind } from "./materials";
import type { SceneEntity, SurfaceKind } from "./index";

/** Resolved per-axis values for an entity, after walking up the
 *  `parentId` chain to fill in unset fields. Values are `undefined`
 *  only when no ancestor specifies them either (callers can then
 *  fall back to engine defaults — `Default` layer, `None` surface,
 *  `Solid` material). */
export interface InheritedFields {
  layer?: LayerName;
  surface?: SurfaceKind;
  /** Resolved material kind (mirrors `material?.kind`). */
  materialKind?: MaterialKind;
  /** Effective MaterialComponent: per-field merge from the entity
   *  upward through the parent chain (own value wins). */
  material?: MaterialComponent;
}

/** Walk up the parent chain filling in any axis the entity leaves
 *  unset. Material is per-field merged. Cycle-safe (depth capped at 64). */
export function resolveInheritedFields(
  entity: SceneEntity,
  entitiesById: ReadonlyMap<string, SceneEntity>,
): InheritedFields {
  let layer: LayerName | undefined = entity.layer;
  let surface: SurfaceKind | undefined = entity.surface;
  const material: MaterialComponent = { ...(entity.material ?? {}) };
  let cur = entity.parentId
    ? entitiesById.get(entity.parentId) ?? null
    : null;
  for (let depth = 0; cur && depth < 64; depth++) {
    if (!layer && cur.layer) layer = cur.layer;
    if (!surface && cur.surface) surface = cur.surface;
    if (cur.material) {
      for (const k of Object.keys(cur.material) as Array<keyof MaterialComponent>) {
        if (material[k] === undefined && cur.material[k] !== undefined) {
          (material as Record<string, unknown>)[k] = cur.material[k] as unknown;
        }
      }
    }
    cur = cur.parentId ? entitiesById.get(cur.parentId) ?? null : null;
  }
  const hasAnyMaterialField = Object.keys(material).length > 0;
  return {
    layer,
    surface,
    materialKind: material.kind,
    material: hasAnyMaterialField ? material : undefined,
  };
}

/** Build a fast id → entity index for {@link resolveInheritedFields}.
 *  Cheap enough to call once per inspector render or per AI tool
 *  invocation; cache outside hot inner loops. */
export function indexEntitiesById(
  entities: readonly SceneEntity[],
): Map<string, SceneEntity> {
  const out = new Map<string, SceneEntity>();
  for (const e of entities) out.set(e.id, e);
  return out;
}

/** Helper for the runtime side: walk up an arbitrary parent chain of
 *  `userData` records (the THREE.Object3D mirror of the scene tree)
 *  looking for the first one that has the named field. Used by
 *  `raycastEntities` and `groundProbe` in PlayRuntime — kept here so
 *  the lookup rules stay alongside the scene-side helper. */
export function readUserDataChain<T>(
  start: { userData?: Record<string, unknown>; parent?: unknown } | null,
  field: string,
): T | undefined {
  let cur: { userData?: Record<string, unknown>; parent?: unknown } | null = start;
  for (let depth = 0; cur && depth < 64; depth++) {
    const v = cur.userData?.[field] as T | undefined;
    if (v !== undefined && v !== null && v !== "") return v;
    cur = (cur.parent ?? null) as typeof cur;
  }
  return undefined;
}
