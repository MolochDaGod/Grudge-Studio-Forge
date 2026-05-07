import { useEditor } from "@/store/editor";
import {
  addEntityCommand,
  setMaterialsCommand,
  type StoreLike,
  type MaterialKindChange,
} from "@/lib/commands";
import {
  MATERIAL_KINDS,
  MATERIAL_DEFAULTS,
  resolveMaterialDefaults,
  DEFAULT_TRANSFORM,
  type MaterialKind,
  type SceneEntity,
  type Vec3,
} from "@workspace/scene-schema";
import { raycastEntities } from "@/scene/PlayRuntime";
import * as THREE from "three";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const isKind = (v: unknown): v is MaterialKind =>
  typeof v === "string" && (MATERIAL_KINDS as readonly string[]).includes(v);

const asVec3 = (v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 => {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number"))
    return [v[0], v[1], v[2]];
  return fallback;
};

const editorStore = (): StoreLike => {
  const s = useEditor.getState();
  return {
    getEntities: () => s.sceneData.entities,
    setEntities: s.setEntities,
    selectEntity: s.selectEntity,
  };
};

const newId = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ── list_material_kinds / list_materials ──────────────────────────────
const LIST_KINDS_DESC =
  "List the fixed Material registry (Solid, Metal, Glass, Wood, Stone, Cloth, Flag, Foliage, Liquid, Particle, Smoke, Emissive, Custom) with each kind's per-kind physical defaults — density (kg/m³), friction, restitution, drag, opacity, and the three occlusion flags blocksLineOfSight / blocksProjectiles / blocksAudio.";

const LIST_MATERIAL_KINDS: ToolDef = {
  name: "list_material_kinds",
  description: LIST_KINDS_DESC,
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};
const LIST_MATERIALS: ToolDef = {
  name: "list_materials",
  description: `${LIST_KINDS_DESC} (Alias of list_material_kinds.)`,
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const listMaterialsHandler: ToolHandler = async () => ({
  ok: true,
  data: {
    kinds: MATERIAL_KINDS.map((k) => ({ kind: k, ...MATERIAL_DEFAULTS[k] })),
  },
});

// ── set_material ──────────────────────────────────────────────────────
const SET_MATERIAL: ToolDef = {
  name: "set_material",
  description:
    "Assign a Material kind (and optional per-entity overrides) to one or more entities in a single undoable step. Material is one of three orthogonal axes (Layer, Surface, Material) stamped on the entity and inherited down the parent chain.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: { type: "array", items: { type: "string" }, minItems: 1 },
      kind: { type: "string", enum: [...MATERIAL_KINDS] },
      overrides: {
        type: "object",
        properties: {
          density: { type: "number" },
          friction: { type: "number" },
          restitution: { type: "number" },
          drag: { type: "number" },
          opacity: { type: "number" },
          blocksLineOfSight: { type: "boolean" },
          blocksProjectiles: { type: "boolean" },
          blocksAudio: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    required: ["entityIds", "kind"],
    additionalProperties: false,
  },
};

const setMaterialHandler: ToolHandler = async (input) => {
  const kind = isKind(input.kind) ? input.kind : null;
  if (!kind)
    return { ok: false, error: `kind must be one of: ${MATERIAL_KINDS.join(", ")}` };
  const ids = Array.isArray(input.entityIds)
    ? input.entityIds.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0)
    return { ok: false, error: "entityIds must include at least one id" };

  const state = useEditor.getState();
  const entities = state.sceneData.entities;
  const updated: { id: string; name: string; previous: string }[] = [];
  const notFound: string[] = [];
  const validIds: string[] = [];
  for (const id of ids) {
    const target = entities.find((e) => e.id === id);
    if (!target) {
      notFound.push(id);
      continue;
    }
    updated.push({
      id,
      name: target.name,
      previous: target.material?.kind ?? "Solid",
    });
    validIds.push(id);
  }
  if (validIds.length === 0)
    return { ok: false, error: `No matching entities: ${notFound.join(", ")}` };

  const overrides = (input.overrides ?? {}) as Partial<
    NonNullable<SceneEntity["material"]>
  >;
  const overrideKeys = Object.keys(overrides);
  const changes: MaterialKindChange[] = validIds.map((id) => {
    const e = entities.find((x) => x.id === id)!;
    return {
      id,
      fromMaterial: e.material,
      toKind: kind,
      overrides: overrideKeys.length > 0 ? overrides : undefined,
    };
  });
  state.commandStack.push(setMaterialsCommand(editorStore(), changes));

  return {
    ok: true,
    data: {
      kind,
      defaults: MATERIAL_DEFAULTS[kind],
      overrides: overrideKeys.length > 0 ? overrides : undefined,
      updated,
      notFound: notFound.length ? notFound : undefined,
      count: updated.length,
    },
  };
};

// ── find_entities_by_material ────────────────────────────────────────
const FIND_ENTITIES_BY_MATERIAL: ToolDef = {
  name: "find_entities_by_material",
  description:
    "Return every entity whose resolved material kind matches the given name (entities with no explicit material default to 'Solid').",
  input_schema: {
    type: "object",
    properties: { kind: { type: "string", enum: [...MATERIAL_KINDS] } },
    required: ["kind"],
    additionalProperties: false,
  },
};

const findEntitiesByMaterialHandler: ToolHandler = async (input) => {
  const kind = isKind(input.kind) ? input.kind : null;
  if (!kind)
    return { ok: false, error: `kind must be one of: ${MATERIAL_KINDS.join(", ")}` };
  const entities = useEditor.getState().sceneData.entities;
  const matches = entities
    .filter((e) => resolveMaterialDefaults(e.material).kind === kind)
    .map((e) => ({ id: e.id, name: e.name, type: e.type }));
  return { ok: true, data: { kind, count: matches.length, entities: matches } };
};

// ── make_cloth / make_flag / make_particles ──────────────────────────
function spawnDynamicEntity(
  type: "cloth" | "flag" | "particles",
  name: string,
  position: Vec3,
  scale: Vec3,
): SceneEntity {
  const kind: MaterialKind =
    type === "cloth" ? "Cloth" : type === "flag" ? "Flag" : "Particle";
  const entity: SceneEntity = {
    id: newId(),
    name,
    type,
    transform: { ...DEFAULT_TRANSFORM(), position, scale },
    material: { kind },
  };
  useEditor.getState().commandStack.push(addEntityCommand(editorStore(), entity));
  return entity;
}

const makeDynamicTool = (
  type: "cloth" | "flag" | "particles",
  defaultName: string,
  description: string,
): ToolDef => ({
  name: `make_${type}`,
  description,
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
    },
    additionalProperties: false,
  },
});

