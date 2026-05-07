/**
 * AI Worker tools.
 *
 * Each tool pairs an Anthropic-compatible JSON-schema definition with a
 * client-side executor that runs against the editor's Zustand store and
 * the api-server REST endpoints.
 *
 * Why client-side?  The live editor (R3F scene graph, undo stack, selection,
 * live materials) only exists in the browser. The server is a stateless
 * proxy to Anthropic. This keeps tool execution synchronous with the UI:
 * every change shows up in the viewport instantly, and the human can undo
 * any AI action with Ctrl+Z just like a manual edit.
 */
import { useEditor } from "@/store/editor";
import { BUILTIN_MODELS } from "@/lib/builtinModels";
import { generateMap, type MapKind } from "@/lib/mapGen";
import { STARTER_VFX } from "@/lib/starterPrefabs";
import {
  addEntityCommand,
  addEntitiesCommand,
  type StoreLike,
} from "@/lib/commands";
import type { SceneEntity, EntityType, ControllerKind, Vec3, SceneData } from "@/scene/types";
import { DEFAULT_GRAVITY } from "@workspace/scene-schema";
type Environment = SceneData["environment"];
import {
  listTunableParams,
  setTunableParam,
} from "@/lib/tunableParams";
import {
  countEntities as ecsCountEntities,
  queryEntities as ecsQueryEntities,
  type EcsFilter,
} from "@/lib/ecs";
// Per-area AI tool folders all expose the same `{ defs, handlers,
// destructiveToolNames }` shape so this file can spread them in uniformly —
// each parallel AI-tools task touches one isolated import + spread, avoiding
// merge conflicts. Read-only folders still export `destructiveToolNames: []`
// for symmetry; do not special-case them here.
import {
  defs as systemsToolDefs,
  handlers as systemsToolHandlers,
  destructiveToolNames as systemsDestructiveTools,
} from "@/ai/tools/systems";
import {
  defs as scriptingToolDefs,
  handlers as scriptingToolHandlers,
  destructiveToolNames as scriptingDestructiveTools,
} from "@/ai/tools/scripting";
import {
  defs as designToolDefs,
  handlers as designToolHandlers,
  destructiveToolNames as designDestructiveTools,
} from "@/ai/tools/design";
import {
  defs as layersToolDefs,
  handlers as layersToolHandlers,
  destructiveToolNames as layersDestructiveTools,
} from "@/ai/tools/layers";
import {
  defs as navToolDefs,
  handlers as navToolHandlers,
  destructiveToolNames as navDestructiveTools,
} from "@/ai/tools/nav";
import {
  defs as materialsToolDefs,
  handlers as materialsToolHandlers,
  destructiveToolNames as materialsDestructiveTools,
} from "@/ai/tools/materials";

/** Tool names that mutate the scene irrecoverably (or change global config /
 *  spawn arbitrary code). The aiClient asks the user to confirm before
 *  running any of these so the AI can never wipe / overwrite without sign-off.
 *  Per-folder destructive sets are spread in symmetrically — keep this list
 *  for tools defined inline in this file only. */
export const DESTRUCTIVE_TOOLS = new Set<string>([
  "clear_scene",
  "delete_entity",
  "create_script",
  "set_player",
  "generate_map",
  ...systemsDestructiveTools,
  ...scriptingDestructiveTools,
  ...designDestructiveTools,
  ...layersDestructiveTools,
  ...navDestructiveTools,
  ...materialsDestructiveTools,
]);

/** Build the StoreLike adapter that the command factories need. We rebuild
 *  it per command so the closures capture a stable getEntities/setEntities
 *  pair against the live Zustand store. */
function makeStoreLike(): StoreLike {
  return {
    getEntities: () => useEditor.getState().sceneData.entities,
    setEntities: (next) => useEditor.getState().setEntities(next),
    selectEntity: (id) => useEditor.getState().selectEntity(id),
  };
}

const apiUrl = (path: string) => {
  const base = import.meta.env.BASE_URL || "/";
  // api-server lives at the root /api prefix (path-based routing); BASE_URL
  // is the artifact path. Drop any leading slash to compose cleanly.
  return `/api/${path.replace(/^\/+/, "")}`;
};

const newId = () => Math.random().toString(36).slice(2, 10);

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type ToolExecutor = (input: Record<string, unknown>) => Promise<ToolResult>;

/** ────────────────────────────────────────────────────────────────────
 *  Helpers for the executors below.
 *  ──────────────────────────────────────────────────────────────────── */

const asVec3 = (v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 => {
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === "number")) {
    return [v[0] as number, v[1] as number, v[2] as number];
  }
  return fallback;
};

/** Build a fresh SceneEntity from loose AI input. Fills in safe defaults
 *  for transform / material / light / model based on the entity type. */
