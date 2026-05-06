/**
 * Layers tools for the AI Worker.
 *
 * Surfaces Grudge GameForge's Unity-style physics layers:
 *
 *   - {@link LAYERS} — fixed registry (Default, Terrain, Player, NPC,
 *     Item, Projectile, Trigger, Water, IgnoreRaycast, UI3D)
 *   - per-entity `layer` field
 *   - `Environment.collisionMatrix` (pair → boolean) and
 *     `Environment.sensorLayers`
 *
 * Tools:
 *   - `list_layers`              — read-only registry + sensor flags
 *   - `get_layer_matrix`         — read effective collision matrix
 *   - `set_layer`                — assign a layer to one entity (DESTRUCTIVE)
 *   - `set_layer_matrix`         — toggle a collision pair (DESTRUCTIVE)
 *   - `find_entities_by_layer`   — list every entity on a given layer
 */

import { useEditor } from "@/store/editor";
import {
  LAYERS,
  DEFAULT_SENSOR_LAYERS,
  DEFAULT_COLLISION_MATRIX,
  layersCollide,
  pairKey,
  type LayerName,
} from "@workspace/scene-schema";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const isLayer = (v: unknown): v is LayerName =>
  typeof v === "string" && (LAYERS as readonly string[]).includes(v);

// ── list_layers ──────────────────────────────────────────────────────
const LIST_LAYERS: ToolDef = {
  name: "list_layers",
  description:
    "List the fixed Unity-style physics layer registry (Default, Terrain, Player, NPC, Item, Projectile, Trigger, Water, IgnoreRaycast, UI3D). Returns each name and whether it is a sensor layer in the current scene (sensor layers fire intersection events but produce no contact response).",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const listLayersHandler: ToolHandler = async () => {
  const env = useEditor.getState().sceneData.environment;
  const sensors = env.sensorLayers ?? DEFAULT_SENSOR_LAYERS;
  return {
    ok: true,
    data: {
      layers: LAYERS.map((name) => ({ name, sensor: sensors.includes(name) })),
      defaultSensorLayers: DEFAULT_SENSOR_LAYERS,
    },
  };
};

// ── get_layer_matrix ─────────────────────────────────────────────────
const GET_LAYER_MATRIX: ToolDef = {
  name: "get_layer_matrix",
  description:
    "Return the effective collision matrix as a list of {a, b, collide} entries (pairs deduped, missing entries fall back to the engine default). Use this before set_layer_matrix so you can describe the change in human terms.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const getLayerMatrixHandler: ToolHandler = async () => {
  const env = useEditor.getState().sceneData.environment;
  const matrix = env.collisionMatrix;
  const pairs: { a: LayerName; b: LayerName; collide: boolean }[] = [];
  for (let i = 0; i < LAYERS.length; i++) {
    for (let j = i; j < LAYERS.length; j++) {
      const a = LAYERS[i];
      const b = LAYERS[j];
      pairs.push({ a, b, collide: layersCollide(matrix, a, b) });
    }
  }
  return {
    ok: true,
    data: {
      pairs,
      overrides: matrix ?? {},
      defaults: DEFAULT_COLLISION_MATRIX,
    },
  };
};

// ── set_layer ────────────────────────────────────────────────────────
const SET_LAYER: ToolDef = {
  name: "set_layer",
  description:
    "Assign a physics layer to one or more entities in a single undoable step. Layer drives Rapier collisionGroups (via the scene's collision matrix) and the sensor flag for Trigger/Water. Use list_entities or find_entities_by_layer to gather ids; use list_layers for allowed names.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "One or more entity ids to update.",
      },
      layer: {
        type: "string",
        enum: [...LAYERS],
        description: "Layer name from the fixed registry.",
      },
    },
    required: ["entityIds", "layer"],
    additionalProperties: false,
  },
};