const MAKE_CLOTH = makeDynamicTool(
  "cloth",
  "Cloth",
  "Spawn a Cloth entity (dynamic Material kind). Renders as a translucent draped plane; tagged Cloth so projectiles pass through but sight is blocked.",
);
const MAKE_FLAG = makeDynamicTool(
  "flag",
  "Flag",
  "Spawn a Flag entity (dynamic Material kind). Renders as a pole-mounted banner; tagged Flag with Cloth-like physics defaults.",
);
const MAKE_PARTICLES = makeDynamicTool(
  "particles",
  "Particles",
  "Spawn a Particles entity (dynamic Material kind). Renders as a sprite cloud; tagged Particle so it doesn't block sight, projectiles, or audio.",
);

const makeDynamicHandler =
  (type: "cloth" | "flag" | "particles", defaultName: string): ToolHandler =>
  async (input) => {
    const name = typeof input.name === "string" ? input.name : defaultName;
    const position = asVec3(input.position);
    const scale = asVec3(input.scale, [1, 1, 1]);
    const entity = spawnDynamicEntity(type, name, position, scale);
    return {
      ok: true,
      data: { id: entity.id, name: entity.name, type, materialKind: entity.material!.kind },
    };
  };

// ── material_raycast ─────────────────────────────────────────────────
const MATERIAL_RAYCAST: ToolDef = {
  name: "material_raycast",
  description:
    "Cast a ray through the live editor scene with optional Material filtering. Returns the closest hit with the resolved material kind, density, and the three occlusion flags. Pass requireBlocksProjectiles for a bullet-style cast (skips Glass/Foliage/Smoke), requireBlocksLineOfSight for AI sight, requireBlocksAudio for audio occlusion, or `kinds` to restrict to specific Material kinds.",
  input_schema: {
    type: "object",
    properties: {
      origin: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      direction: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      maxDistance: { type: "number" },
      excludeIds: { type: "array", items: { type: "string" } },
      layerMask: { type: "array", items: { type: "string" } },
      requireBlocksLineOfSight: { type: "boolean" },
      requireBlocksProjectiles: { type: "boolean" },
      requireBlocksAudio: { type: "boolean" },
      kinds: { type: "array", items: { type: "string", enum: [...MATERIAL_KINDS] } },
    },
    required: ["origin", "direction"],
    additionalProperties: false,
  },
};

const materialRaycastHandler: ToolHandler = async (input) => {
  const w = window as unknown as { __r3fScene?: THREE.Object3D };
  const scene = w.__r3fScene;
  if (!scene)
    return { ok: false, error: "No live R3F scene; enter Play mode or open the viewport first." };
  const origin = asVec3(input.origin);
  const direction = asVec3(input.direction, [0, -1, 0]);
  const maxDistance = typeof input.maxDistance === "number" ? input.maxDistance : 200;
  const excludeIds = Array.isArray(input.excludeIds)
    ? input.excludeIds.filter((v): v is string => typeof v === "string")
    : undefined;
  const layerMask = Array.isArray(input.layerMask)
    ? input.layerMask.filter((v): v is string => typeof v === "string")
    : undefined;
  const kinds = Array.isArray(input.kinds)
    ? input.kinds.filter((v): v is string => typeof v === "string")
    : undefined;
  const hit = raycastEntities(scene, origin, direction, maxDistance, excludeIds, layerMask, {
    requireBlocksLineOfSight: input.requireBlocksLineOfSight === true,
    requireBlocksProjectiles: input.requireBlocksProjectiles === true,
    requireBlocksAudio: input.requireBlocksAudio === true,
    kinds,
  });
  return { ok: true, data: { hit } };
};

export const defs: ToolDef[] = [
  LIST_MATERIAL_KINDS,
  LIST_MATERIALS,
  SET_MATERIAL,
  FIND_ENTITIES_BY_MATERIAL,
  MAKE_CLOTH,
  MAKE_FLAG,
  MAKE_PARTICLES,
  MATERIAL_RAYCAST,
];

export const handlers: Record<string, ToolHandler> = {
  list_material_kinds: listMaterialsHandler,
  list_materials: listMaterialsHandler,
  set_material: setMaterialHandler,
  find_entities_by_material: findEntitiesByMaterialHandler,
  make_cloth: makeDynamicHandler("cloth", "Cloth"),
  make_flag: makeDynamicHandler("flag", "Flag"),
  make_particles: makeDynamicHandler("particles", "Particles"),
  material_raycast: materialRaycastHandler,
};

export const destructiveToolNames: string[] = [
  "set_material",
  "make_cloth",
  "make_flag",
  "make_particles",
];