function buildEntity(input: {
  type: EntityType;
  name?: string;
  parentId?: string | null;
  position?: unknown;
  rotation?: unknown;
  scale?: unknown;
  color?: string;
  emissive?: string;
  metalness?: number;
  roughness?: number;
  light?: {
    kind?: "point" | "directional" | "spot";
    color?: string;
    intensity?: number;
    distance?: number;
  };
  model?: {
    url?: string;
    builtin?: string;
    clip?: string;
    tint?: string;
    label?: string;
  };
  controllerKind?: ControllerKind;
  scriptId?: number | null;
}): SceneEntity {
  const e: SceneEntity = {
    id: newId(),
    name: input.name ?? input.type[0].toUpperCase() + input.type.slice(1),
    type: input.type,
    parentId: input.parentId ?? null,
    transform: {
      position: asVec3(input.position),
      rotation: asVec3(input.rotation),
      scale: asVec3(input.scale, [1, 1, 1]),
    },
  };

  if (
    input.color ||
    input.emissive ||
    input.metalness !== undefined ||
    input.roughness !== undefined
  ) {
    e.material = {
      color: input.color,
      emissive: input.emissive,
      metalness: input.metalness,
      roughness: input.roughness,
    };
  }

  if (input.type === "light" && input.light) {
    e.light = {
      kind: input.light.kind ?? "point",
      color: input.light.color ?? "#ffffff",
      intensity: input.light.intensity ?? 4,
      distance: input.light.distance ?? 20,
    };
  }

  if (input.type === "model") {
    const url = input.model?.builtin
      ? `builtin:${input.model.builtin}`
      : input.model?.url;
    if (url) {
      e.model = {
        url,
        clip: input.model?.clip,
        tint: input.model?.tint,
        label: input.model?.label,
      };
    }
  }

  if (input.controllerKind) e.controllerKind = input.controllerKind;
  if (input.scriptId != null) e.scriptId = input.scriptId;

  return e;
}

/** Trim a SceneEntity for AI consumption — full transforms are noisy. */
function summarizeEntity(e: SceneEntity) {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    parentId: e.parentId,
    position: e.transform.position,
    color: e.material?.color,
    light: e.light?.kind,
    modelUrl: e.model?.url,
    modelClip: e.model?.clip,
    controllerKind: e.controllerKind,
    scriptId: e.scriptId ?? null,
  };
}

/** ────────────────────────────────────────────────────────────────────
 *  Tool definitions + executors.
 *  ──────────────────────────────────────────────────────────────────── */