const setLayerHandler: ToolHandler = async (input) => {
  const layer = isLayer(input.layer) ? input.layer : null;
  if (!layer)
    return { ok: false, error: `layer must be one of: ${LAYERS.join(", ")}` };
  // Accept `entityIds: string[]` (canonical), and fall back to a single
  // `entityId` for backwards compatibility with older prompts.
  let ids: string[];
  if (Array.isArray(input.entityIds)) {
    ids = input.entityIds.filter((v): v is string => typeof v === "string");
  } else if (typeof input.entityId === "string") {
    ids = [input.entityId];
  } else {
    return { ok: false, error: "entityIds (string[]) is required" };
  }
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
      previous: target.layer ?? "Default",
    });
    validIds.push(id);
  }
  if (validIds.length === 0)
    return { ok: false, error: `No matching entities: ${notFound.join(", ")}` };

  // Single undoable command — Ctrl+Z reverts the entire batch in one step.
  state.cmdSetEntityLayer(validIds, layer);
  return {
    ok: true,
    data: {
      layer,
      updated,
      notFound: notFound.length ? notFound : undefined,
      count: updated.length,
    },
  };
};

// ── set_layer_matrix ─────────────────────────────────────────────────
const SET_LAYER_MATRIX: ToolDef = {
  name: "set_layer_matrix",
  description:
    "Toggle whether two layers physically interact. Setting `collide: false` on a pair makes their colliders pass through each other (no contact, no sensor events). Pair order does not matter. Affects every entity on those layers immediately.",
  input_schema: {
    type: "object",
    properties: {
      a: { type: "string", enum: [...LAYERS] },
      b: { type: "string", enum: [...LAYERS] },
      collide: { type: "boolean" },
    },
    required: ["a", "b", "collide"],
    additionalProperties: false,
  },
};

const setLayerMatrixHandler: ToolHandler = async (input) => {
  const a = isLayer(input.a) ? input.a : null;
  const b = isLayer(input.b) ? input.b : null;
  if (!a || !b)
    return { ok: false, error: `a/b must be one of: ${LAYERS.join(", ")}` };
  if (typeof input.collide !== "boolean")
    return { ok: false, error: "collide must be a boolean" };
  const state = useEditor.getState();
  const env = state.sceneData.environment;
  const matrix = { ...(env.collisionMatrix ?? {}) };
  const key = pairKey(a, b);
  const previous = layersCollide(env.collisionMatrix, a, b);
  matrix[key] = input.collide;
  state.cmdSetEnvironment(
    { collisionMatrix: matrix },
    `${input.collide ? "Enable" : "Disable"} ${a}↔${b} collision`,
  );
  return {
    ok: true,
    data: { a, b, previous, collide: input.collide },
  };
};

// ── find_entities_by_layer ──────────────────────────────────────────
const FIND_ENTITIES_BY_LAYER: ToolDef = {
  name: "find_entities_by_layer",
  description:
    "Return every entity whose `layer` matches the given name. Useful for bulk operations ('move every NPC up by 1', 'recolor all Items').",
  input_schema: {
    type: "object",
    properties: {
      layer: { type: "string", enum: [...LAYERS] },
    },
    required: ["layer"],
    additionalProperties: false,
  },
};

const findEntitiesByLayerHandler: ToolHandler = async (input) => {
  const layer = isLayer(input.layer) ? input.layer : null;
  if (!layer)
    return { ok: false, error: `layer must be one of: ${LAYERS.join(", ")}` };
  const entities = useEditor.getState().sceneData.entities;
  const matches = entities
    .filter((e) => (e.layer ?? "Default") === layer)
    .map((e) => ({ id: e.id, name: e.name, type: e.type }));
  return { ok: true, data: { layer, count: matches.length, entities: matches } };
};

export const defs: ToolDef[] = [
  LIST_LAYERS,
  GET_LAYER_MATRIX,
  SET_LAYER,
  SET_LAYER_MATRIX,
  FIND_ENTITIES_BY_LAYER,
];

export const handlers: Record<string, ToolHandler> = {
  list_layers: listLayersHandler,
  get_layer_matrix: getLayerMatrixHandler,
  set_layer: setLayerHandler,
  set_layer_matrix: setLayerMatrixHandler,
  find_entities_by_layer: findEntitiesByLayerHandler,
};

export const destructiveToolNames: string[] = ["set_layer", "set_layer_matrix"];
