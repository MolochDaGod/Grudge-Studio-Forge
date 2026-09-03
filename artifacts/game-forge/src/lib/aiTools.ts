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
import { FAST_ASSETS } from "@/lib/fastAssets";
import { checkAssetUrl, requireAgentAssetUrl } from "@/lib/assetUrlPolicy";
import {
  createAgentJob,
  fetchCatalogStatus,
  fetchFastCatalog,
  fetchGamedata,
  getAgentJob,
  listAgentJobs,
  searchFleetAssets,
} from "@/lib/agentEdge";
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
import { getSectorById, BIOME_LABELS } from "@/lib/worldSectors";
import {
  listTunableParams,
  setTunableParam,
} from "@/lib/tunableParams";
import {
  countEntities as ecsCountEntities,
  queryEntities as ecsQueryEntities,
  type EcsFilter,
} from "@/lib/ecs";
import {
  executeListTools,
  executeCallTool,
} from "@/lib/ai/toolDispatcher";
import {
  countEntities as ecsCountEntities,
  queryEntities as ecsQueryEntities,
  type EcsFilter,
} from "@/lib/ecs";
import {
  executeListTools,
  executeCallTool,
} from "@/lib/ai/toolDispatcher";
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
  defs as structuresToolDefs,
  handlers as structuresToolHandlers,
  destructiveToolNames as structuresDestructiveTools,
} from "@/ai/tools/structures";
import {
  defs as navToolDefs,
  handlers as navToolHandlers,
  destructiveToolNames as navDestructiveTools,
} from "@/ai/tools/nav";
import {
  defs as puterToolDefs,
  handlers as puterToolHandlers,
  destructiveToolNames as puterDestructiveTools,
} from "@/ai/tools/puter";
import {
  defs as materialsToolDefs,
  handlers as materialsToolHandlers,
  destructiveToolNames as materialsDestructiveTools,
} from "@/ai/tools/materials";
import {
  defs as effectsToolDefs,
  handlers as effectsToolHandlers,
  destructiveToolNames as effectsDestructiveTools,
} from "@/ai/tools/effects";
import {
  defs as statsToolDefs,
  handlers as statsToolHandlers,
  destructiveToolNames as statsDestructiveTools,
} from "@/ai/tools/stats";
import {
  defs as cfaiToolDefs,
  handlers as cfaiToolHandlers,
  destructiveToolNames as cfaiDestructiveTools,
} from "@/ai/tools/cfai";
import {
  defs as knowledgeToolDefs,
  handlers as knowledgeToolHandlers,
  destructiveToolNames as knowledgeDestructiveTools,
} from "@/ai/tools/knowledge";
import {
  defs as motionToolDefs,
  handlers as motionToolHandlers,
  destructiveToolNames as motionDestructiveTools,
} from "@/ai/tools/motion";
import {
  defs as uiToolDefs,
  handlers as uiToolHandlers,
  destructiveToolNames as uiDestructiveTools,
} from "@/ai/tools/ui";
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
  ...structuresDestructiveTools,
  ...navDestructiveTools,
  ...materialsDestructiveTools,
  ...puterDestructiveTools,
  ...effectsDestructiveTools,
  ...statsDestructiveTools,
  ...cfaiDestructiveTools,
  ...knowledgeDestructiveTools,
  ...motionDestructiveTools,
  ...uiDestructiveTools,
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
    let url = input.model?.builtin
      ? `builtin:${input.model.builtin}`
      : input.model?.url;
    if (url) {
      const checked = checkAssetUrl(url);
      if (checked.ok) url = checked.url;
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
  // ── Tool dispatcher (for providers with low tool limits) ────────────
  {
    def: {
      name: "list_tools",
      description:
        "List all available AI tools, optionally filtered by domain. Domains: scene, script, nav, materials, physics, design, assets, knowledge, systems, effects, puter, stats, ui, other.",
      input_schema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description:
              "Optional domain filter: scene | script | nav | materials | physics | design | assets | knowledge | systems | effects | puter | stats | ui | other",
          },
        },
      },
    },
    exec: executeListTools,
  },
  {
    def: {
      name: "call_tool",
      description:
        "Execute a specific tool by name with the given arguments. Use list_tools first to discover available tools.",
      input_schema: {
        type: "object",
        required: ["name", "arguments"],
        properties: {
          name: { type: "string", description: "Tool name from list_tools" },
          arguments: {
            type: "object",
            description: "Tool arguments matching the input_schema from list_tools",
          },
        },
      },
    },
    exec: executeCallTool,
  },
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

  {
    def: {
      name: "list_fast_assets",
      description:
        "List one-click Fast options (characters, maps, VFX, weapons, nature, RTS). Prefer these over inventing URLs. Returns id, label, group, modelUrl (usually builtin:…).",
      input_schema: {
        type: "object",
        properties: {
          group: {
            type: "string",
            description:
              "Optional filter: characters|maps|vfx|nature|buildings|vehicles|props|weapons",
          },
        },
      },
    },
    exec: async (input) => {
      const { items, source } = await fetchFastCatalog();
      const group =
        typeof input.group === "string" ? input.group.toLowerCase() : null;
      const filtered = group
        ? items.filter((a) => a.group === group)
        : items;
      return {
        ok: true,
        data: {
          source,
          count: filtered.length,
          items: filtered.map((a) => ({
            id: a.id,
            label: a.label,
            group: a.group,
            modelUrl: a.modelUrl,
            blurb: a.blurb,
          })),
        },
      };
    },
  },

  {
    def: {
      name: "spawn_fast_asset",
      description:
        "Spawn a Fast options asset by id (from list_fast_assets). Uses durable builtin:/R2 URLs only.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Fast asset id e.g. char-race-orc" },
          name: { type: "string" },
          position: {
            type: "array",
            items: { type: "number" },
            minItems: 3,
            maxItems: 3,
          },
        },
        required: ["id"],
      },
    },
    exec: async (input) => {
      const id = String(input.id ?? "");
      const { items } = await fetchFastCatalog();
      const a = items.find((x) => x.id === id) ?? FAST_ASSETS.find((x) => x.id === id);
      if (!a) {
        return {
          ok: false,
          error: `Unknown fast asset id "${id}". Call list_fast_assets first.`,
        };
      }
      let modelUrl: string;
      try {
        modelUrl = requireAgentAssetUrl(a.modelUrl);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      const e = buildEntity({
        type: "model",
        name: typeof input.name === "string" ? input.name : a.label,
        position: (input.position as [number, number, number] | undefined) ?? [
          0,
          a.spawnY ?? 0,
          0,
        ],
        scale: a.scale != null ? [a.scale, a.scale, a.scale] : undefined,
        model: { url: modelUrl },
      });
      if (!e.model?.url) {
        return { ok: false, error: "Failed to build model entity" };
      }
      useEditor.getState().commandStack.push(addEntityCommand(makeStoreLike(), e));
      return {
        ok: true,
        data: { id: e.id, name: e.name, modelUrl: e.model.url, fastId: a.id },
      };
    },
  },

  {
    def: {
      name: "search_fleet_assets",
      description:
        "Search fleet D1 asset registry (R2-backed) via edge Worker. Returns durable cdnUrl on assets.grudge-studio.com only. Prefer for characters/weapons/nature beyond Fast options. Use category=characters|weapons|maps|nature or prefix=models/grudge6. NEVER invent CDN paths — only use returned cdnUrl.",
      input_schema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Substring match on name / r2Key (e.g. sword, grudge6, pirate)",
          },
          category: {
            type: "string",
            description: "characters | weapons | maps | nature | icons | or registry category",
          },
          prefix: {
            type: "string",
            description: "r2Key prefix e.g. models/grudge6 or models/nature/stylized",
          },
          format: {
            type: "string",
            description: "glb | fbx | gltf | image",
          },
          limit: { type: "number", description: "Max results (default 40, max 100)" },
        },
      },
    },
    exec: async (input) => {
      const result = await searchFleetAssets({
        q: typeof input.q === "string" ? input.q : undefined,
        category: typeof input.category === "string" ? input.category : undefined,
        prefix: typeof input.prefix === "string" ? input.prefix : undefined,
        format: typeof input.format === "string" ? input.format : undefined,
        limit: typeof input.limit === "number" ? input.limit : 40,
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error || "search_fleet_assets failed",
        };
      }
      return {
        ok: true,
        data: {
          count: result.count,
          fleetIndex: result.fleetIndex,
          items: result.items.map((a) => ({
            name: a.name,
            category: a.category,
            r2Key: a.r2Key,
            cdnUrl: a.cdnUrl,
            format: a.format,
            source: a.source,
          })),
          tip: "Spawn with spawn_fleet_asset({ cdnUrl }) or add_model_entity({ model: { url: cdnUrl } }).",
        },
      };
    },
  },

  {
    def: {
      name: "spawn_fleet_asset",
      description:
        "Spawn a model from a fleet search cdnUrl (must be https://assets.grudge-studio.com/…). Call search_fleet_assets first.",
      input_schema: {
        type: "object",
        properties: {
          cdnUrl: {
            type: "string",
            description: "Exact cdnUrl from search_fleet_assets",
          },
          name: { type: "string" },
          position: {
            type: "array",
            items: { type: "number" },
            minItems: 3,
            maxItems: 3,
          },
        },
        required: ["cdnUrl"],
      },
    },
    exec: async (input) => {
      const raw = String(input.cdnUrl ?? "");
      let modelUrl: string;
      try {
        modelUrl = requireAgentAssetUrl(raw);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      const check = checkAssetUrl(modelUrl);
      if (!check.ok || (check.kind !== "cdn" && check.kind !== "builtin")) {
        return {
          ok: false,
          error: `spawn_fleet_asset requires assets.grudge-studio.com or builtin: — got ${modelUrl.slice(0, 80)}`,
        };
      }
      const label =
        typeof input.name === "string"
          ? input.name
          : modelUrl.split("/").pop()?.replace(/\.[^.]+$/, "") || "Fleet asset";
      const e = buildEntity({
        type: "model",
        name: label,
        position: (input.position as [number, number, number] | undefined) ?? [
          0, 0, 0,
        ],
        model: { url: modelUrl },
      });
      if (!e.model?.url) {
        return { ok: false, error: "Failed to build model entity" };
      }
      useEditor.getState().commandStack.push(addEntityCommand(makeStoreLike(), e));
      return {
        ok: true,
        data: { id: e.id, name: e.name, modelUrl: e.model.url },
      };
    },
  },

  {
    def: {
      name: "list_gamedata",
      description:
        "List ObjectStore gamedata (weapons/equipment/materials) with id, name, iconUrl, lore. Icons may 404 until R2 icon pack is seeded — still use ids for UI/crafting. For 3D weapon meshes use search_fleet_assets category=weapons or Fast weapons (grudge6 library).",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description: "weapons | equipment | materials | armor | races (default weapons)",
          },
          q: { type: "string", description: "Filter by name/id" },
          limit: { type: "number" },
        },
      },
    },
    exec: async (input) => {
      const result = await fetchGamedata({
        kind: typeof input.kind === "string" ? input.kind : "weapons",
        q: typeof input.q === "string" ? input.q : undefined,
        limit: typeof input.limit === "number" ? input.limit : 40,
      });
      if (!result.ok) {
        return { ok: false, error: result.error || "list_gamedata failed" };
      }
      return {
        ok: true,
        data: {
          kind: result.kind,
          count: result.count,
          policy: result.policy,
          items: result.items.map((it) => ({
            id: it.id,
            name: it.name,
            category: it.category,
            iconUrl: it.iconUrl,
            modelUrl: it.modelUrl,
            primaryStat: it.primaryStat,
            lore: it.lore,
          })),
        },
      };
    },
  },

  {
    def: {
      name: "agent_stack_status",
      description:
        "Report edge stack health for agentic creation: D1 jobs, Fast catalog, fleet search, free-AI, R2 policy. Call when diagnosing deploy/AI wiring.",
      input_schema: { type: "object", properties: {} },
    },
    exec: async () => {
      const catalog = await fetchCatalogStatus();
      const jobs = await listAgentJobs();
      const probe = await searchFleetAssets({
        category: "characters",
        limit: 3,
      });
      const { getProjectStorageStatus } = await import(
        "@/lib/cloud/projectStorage"
      );
      const { forgeEnvSnapshot, freeAiStatusUrl } = await import(
        "@/lib/forgeEnv"
      );
      const storage = getProjectStorageStatus();
      let freeAi: { ok: boolean; detail?: unknown } = { ok: false };
      try {
        const r = await fetch(freeAiStatusUrl(), { cache: "no-store" });
        freeAi = { ok: r.ok, detail: r.ok ? await r.json() : { status: r.status } };
      } catch (err) {
        freeAi = {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      return {
        ok: true,
        data: {
          catalog,
          freeAi,
          storage,
          dualWrite:
            "local LS/IDB always; Puter KV+FS when signed in; read merge for next visit",
          agenticAuto:
            "grudge-ai:auto → groq → together (fleet free-ai secrets live)",
          env: forgeEnvSnapshot({
            isPuterSignedIn: storage.puterSignedIn,
            storageBackend: storage.backend,
          }),
          openJobs: jobs.filter((j) => j.status === "pending" || j.status === "running")
            .length,
          recentJobs: jobs.slice(0, 5),
          fleetSearch: {
            ok: probe.ok,
            count: probe.count,
            index: probe.fleetIndex,
            sample: probe.items.slice(0, 3).map((i) => i.r2Key),
          },
          policy:
            "Projects: local IDB/localStorage OR Puter Grudge/forge. Models: builtin: or assets.grudge-studio.com. Gamedata: ObjectStore. Play bag: Railway. Agent jobs: D1 forge-agent. Brain: /api/knowledge. Free AI: /api/free-ai.",
        },
      };
    },
  },

  {
    def: {
      name: "create_agent_job",
      description:
        "Enqueue an edge agent job (catalog/generate/bake hint). Poll with get_agent_job. Durable when D1 is bound on free-ai worker.",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description: "Job kind e.g. generate-texture, bake-glb, spawn-hint",
          },
          prompt: { type: "string" },
        },
        required: ["kind"],
      },
    },
    exec: async (input) => {
      const job = await createAgentJob({
        kind: String(input.kind),
        prompt: typeof input.prompt === "string" ? input.prompt : undefined,
      });
      if (!job) {
        return {
          ok: false,
          error:
            "Agent job API unavailable. Deploy grudge-forge-free-ai worker with /api/agent routes.",
        };
      }
      return { ok: true, data: job };
    },
  },

  {
    def: {
      name: "get_agent_job",
      description: "Get status of an edge agent job by id.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    exec: async (input) => {
      const job = await getAgentJob(String(input.id));
      if (!job) return { ok: false, error: "Job not found or edge offline" };
      return { ok: true, data: job };
    },
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
      const raw = input as Parameters<typeof buildEntity>[0] & {
        model?: { builtin?: string; url?: string };
      };
      // Prefer builtin keys; validate any absolute URL against production policy.
      if (raw.model?.url && !raw.model?.builtin) {
        const c = checkAssetUrl(raw.model.url);
        if (!c.ok) {
          return {
            ok: false,
            error: `${c.error} Prefer list_fast_assets / list_builtin_models.`,
          };
        }
        raw.model = { ...raw.model, url: c.url };
      }
      if (raw.model?.builtin) {
        const key = raw.model.builtin.replace(/^builtin:/, "");
        if (!(key in BUILTIN_MODELS)) {
          return {
            ok: false,
            error: `Unknown builtin "${key}". Call list_builtin_models or list_fast_assets.`,
          };
        }
      }
      const e = buildEntity({
        ...raw,
        type: "model",
      });
      if (!e.model?.url) {
        return {
          ok: false,
          error:
            "Need either model.builtin or model.url. Call list_fast_assets or list_builtin_models.",
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
        "Update environment settings (sky/ground colors, ambient/sun, gravity, fog, camera mode, skyTexture). " +
        "For day/night stars/sun/moon/aurora prefer set_celestial; for rain/snow/storm use set_weather; " +
        "for full moods use apply_atmosphere_preset or generate_skybox.",
      input_schema: {
        type: "object",
        properties: {
          skyColor: { type: "string" },
          groundColor: { type: "string" },
          ambientColor: { type: "string" },
          ambientIntensity: { type: "number" },
          sunColor: { type: "string" },
          sunIntensity: { type: "number" },
          skyTexture: {
            type: "string",
            description: "Equirectangular skybox URL (https/data:/R2). Use set_sky_texture to clear.",
          },
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
      if (typeof input.skyTexture === "string") patch.skyTexture = input.skyTexture;
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
      const sourceUrl = String(input.sourceUrl ?? "");
      try {
        const u = new URL(sourceUrl);
        const host = u.hostname.toLowerCase();
        const ok =
          host === "assets.grudge-studio.com" ||
          host === "cdn.polyhaven.com" ||
          host === "dl.polyhaven.org" ||
          host.endsWith("polyhaven.com") ||
          host.endsWith("polyhaven.org");
        if (!ok) {
          return {
            ok: false,
            error: `import_asset_from_url blocked host "${host}". Use assets.grudge-studio.com, Poly Haven, or list_fast_assets.`,
          };
        }
      } catch {
        return { ok: false, error: "Invalid sourceUrl" };
      }
      const projectId = useEditor.getState().projectId;
      if (!projectId) return { ok: false, error: "No project open." };
      const res = await fetch(apiUrl("ai-storage/import-asset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sourceUrl,
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

  // ── Structure mesh kit (walls / openings / ladders / holes) ────────
  ...structuresToolDefs.map((def) => ({
    def,
    exec: structuresToolHandlers[def.name] as ToolExecutor,
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

  // ── Puter cloud tools ─────────────────────────────────────────────
  // Sourced from src/ai/tools/puter/. Save / publish / list against the
  // user's Puter drive. Guest path: each handler returns a structured
  // "Sign in with Puter" error.
  ...puterToolDefs.map((def) => ({
    def,
    exec: puterToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Effects tools (wind / soft-body) ──────────────────────────────
  // Sourced from src/ai/tools/effects/. One-import-one-spread shape.
  ...effectsToolDefs.map((def) => ({
    def,
    exec: effectsToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Stats tools (RPG attributes / derived stats) ───────────────────
  // Sourced from src/ai/tools/stats/. One-import-one-spread shape.
  ...statsToolDefs.map((def) => ({
    def,
    exec: statsToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Cloudflare Workers AI tools (texture gen / skybox / lore / vision) ─
  // Sourced from src/ai/tools/cfai/. One-import-one-spread shape.
  ...cfaiToolDefs.map((def) => ({
    def,
    exec: cfaiToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Knowledge / brain tools (R2 · D1 · GitHub · three.js/R3F/Rapier docs) ─
  // Sourced from src/ai/tools/knowledge/. Read-only research + storage recall.
  ...knowledgeToolDefs.map((def) => ({
    def,
    exec: knowledgeToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Motion / texture / physics tools ──────────────────────────────────
  // set_material_map, list_animations, apply_animation, set_physics
  ...motionToolDefs.map((def) => ({
    def,
    exec: motionToolHandlers[def.name] as ToolExecutor,
  })),

  // ── Professional UI kits (ui.grudge-studio.com) ───────────────────────
  // list_ui_kits, list_ui_layers, apply_ui_kit, browse_ui_kit, …
  ...uiToolDefs.map((def) => ({
    def,
    exec: uiToolHandlers[def.name] as ToolExecutor,
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
    `You are the AI Worker for "Grudge Studio Forge" (GameForge) — an in-browser 3D game prototyping editor (Three.js + React Three Fiber + Rapier physics + Zustand). You are the user's agentic co-builder: research examples, reuse R2/D1 memory, and mutate the live scene with tools.`,
    `Stack: Three.js 0.184 · R3F 9 · @react-three/rapier · drei · Monaco · Node 22 + pnpm 10 toolchain on the server.`,
    `You can directly manipulate the editor: create / edit / delete entities, environment, procedural maps, VFX prefabs, gameplay scripts, player, layers/surfaces/materials, CF AI textures, and cloud save.`,
    ``,
    `Coordinate space: Y is UP, units are meters. Brand gold: #d4af37 on charcoal.`,
    ``,
    `LIVE CONTEXT:`,
    `- projectId: ${s.projectId ?? "(none — open a project before R2/project tools)"}`,
    `- sceneName: "${s.sceneName}"  isPlaying: ${s.isPlaying}`,
    `- entityCount: ${s.sceneData.entities.length}  byType: ${JSON.stringify(counts)}`,
    `- environment.cameraMode: ${env.cameraMode ?? "editor"}  gravity: ${JSON.stringify(env.gravity ?? DEFAULT_GRAVITY)}`,
    `- selectedId: ${s.selectedId ?? "(none)"}`,
    `- builtin models available: ${Object.keys(BUILTIN_MODELS).join(", ")}`,
    (() => {
      const sectorId = s.activeSectorId;
      if (!sectorId) return `- worldSector: (none — no sector selected)`;
      const sector = getSectorById(sectorId);
      if (!sector) return `- worldSector: ${sectorId} (unknown)`;
      const safeNote = sector.isSafeZone ? " [SAFE ZONE — no PvP]" : "";
      const pvpNote = sector.isContested ? " [CONTESTED — active PvP]" : "";
      return [
        `- worldSector: "${sector.name}" (${sector.id})${safeNote}${pvpNote}`,
        `  biome: ${BIOME_LABELS[sector.biome]}  difficulty: ${sector.difficultyMin}–${sector.difficultyMax}`,
        `  lore: "${sector.lore}"`,
        `  hazards: ${sector.hazards.length ? sector.hazards.join(", ") : "none"}`,
        `  resources: ${sector.resources.join(", ")}`,
        `  ambientFx: ${sector.ambientFx.join(", ")}`,
        `  palette: deep=${sector.colors.deep} mid=${sector.colors.mid} accent=${sector.colors.accent}${sector.colors.glow ? ` glow=${sector.colors.glow}` : ""}`,
      ].join("\n");
    })(),
    ``,
    `AI BRAIN — R2 · D1 · FAST OPTIONS · EDGE (use these; do not invent APIs or URLs):`,
    `- STACK: Editor SPA = Vercel; edge = CF Workers; binaries = R2 (assets.grudge-studio.com); agent jobs = D1 forge-agent; fleet mesh INDEX = D1 via /api/catalog/search; gamedata = ObjectStore via /api/catalog/gamedata; player bag/XP = Railway Postgres. Do NOT use Docker for the SPA. Do NOT invent Replit/localhost URLs.`,
    `- FAST OPTIONS (preferred spawn path): list_fast_assets → spawn_fast_asset({ id }) or add_model_entity({ model: { builtin: '…' } }). Covers races, grudge6 kits, pirate islands, VFX, RTS, weapons. agent_stack_status diagnoses edge/D1.`,
    `- FLEET SEARCH (full registry): search_fleet_assets({ q, category, prefix, format }) → spawn_fleet_asset({ cdnUrl }). category=characters|weapons|maps|nature. prefix=models/grudge6. NEVER invent r2Key/cdnUrl — only returned rows.`,
    `- GAMEDATA (icons/stats, not meshes): list_gamedata({ kind:'weapons'|'equipment'|'materials', q }). iconUrl may 404 until icon pack on R2; for 3D weapons use Fast weapons or search_fleet_assets category=weapons (grudge6 library).`,
    `- Starter scenes / game examples: list_scenes when a project is open; templates via empty-scene picker. Maps use builtin:map-* keys → R2. Never invent relative /builtin:map-… paths.`,
    `- Cloudflare R2: list_r2_storage + list_user_assets. import_asset_from_url only for allowlisted hosts (then prefer the returned R2 URL). Never leave blob: or localhost in scenes.`,
    `- Asset policy: only builtin:<key> or https://assets.grudge-studio.com/… (or Poly Haven CDN during import). check fails → list_fast_assets or search_fleet_assets.`,
    `- D1 agent jobs: create_agent_job / get_agent_job when edge is up. Also d1_status / knowledge_status / query_d1 when configured. Else get_brain_catalog + list_scenes / list_prefabs / list_assets.`,
    `- Internet / GitHub research for three.js · R3F · Rapier · drei: search_github (topic= threejs|r3f|rapier|drei|gltf|physics|character|navmesh), list_docs, then fetch_doc_url on allowlisted hosts (threejs.org, docs.pmnd.rs, rapier.rs, github.com, raw.githubusercontent.com). Extract patterns → implement with Forge tools (entities, scripts, materials, node graph). Never dump entire repos; never claim you ran code you did not.`,
    `- When the user asks "how does X work in three/r3f/rapier?" or for examples: research first (list_docs → fetch_doc_url and/or search_github), then build a minimal working version in the scene.`,
    `- Blazor C# scripts: the editor ships a Blazor WASM runtime + C#→JS transpile path for MonoBehaviour-style scripts (public/_framework, scene/csTranspile). Prefer JS script templates (list_script_templates) unless the user explicitly wants C#; when writing C#, stick to Vector3/Transform/Time/Debug APIs documented in csharp/GameForgeRuntime.`,
    `- Node graph / visual blocks: use the Nodes panel tools when available; compile graphs to scene entities. Treat node-graph + AI as the "block LLM" layer for non-coders.`,
    `- Faction AI brains (attach_behavior / list_builtin_behaviors): player-deathmatch | player-rpg | enemy-deathmatch | enemy-rpg | ally | neutral | animal | wander-zone | vendor | boss | npc-dialog | spawnpoint | pickup-trigger | gamemode-deathmatch. Rulesets: deathmatch, rpg, skirmish, openWorld. Localized wander (threejs-games style): place wander-zone empties with wanderZone.kind (animal|camp|town|island) + radius; agents set wanderZone.zoneEntityId or own wanderZone.radius. Animals hard-leash; enemies/neutrals soft-leash when calm (chase may leave). Always set layer (Player/NPC/Terrain/Trigger/Water) + surface (Walk/Climb/Swim) on environment colliders.`,
    `- Texture & motion (do these end-to-end): generate_texture({ prompt, entityIds:[id], mapRepeat:[4,4] }) auto-applies albedo; or generate_texture then set_material_map({ entityId, url }). list_animations → apply_animation({ entityId, clip:'walk'|'run'|'idle'|'attack'|'death' }) plays immediately (fuzzy match + procedural biped). set_physics for Rapier bodyType/collider/ccd/capsule. set_wind + set_soft_body for cloth/flag/particles.`,
    `- Sky / weather / skybox (GPU shaders in viewport): list_atmosphere_presets → apply_atmosphere_preset({ preset:'thunderstorm'|'midnight-stars'|'aurora-night'|'golden-sunset'|… }) for full moods. set_celestial({ timeOfDay:0–1, stars, sun, moon, aurora }) for day/night. set_weather({ type:'rain'|'snow'|'dust'|'storm'|'fog'|'clear', intensity }). generate_skybox({ prompt, apply:true }) paints equirect skyTexture on the dome; set_sky_texture / clearSkyTexture to manage maps. Requires Cinematic render quality (not Performance).`,
    `- Professional UI layers (https://ui.grudge-studio.com): ALWAYS use list_ui_kits / browse_ui_kit when building HUDs, inventories, shops, skill trees, or deathmatch chrome. apply_ui_kit({ theme:'fantasy'|'cyberpunk'|'fps'|'rpg', layers:[...] }) stamps Environment.uiKit for PlayHUD. list_ui_layers for stack ids; list_ui_assets for /ui/rpg-mmo/ texture paths. Puter sign-in on the UI kit site saves designs — designUrl can be stored on uiKit.`,
    `- knowledge_status diagnoses broken R2/D1/GitHub wiring. Surface configuration errors clearly to the user.`,
    ``,
    `WORKING STYLE:`,
    `- Take initiative. For a "playable scene": generate_map → spawn_fast_asset (blake / race) → set_player → set_environment / apply_atmosphere_preset as needed.`,
    `- For "feel" tweaks prefer set_tunable_param after list_tunable_params.`,
    `- Bulk scene questions → count_entities / query_entities (ECS mirror).`,
    `- BEFORE big builds: get_active_scene_meta, get_project_summary or get_brain_catalog, describe_layout, list_scenes / list_prefabs / list_assets / list_r2_storage.`,
    `- After edit chunks: diagnose_scene → verify_scene_full (or verify_mesh_scale + verify_textures + verify_character_animation + verify_terrain_physics) → auto_fix_scene → re-verify before claiming done.`,
    `- Standards: list_threejs_standards({ topic:'terrain'|'textures'|'rapier'|'raycast'|'controller'|'animation'|'character'|'identity'|'redeploy'|'all' }).`,
    `- Prefer grudge6: builtin:grudge6:warrior|orc|… or Fast char-g6-* / search_fleet_assets category=characters. Avoid inventing URLs. Player: blake OR grudge6 human. No Meshy/capsules as final heroes.`,
    `- Anim library: ONE mixer; Bip001 packs; list_animations → apply_animation; strip position tracks; no mixamorig on Bip001; re-ground after sample.`,
    `- Rapier CCT: kinematicPosition + capsule (halfHeight~0.9, radius~0.3); terrain fixed + raycast down; layer=Terrain/Player.`,
    `- Identity: Grudge ID JWT (login?redirect_uri) for fleet; Puter for cloud only; dual-write grudge.open.token.`,
    `- Organized projects: scenes/, prefabs/, scripts/, assets/{models,textures,audio,vfx}, grudge.project.json when exporting to disk via Studio Projects.`,
    `- Breakage reports → get_console_errors, get_recent_history, get_last_ai_changes.`,
    `- Always list_entities for real ids before update/delete/attach — never guess ids.`,
    `- SCRIPT EDITS: get_script first; patch_script for small diffs; update_script for rewrites; respect validate_script errors; get_script_logs after play.`,
    `- New behaviors: list_script_templates → create_script_from_template when possible.`,
    `- Player characters: prefer builtin 'blake' or list_fast_assets characters group.`,
    `- Remote assets: import_asset_from_url (allowlisted) → add_model_entity; never random web hosts.`,
    `- Checkpoints / share: save_scene_snapshot.`,
    `- Navigation: list_surfaces, set_surface, bake_navmesh, find_path / sample_navmesh, set_nav_agent (destructive where noted).`,
    `- Physics layers: list_layers, get_layer_matrix, set_layer, set_layer_matrix.`,
    `- Materials: list_materials, set_material, find_entities_by_material.`,
    `- Storage dual-write (HARD): every project/scene save writes local LS/IDB backup AND Puter when signed in. project_storage_status · migrate_local_projects_to_puter · cloud_save_project (also local). Next visit loads Puter first with local fallback.`,
    `- Puter cloud: cloud_save_project, list_my_puter_projects, publish_to_puter — if "Sign in with Puter", tell the user; do not retry endlessly.`,
    `- Design polish: diagnose_scene → polish_scene; arrange_entities for patterns; apply_palette / apply_lighting_preset; frame_camera + capture_viewport before declaring creative work done.`,
    `- CF Workers AI: generate_texture / generate_skybox (auto-sets skyTexture) / lore tools when the user wants generated art — results land in R2 when projectId is set.`,
    `- OPTIONAL batch_generate: multi-job texture|skybox|lore|primitives packs (cap 12 jobs, concurrency 2). Use when the user wants many textures/props at once. Not for fleet publish/deploy — that remains a separate P0 path.`,
    `- Deploy SSOT: list_game_deployments (PublishChannel, L0–L9). list_forge_best_practices + list_threejs_standards topic=redeploy. SPA = GHA Deploy Forge SPA; free-ai wrangler; Legion dual workers. Never bundle_in_spa; player state = Railway not Forge API.`,
    `- Agent / sub-workers: create_agent_job + get_agent_job (D1 forge-agent); Grudge AI Legion via free-ai provider=grudge-ai. Not a second public AI domain.`,
    `- After changes, summarize in 1–2 plain sentences.`,
    `- Do NOT call clear_scene unless the user explicitly asks to wipe / reset / start over.`,
    ``,
    `RESPONSE PROTOCOL (panel strips these tags from the bubble):`,
    `- Multi-tool replies: start with <plan>[{"step":1,"intent":"..."},...]</plan>.`,
    `- Always end the FINAL message with <next_actions>["...", "..."]</next_actions> (2–3 imperatives, ≤60 chars each).`,
  ].join("\n");
}