export const AI_TOOLS: { def: ToolDef; exec: ToolExecutor }[] = [
  // ── Inspection ──────────────────────────────────────────────────────
  {
    def: {
      name: "get_scene_summary",
      description:
        "Get a quick summary of the current scene: project id, scene name, entity count by type, environment settings, selection, play-mode state. Call this first when you need orientation.",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => {
      const s = useEditor.getState();
      const counts: Record<string, number> = {};
      for (const e of s.sceneData.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
      return {
        ok: true,
        data: {
          projectId: s.projectId,
          sceneId: s.sceneId,
          sceneName: s.sceneName,
          isPlaying: s.isPlaying,
          isDirty: s.isDirty,
          selectedId: s.selectedId,
          entityCount: s.sceneData.entities.length,
          entitiesByType: counts,
          environment: s.sceneData.environment,
          availableBuiltinModels: Object.keys(BUILTIN_MODELS),
        },
      };
    },
  },

  {
    def: {
      name: "list_entities",
      description:
        "List every entity in the current scene (id, name, type, position, parent, controller, script binding). Use this to discover entity ids before update_entity / delete_entity / attach_script.",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => ({
      ok: true,
      data: useEditor.getState().sceneData.entities.map(summarizeEntity),
    }),
  },

  {
    def: {
      name: "list_builtin_models",
      description:
        "List the names of bundled GLB models the editor can spawn instantly (no upload needed). Returns keys you can pass as model.builtin in add_model_entity.",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => ({ ok: true, data: Object.keys(BUILTIN_MODELS) }),
  },

  // ── Entity CRUD ────────────────────────────────────────────────────
  {
    def: {
      name: "add_entity",
      description:
        "Create a primitive entity (box, sphere, cylinder, plane, light, empty) with optional transform, material, and light component.",
      input_schema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["box", "sphere", "cylinder", "plane", "light", "empty"],
          },
          name: { type: "string" },
          parentId: { type: ["string", "null"] },
          position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          color: { type: "string", description: "Hex color e.g. #ff0044" },
          emissive: { type: "string" },
          metalness: { type: "number" },
          roughness: { type: "number" },
          light: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["point", "directional", "spot"] },
              color: { type: "string" },
              intensity: { type: "number" },
              distance: { type: "number" },
            },
          },
        },
        required: ["type"],
      },
    },
    exec: async (input) => {
      const e = buildEntity(input as Parameters<typeof buildEntity>[0]);
      useEditor.getState().commandStack.push(addEntityCommand(makeStoreLike(), e));
      return { ok: true, data: { id: e.id, name: e.name } };
    },
  },

  {
    def: {
      name: "add_model_entity",
      description:
        "Spawn a GLB model entity. Use either model.builtin (one of list_builtin_models) or model.url (asset URL). Optionally set animation clip, tint color, floating label, and player controller. Returns the new entity id.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          parentId: { type: ["string", "null"] },
          position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          model: {
            type: "object",
            properties: {
              builtin: {
                type: "string",
                description: "Built-in key (e.g. 'blake', 'character', 'vfx-leaves').",
              },
              url: { type: "string", description: "Direct GLB url (alternative to builtin)." },
              clip: { type: "string", description: "Animation clip name to play." },
              tint: { type: "string", description: "Hex color tint, e.g. #ff0044." },
              label: { type: "string", description: "Floating name label above the model." },
            },
          },
          controllerKind: {
            type: "string",
            enum: ["none", "thirdPerson", "firstPerson"],
          },
        },
        required: ["model"],
      },
    },
    exec: async (input) => {
      const e = buildEntity({
        ...(input as Parameters<typeof buildEntity>[0]),
        type: "model",
      });
      if (!e.model?.url) {
        return {
          ok: false,
          error: "Need either model.builtin or model.url. Call list_builtin_models for valid keys.",
        };
      }
      useEditor.getState().commandStack.push(addEntityCommand(makeStoreLike(), e));
      return { ok: true, data: { id: e.id, name: e.name, modelUrl: e.model.url } };
    },
  },

  {
    def: {
      name: "update_entity",
      description:
        "Patch fields on an existing entity. Only the fields you supply are changed (others preserved). Use list_entities to find ids.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          color: { type: "string" },
          emissive: { type: "string" },
          light: {
            type: "object",
            properties: {
              color: { type: "string" },
              intensity: { type: "number" },
              distance: { type: "number" },
              kind: { type: "string", enum: ["point", "directional", "spot"] },
            },
          },
          model: {
            type: "object",
            properties: {
              clip: { type: "string" },
              tint: { type: "string" },
              label: { type: "string" },
            },
          },
          controllerKind: {
            type: "string",
            enum: ["none", "thirdPerson", "firstPerson"],
          },
        },
        required: ["id"],
      },
    },
    exec: async (input) => {
      const id = input.id as string;
      const s = useEditor.getState();
      const ent = s.sceneData.entities.find((e) => e.id === id);
      if (!ent) return { ok: false, error: `No entity with id "${id}"` };
      s.cmdUpdateEntity(id, (e) => {
        if (typeof input.name === "string") e.name = input.name;
        if (Array.isArray(input.position)) e.transform.position = asVec3(input.position);
        if (Array.isArray(input.rotation)) e.transform.rotation = asVec3(input.rotation);
        if (Array.isArray(input.scale)) e.transform.scale = asVec3(input.scale);
        if (input.color || input.emissive) {
          e.material = {
            ...(e.material ?? {}),
            ...(input.color ? { color: input.color as string } : {}),
            ...(input.emissive ? { emissive: input.emissive as string } : {}),
          };
        }
        const li = input.light as Record<string, unknown> | undefined;
        if (li && e.light) {
          e.light = { ...e.light, ...li };
        }
        const mi = input.model as Record<string, unknown> | undefined;
        if (mi && e.model) {
          e.model = { ...e.model, ...mi };
        }
        if (input.controllerKind) {
          e.controllerKind = input.controllerKind as ControllerKind;
        }
      });
      return { ok: true, data: { id } };
    },
  },

  {
    def: {
      name: "delete_entity",
      description:
        "Delete an entity (and any children) from the scene. Returns the count removed.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    exec: async (input) => {
      const id = input.id as string;
      const s = useEditor.getState();
      const before = s.sceneData.entities.length;
      const exists = s.sceneData.entities.some((e) => e.id === id);
      if (!exists) return { ok: false, error: `No entity with id "${id}"` };
      s.cmdRemoveEntity(id);
      const after = useEditor.getState().sceneData.entities.length;
      return { ok: true, data: { removed: before - after } };
    },
  },

  // ── Environment / scene-wide ───────────────────────────────────────
  {
    def: {
      name: "set_environment",
      description:
        "Update environment settings (sky color, ground color, ambient/sun lighting, gravity, fog, active camera mode).",
      input_schema: {
        type: "object",
        properties: {
          skyColor: { type: "string" },
          groundColor: { type: "string" },
          ambientColor: { type: "string" },
          ambientIntensity: { type: "number" },
          sunColor: { type: "string" },
          sunIntensity: { type: "number" },
          gravity: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          cameraMode: {
            type: "string",
            enum: ["editor", "rts", "thirdPerson", "firstPerson"],
          },
        },
      },
    },
    exec: async (input) => {
      // Build a typed Partial<Environment> by extracting only known keys
      // from the AI input — avoids an `as unknown as` cast and keeps
      // unknown keys out of the env entirely.
      const patch: Partial<Environment> = {};
      if (typeof input.skyColor === "string") patch.skyColor = input.skyColor;
      if (typeof input.groundColor === "string") patch.groundColor = input.groundColor;
      if (typeof input.ambientIntensity === "number") patch.ambientIntensity = input.ambientIntensity;
      if (typeof input.sunIntensity === "number") patch.sunIntensity = input.sunIntensity;
      if (Array.isArray(input.gravity) && input.gravity.length === 3) {
        patch.gravity = asVec3(input.gravity);
      }
      if (
        input.cameraMode === "editor" ||
        input.cameraMode === "rts" ||
        input.cameraMode === "thirdPerson" ||
        input.cameraMode === "firstPerson"
      ) {
        patch.cameraMode = input.cameraMode;
      }
      useEditor.getState().cmdSetEnvironment(patch);
      return { ok: true, data: useEditor.getState().sceneData.environment };
    },
  },

  {
    def: {
      name: "clear_scene",
      description:
        "Wipe ALL entities from the current scene (environment is preserved). Destructive — only call when the user has clearly asked to clear / reset / start over.",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => {
      const s = useEditor.getState();
      const removed = s.sceneData.entities.length;
      // command-stack: bypass — `clear_scene` is a wholesale scene replace
      // (same contract as the documented setSceneData bypass).
      s.setSceneData({ entities: [], environment: s.sceneData.environment });
      return { ok: true, data: { removed } };
    },
  },

  // ── Procedural map generation ──────────────────────────────────────
  {
    def: {
      name: "generate_map",
      description:
        "Procedurally generate a layout (cityGrid / openArena / dungeonRooms / maze) and add the resulting entities to the scene. Optional size, density, and rng seed.",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["cityGrid", "openArena", "dungeonRooms", "maze"],
          },
          size: { type: "number", description: "Grid extent in meters (default 40)." },
          density: { type: "number", description: "0..1 density of obstacles (default 0.5)." },
          seed: { type: "number" },
        },
        required: ["kind"],
      },
    },
    exec: async (input) => {
      const kind = input.kind as MapKind;
      const entities = generateMap({
        kind,
        size: typeof input.size === "number" ? input.size : 40,
        density: typeof input.density === "number" ? input.density : 0.5,
        seed: typeof input.seed === "number" ? input.seed : Date.now() & 0xffff,
      });
      const s = useEditor.getState();
      s.commandStack.push(
        addEntitiesCommand(makeStoreLike(), entities, `Generate map: ${kind}`, entities[0]?.id ?? null),
      );
      return { ok: true, data: { added: entities.length, kind } };
    },
  },

  {
    def: {
      name: "spawn_vfx_prefab",
      description:
        "Add one of the built-in VFX prefabs (animated GLB) directly into the scene at the chosen position. Use list_vfx_prefabs to see options.",
      input_schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact prefab name from list_vfx_prefabs.",
          },
          position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        },
        required: ["name"],
      },
    },
    exec: async (input) => {
      const def = STARTER_VFX.find((d) => d.name === input.name);
      if (!def) return { ok: false, error: `Unknown VFX prefab "${input.name}"` };
      const entities = def.entities();
      if (Array.isArray(input.position) && entities[0]) {
        entities[0].transform.position = asVec3(input.position);
      }
      const s = useEditor.getState();
      const root = s.spawnPrefabEntities(entities);
      return { ok: true, data: { rootId: root?.id ?? null, count: entities.length } };
    },
  },

  {
    def: {
      name: "list_vfx_prefabs",
      description: "List the built-in VFX prefab names available to spawn_vfx_prefab.",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => ({
      ok: true,
      data: STARTER_VFX.map((d) => ({ name: d.name, description: d.description })),
    }),
  },

  // ── Scripts (gameplay logic) ───────────────────────────────────────
  {
    def: {
      name: "create_script",
      description:
        "Create a new gameplay script in the current project. Provide JS source that exports `start(entity, ctx)` and/or `update(entity, ctx)`. Available context: time.delta, time.elapsed, input.keys, scene.findByName(name). Returns the new script id (use attach_script to bind it).",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          code: { type: "string", description: "JavaScript module source." },
          language: {
            type: "string",
            enum: ["js", "cs"],
            description: "Default 'js'.",
          },
        },
        required: ["name", "code"],
      },
    },
    exec: async (input) => {
      const projectId = useEditor.getState().projectId;
      if (!projectId) return { ok: false, error: "No project open." };
      const res = await fetch(apiUrl("scripts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: input.name,
          language: input.language ?? "js",
          code: input.code,
        }),
      });
      if (!res.ok) return { ok: false, error: `Script create failed: ${res.status}` };
      const script = (await res.json()) as { id: number; name: string };
      return { ok: true, data: { id: script.id, name: script.name } };
    },
  },

  {
    def: {
      name: "attach_script",
      description:
        "Bind an existing script (by id from create_script or list_scripts) to an entity. Pass scriptId=null to detach.",
      input_schema: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          scriptId: { type: ["number", "null"] },
        },
        required: ["entityId"],
      },
    },
    exec: async (input) => {
      const eid = input.entityId as string;
      const s = useEditor.getState();
      const ent = s.sceneData.entities.find((e) => e.id === eid);
      if (!ent) return { ok: false, error: `No entity with id "${eid}"` };
      const sid =
        typeof input.scriptId === "number" ? input.scriptId : input.scriptId === null ? null : null;
      s.cmdSetEntityScript(eid, sid);
      return { ok: true, data: { entityId: eid, scriptId: sid } };
    },
  },

  {
    def: {
      name: "list_scripts",
      description: "List all scripts in the current project (id, name, language).",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => {
      const projectId = useEditor.getState().projectId;
      if (!projectId) return { ok: false, error: "No project open." };
      const res = await fetch(apiUrl(`projects/${projectId}/scripts`));
      if (!res.ok) return { ok: false, error: `List failed: ${res.status}` };
      const scripts = (await res.json()) as Array<{
        id: number;
        name: string;
        language: string;
      }>;
      return {
        ok: true,
        data: scripts.map((s) => ({ id: s.id, name: s.name, language: s.language })),
      };
    },
  },

  {
    def: {
      name: "set_player",
      description:
        "Mark an entity as the player by setting its controllerKind. 'thirdPerson' / 'firstPerson' use the editor's built-in WASD camera-relative controller.",
      input_schema: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          controllerKind: {
            type: "string",
            enum: ["none", "thirdPerson", "firstPerson"],
          },
        },
        required: ["entityId", "controllerKind"],
      },
    },
    exec: async (input) => {
      const eid = input.entityId as string;
      const kind = input.controllerKind as ControllerKind;
      const s = useEditor.getState();
      const ent = s.sceneData.entities.find((e) => e.id === eid);
      if (!ent) return { ok: false, error: `No entity with id "${eid}"` };
      s.cmdSetEntityController(eid, kind);
      return { ok: true, data: { entityId: eid, controllerKind: kind } };
    },
  },

  // ── Tunable params (feel knobs) ────────────────────────────────────
  {
    def: {
      name: "list_tunable_params",
      description:
        "List every named 'feel knob' you can tweak (sun intensity, sky color, gravity, player speed, mouse sensitivity, camera mode, …). Returns each param's id, description, value range / allowed options, and current value. Call this BEFORE set_tunable_param so you pick a sensible value within range.",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => ({ ok: true, data: listTunableParams() }),
  },
  {
    def: {
      name: "set_tunable_param",
      description:
        "Set a single named tunable param (see list_tunable_params for the catalog). Numeric values are clamped to the param's range; colors must be #rrggbb hex; enums must match an allowed option. Use this for 'make the sun warmer', 'lower gravity', 'switch to first person', etc. — never for scene-graph changes (use add_entity / update_entity for those).",
      input_schema: {
        type: "object",
        required: ["id", "value"],
        properties: {
          id: {
            type: "string",
            description:
              "Param id from list_tunable_params (e.g. 'sun_intensity').",
          },
          value: {
            description:
              "New value. Numeric for number params, hex string for color params, exact enum string for enum params.",
          },
        },
      },
    },
    exec: async (args) => {
      const id = String(args["id"] ?? "");
      if (!id) return { ok: false, error: "id is required" };
      try {
        const result = setTunableParam(id, args["value"]);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  },

  // ── ECS-backed bulk queries ────────────────────────────────────────
  {
    def: {
      name: "query_entities",
      description:
        "Query entities by structural filters (type, has-controller, has-script, has-physics, body type, light kind, name substring, position bounds). Backed by an in-memory ECS index so it stays fast even at thousands of entities. Returns id/name/type/position for each match — call get_scene_summary or list_entities for richer snapshots.",
      input_schema: {
        type: "object",
        properties: {
          type: {
            description:
              "Single entity type or array (one of: box, sphere, cylinder, plane, light, camera, model, empty).",
            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          hasController: { type: "boolean" },
          hasScript: { type: "boolean" },
          hasPhysics: { type: "boolean" },
          bodyType: {
            type: "string",
            enum: ["fixed", "dynamic", "kinematicPosition", "kinematicVelocity"],
          },
          hasLight: { type: "boolean" },
          lightKind: { type: "string", enum: ["point", "directional", "spot"] },
          nameContains: { type: "string" },
          positionMin: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
          },
          positionMax: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description:
              "Cap on returned entities (default 50). Use count_entities for cardinality only.",
          },
        },
      },
    },
    exec: async (args) => {
      const limit = Number(args["limit"] ?? 50);
      const filter = { ...args } as EcsFilter & { limit?: number };
      delete (filter as { limit?: number }).limit;
      const results = ecsQueryEntities(filter).slice(
        0,
        Math.min(500, Math.max(1, limit)),
      );
      return {
        ok: true,
        data: {
          total: ecsCountEntities(filter),
          returned: results.length,
          entities: results.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.type,
            position: e.position,
            parentId: e.parentId,
            hasPhysics: !!e.physics,
            bodyType: e.bodyType,
            hasLight: !!e.light,
            lightKind: e.lightKind,
            hasModel: !!e.model,
            modelKind: e.modelKind,
            controller: e.controller,
            hasScript: !!e.script,
          })),
        },
      };
    },
  },
  {
    def: {
      name: "count_entities",
      description:
        "Count entities matching a filter (same shape as query_entities). Cheaper than query_entities when you only need cardinality — e.g. 'are there any dynamic bodies without a script?'.",
      input_schema: {
        type: "object",
        properties: {
          type: {
            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          hasController: { type: "boolean" },
          hasScript: { type: "boolean" },
          hasPhysics: { type: "boolean" },
          bodyType: {
            type: "string",
            enum: ["fixed", "dynamic", "kinematicPosition", "kinematicVelocity"],
          },
          hasLight: { type: "boolean" },
          lightKind: { type: "string", enum: ["point", "directional", "spot"] },
          nameContains: { type: "string" },
          positionMin: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
          },
          positionMax: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
          },
        },
      },
    },
    exec: async (args) => ({
      ok: true,
      data: { count: ecsCountEntities(args as EcsFilter) },
    }),
  },

  // ── Object storage (R2) ────────────────────────────────────────────
  // Three tools that let the AI persist & recall content beyond the
  // current browser session. All three are project-scoped on the server
  // (keys namespaced by `<projectId>`) and return public URLs the AI
  // can immediately drop back into other tools (e.g. the `url` from
  // `import_asset_from_url` is valid as the `modelUrl` arg of
  // `add_model_entity`).
  {
    def: {
      name: "save_scene_snapshot",
      description:
        "Save the current scene to durable object storage as an immutable JSON snapshot. Returns a public URL that can be shared or re-loaded later. Use this after building something the user wants to keep, or as a checkpoint before risky bulk changes. Optional `name` is used in the filename only.",
      input_schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short label for the snapshot, e.g. 'fort-royale-v2'.",
          },
        },
      },
    },
    exec: async (input) => {
      const s = useEditor.getState();
      const projectId = s.projectId;
      if (!projectId) return { ok: false, error: "No project open." };
      const res = await fetch(apiUrl("ai-storage/scene-snapshot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: typeof input.name === "string" ? input.name : s.sceneName,
          sceneData: s.sceneData,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `Snapshot failed (${res.status}): ${body}` };
      }
      const data = (await res.json()) as {
        key: string;
        url: string;
        byteSize: number;
        written: boolean;
      };
      return { ok: true, data };
    },
  },

  {
    def: {
      name: "import_asset_from_url",
      description:
        "Download a remote asset (GLB, image, audio) into the project's private object-storage namespace. Returns a stable public URL the editor can immediately load — pass that URL as `modelUrl` to `add_model_entity` (for GLBs) or use it as a texture / sky source. Max 25 MB, http(s) only. Useful for: pulling a CC0 model from the web, importing a texture the user shared, or re-using something previously generated.",
      input_schema: {
        type: "object",
        properties: {
          sourceUrl: {
            type: "string",
            description: "Direct download URL (http/https only).",
          },
          name: {
            type: "string",
            description:
              "Short human label, used to build the stored filename (e.g. 'oak-tree', 'rust-metal-512').",
          },
          contentType: {
            type: "string",
            description:
              "Optional MIME override when the server's content-type is wrong (e.g. 'model/gltf-binary' for a .glb served as octet-stream).",
          },
        },
        required: ["sourceUrl", "name"],
      },
    },
    exec: async (input) => {
      const projectId = useEditor.getState().projectId;
      if (!projectId) return { ok: false, error: "No project open." };
      const res = await fetch(apiUrl("ai-storage/import-asset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sourceUrl: input.sourceUrl,
          name: input.name,
          contentType: input.contentType,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `Import failed (${res.status}): ${body}` };
      }
      const data = (await res.json()) as {
        key: string;
        url: string;
        contentType: string;
        byteSize: number;
        written: boolean;
      };
      return { ok: true, data };
    },
  },

  {
    def: {
      name: "list_user_assets",
      description:
        "List everything the AI has previously stashed in object storage for the current project — both imported assets and saved scene snapshots. Use this to recall a model URL you uploaded earlier, or to find a prior snapshot to share with the user.",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["assets", "snapshots", "all"],
            description: "Filter by kind. Defaults to 'all'.",
          },
        },
      },
    },
    exec: async (input) => {
      const projectId = useEditor.getState().projectId;
      if (!projectId) return { ok: false, error: "No project open." };
      const kind = typeof input.kind === "string" ? input.kind : "all";
      const res = await fetch(
        apiUrl(`ai-storage/list/${encodeURIComponent(projectId)}?kind=${encodeURIComponent(kind)}`),
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `List failed (${res.status}): ${body}` };
      }
      const data = (await res.json()) as {
        projectId: string;
        items: Array<{
          kind: "asset" | "snapshot";
          key: string;
          url: string;
          sizeBytes: number;
          lastModified: string | null;
        }>;
      };
      return { ok: true, data };
    },
  },

  // ── Introspection / "systems understanding" tools ──────────────────
  // Sourced from src/ai/tools/systems/. Keep this block last so parallel
  // tasks adding new tools can append above without merging into this
  // marker section. Do NOT inline these — keep the spread import-driven.
  ...systemsToolDefs.map((def) => ({
    def,
    exec: systemsToolHandlers[def.name] as ToolExecutor,
  })),
  ...scriptingToolDefs.map((def) => ({
    def,
    exec: scriptingToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Design & spatial-sense tools ───────────────────────────────────
  // Sourced from src/ai/tools/design/. Same one-import-one-spread pattern
  // as the systems tools above so parallel tasks merge cleanly.
  ...designToolDefs.map((def) => ({
    def,
    exec: designToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Unity-style physics layers tools ──────────────────────────────
  // Sourced from src/ai/tools/layers/. One-import-one-spread pattern.
  ...layersToolDefs.map((def) => ({
    def,
    exec: layersToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Navigation / surface / nav-agent tools ────────────────────────
  // Sourced from src/ai/tools/nav/. Same one-import-one-spread shape.
  ...navToolDefs.map((def) => ({
    def,
    exec: navToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Material tools ────────────────────────────────────────────────
  // Sourced from src/ai/tools/materials/. One-import-one-spread shape.
  ...materialsToolDefs.map((def) => ({
    def,
    exec: materialsToolHandlers[def.name] as ToolExecutor,
  })),
];

export const TOOL_DEFS: ToolDef[] = AI_TOOLS.map((t) => t.def);

const TOOL_INDEX: Record<string, ToolExecutor> = Object.fromEntries(
  AI_TOOLS.map((t) => [t.def.name, t.exec]),
);

// Fail fast in dev if a sub-module's `defs` and `handlers` drift apart —
// the spread above types `exec` as ToolExecutor but won't catch a missing
// handler at compile time (the cast covers it). Without this, an undefined
// executor would surface only as a confusing "Unknown tool" at runtime.
for (const t of AI_TOOLS) {
  if (typeof t.exec !== "function") {
    throw new Error(
      `AI tool "${t.def.name}" has no executor — check that its defs/handlers map agree.`,
    );
  }
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const exec = TOOL_INDEX[name];
  if (!exec) return { ok: false, error: `Unknown tool "${name}"` };
  try {
    return await exec(input ?? {});
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the system prompt with live editor context. */
export function buildSystemPrompt(): string {
  const s = useEditor.getState();
  const counts: Record<string, number> = {};
  for (const e of s.sceneData.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const env = s.sceneData.environment;

  return [
    `You are the AI Worker for "Grudge GameForge" — an in-browser 3D game prototyping editor (Three.js + React Three Fiber + Rapier physics + Zustand state).`,
    `You can directly manipulate the editor through the provided tools: create / edit / delete entities, set environment, generate procedural maps, spawn VFX prefabs, write & attach gameplay scripts, mark a player, etc.`,
    ``,
    `Coordinate space: Y is UP, units are meters. Default sky color is the editor's gold-on-charcoal theme (brand: #d4af37).`,
    ``,
    `LIVE CONTEXT:`,
    `- projectId: ${s.projectId ?? "(none — most tools will fail until a project is open)"}`,
    `- sceneName: "${s.sceneName}"  isPlaying: ${s.isPlaying}`,
    `- entityCount: ${s.sceneData.entities.length}  byType: ${JSON.stringify(counts)}`,
    `- environment.cameraMode: ${env.cameraMode ?? "editor"}  gravity: ${JSON.stringify(env.gravity ?? DEFAULT_GRAVITY)}`,
    `- selectedId: ${s.selectedId ?? "(none)"}`,
    `- builtin models available: ${Object.keys(BUILTIN_MODELS).join(", ")}`,
    ``,
    `WORKING STYLE:`,
    `- Take initiative. If the user asks for a "playable scene", combine multiple tools (generate_map → add_model_entity for player → set_player → maybe set_environment).`,
    `- For "feel" tweaks ("warmer", "snappier", "more floaty", "first person") prefer set_tunable_param — call list_tunable_params first to see the current value and the allowed range.`,
    `- For bulk questions about the scene ("how many enemies?", "any dynamic bodies without a script?") use count_entities / query_entities — they read from a denormalized ECS mirror with rich structural filters, so they're far more ergonomic than reasoning over list_entities output.`,
    `- BEFORE building anything substantial, orient yourself: call get_active_scene_meta to confirm what's open, get_project_summary for project-wide counts, and describe_layout to see where existing geometry sits so you place new content in empty space. Use list_scenes / list_prefabs / list_assets to discover what already exists rather than re-creating it.`,
    `- Use diagnose_scene after a chunk of edits to catch missing lights, missing ground, dangling camera targets, orphan parents, and similar gotchas — fix any 'error' severity issues before declaring the task done.`,
    `- When the user reports something broken ("nothing happens", "it crashed", "the script doesn't run"), call get_console_errors first — runtime errors and asset-load failures land there. Use get_recent_history (editor-wide undo stack) and get_last_ai_changes (AI-only audit log) to remember what was just touched.`,
    `- Use list_entities to look up real ids before update_entity / delete_entity / attach_script — never guess ids.`,
    `- SCRIPT EDITS: never write a script body blind. Call get_script (or list_script_attachments → get_script) to read the current source, edit it, then prefer patch_script with a unified diff for small changes (use update_script only for full rewrites). Both write tools call validate_script internally and refuse to save broken code, so check the returned validation.errors and self-correct. After scripted behavior runs, use get_script_logs to confirm it actually did what you intended.`,
    `- For new behaviors, look at list_script_templates first — scaffolding from a template (create_script_from_template) is faster and less error-prone than writing from scratch.`,
    `- For player characters prefer the built-in 'blake' model.`,
    `- To pull a fresh asset off the web, use import_asset_from_url (returns a URL you can immediately drop into add_model_entity's modelUrl). Reuse list_user_assets to recall what you've already imported for this project before re-downloading.`,
    `- To checkpoint the user's work or hand them a sharable scene, use save_scene_snapshot — it returns a public URL.`,
    `- Navigation, surfaces & nav-agents: every entity also carries a Surface tag (Walk/Jump/Climb/Swim/Dig/None) that lockstep-pins its physics layer (Walk/Jump/Climb/Dig→Terrain, Swim→Water). Use list_surfaces to see the registry, set_surface to tag a floor/ladder/water mesh, then bake_navmesh to produce a Recast navmesh stored on Environment.navmeshAssetId. Once baked, find_path / sample_navmesh let you query corridors and snap points; list_navmesh_stats summarizes what would re-bake. Drop a nav-agent on an NPC with set_nav_agent (filter chooses which areas the agent traverses) — at play-time it runs an XState idle/patrol/chase/climb/swim/stuck/dead machine and crossfades its animation clips automatically. set_surface, set_nav_agent and bake_navmesh are all DESTRUCTIVE (undoable in one step).`,
    `- Physics layers (Unity-style): every entity has a fixed-registry layer (Default/Terrain/Player/NPC/Item/Projectile/Trigger/Water/IgnoreRaycast/UI3D). Use list_layers + get_layer_matrix to inspect, set_layer to retag one entity (find_entities_by_layer for bulk lookup), set_layer_matrix to toggle which pairs collide. Trigger / Water default to Rapier sensors (intersection events fire, no contact). Setting a sensible layer (NPC for enemies, Item for pickups, Projectile for bullets) is usually enough — only edit the matrix when the user wants pass-through behaviour.`,
    `- Materials (first-class, orthogonal to Layer/Surface): every entity also carries a Material kind from a fixed registry (Solid/Metal/Glass/Wood/Stone/Cloth/Flag/Foliage/Liquid/Particle/Smoke). Per-kind defaults drive friction/restitution/drag/opacity AND three gameplay-critical occlusion flags — blocksLineOfSight, blocksProjectiles, blocksAudio. Glass lets bullets through but blocks sight; foliage blocks neither; smoke blocks none. Material/Layer/Surface inherit down the parent chain so a windowpane child of a 'walls' group inherits Terrain/Walk while keeping its own Glass material. Use list_materials to read the registry + defaults, set_material to retag entities (DESTRUCTIVE, undoable), find_entities_by_material for bulk lookup. The cloth/flag/particles entity types auto-default to matching material kinds. Castray accepts a materialFilter so projectile / line-of-sight / audio scripts get correct pass-through behaviour for free.`,
    `- Design & spatial-sense tools: when the user says the scene "looks bad / busy / empty / dark / boring", first call diagnose_scene then polish_scene (one-shot palette + lighting + framing + screenshot). When arranging more than 5 entities into a pattern, prefer arrange_entities (grid/ring/line/scatter/cluster) over moving them one at a time. Use apply_palette (id or string[] hex) with assignment 'random' | 'by-index' | 'by-distance-from-origin'; use apply_lighting_preset (studio-3pt | golden-hour | night-neon | overcast | interior-warm) — lights it spawns are tagged 'auto:lighting' so re-applying replaces cleanly. Always call frame_camera (and capture_viewport) before declaring a creative task done — you literally see the screenshot on the next turn. Use list_palettes / list_lighting_presets / list_camera_bookmarks / recall_camera_bookmark to inspect or restore.`,
    `- After changes, briefly summarize what you did in plain language (1-2 sentences).`,
    `- Do NOT call clear_scene unless the user explicitly asks to wipe / reset / start over.`,
    ``,
    `RESPONSE PROTOCOL (the panel parses these tags out before showing your reply to the user):`,
    `- If your reply will involve MORE THAN ONE tool call, START with a <plan> tag containing a JSON array of {"step": <int>, "intent": "<short label>"} entries — one per planned tool call, in execution order. The panel renders this as a checklist that ticks off as each tool finishes. Skip the <plan> tag for single-tool responses.`,
    `  Example: <plan>[{"step":1,"intent":"Generate city map"},{"step":2,"intent":"Spawn Blake"},{"step":3,"intent":"Set the player controller"}]</plan>`,
    `- ALWAYS end your FINAL assistant message with a <next_actions> tag containing a JSON array of 2 to 3 short follow-up suggestions (≤ 60 chars each) that the user might tap next, phrased as imperatives.`,
    `  Example: <next_actions>["Center the camera on Blake","Add a streetlight above the spawn","Make the sky a dusk gradient"]</next_actions>`,
    `- Both tag blocks are stripped from the visible bubble — write your normal prose between/around them.`,
  ].join("\n");
}
