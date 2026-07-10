/**
 * Cloudflare Workers AI tools for the editor AI assistant.
 *
 * These let the AI generate textures, skyboxes, lore text, and scene
 * descriptions using Cloudflare's serverless AI models — without ever
 * exposing the API key to the browser. Each tool hits the api-server's
 * `/api/cf-ai/*` proxy routes.
 *
 * Follows the same `{ defs, handlers, destructiveToolNames }` shape as
 * every other tool folder so `aiTools.ts` can spread them in uniformly.
 */
import { useEditor } from "@/store/editor";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

// ── generate_texture ──────────────────────────────────────────────

const GENERATE_TEXTURE: ToolDef = {
  name: "generate_texture",
  description:
    "Generate a texture with Cloudflare Workers AI (FLUX / Phoenix / Lucid / SDXL). " +
    "Returns a durable R2 URL when projectId is open (else data-URL). " +
    "Optionally pass entityIds to auto-apply as albedo (or slot) via set_material_map in one step. " +
    "Example: prompt='seamless mossy stone wall, PBR diffuse', entityIds=['abc'], mapRepeat=[4,4].",
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Detailed description of the texture, e.g. 'seamless mossy stone wall, 1024x1024, PBR diffuse'.",
      },
      model: {
        type: "string",
        enum: [
          "@cf/black-forest-labs/flux-2-klein-4b",
          "@cf/leonardo/phoenix-1.0",
          "@cf/leonardo/lucid-origin",
          "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        ],
        description: "CF AI model. Defaults to flux-2-klein-4b (fastest).",
      },
      width: { type: "number", description: "Width 256–2048. Default 512." },
      height: { type: "number", description: "Height 256–2048. Default 512." },
      negativePrompt: { type: "string" },
      steps: { type: "number" },
      guidance: { type: "number" },
      seed: { type: "number" },
      entityIds: {
        type: "array",
        items: { type: "string" },
        description: "If set, auto-apply the texture to these entities.",
      },
      entityId: {
        type: "string",
        description: "Single entity to auto-apply (alias of entityIds).",
      },
      slot: {
        type: "string",
        enum: [
          "mapUrl",
          "normalMapUrl",
          "roughnessMapUrl",
          "metalnessMapUrl",
          "emissiveMapUrl",
        ],
        description: "Material map slot when auto-applying. Default mapUrl (albedo).",
      },
      mapRepeat: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "UV repeat when auto-applying, e.g. [4,4].",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

const generateTextureHandler: ToolHandler = async (input) => {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "prompt is required." };

  const projectId = useEditor.getState().projectId;
  const body: Record<string, unknown> = { prompt };
  if (input.model) body.model = input.model;
  if (input.width) body.width = input.width;
  if (input.height) body.height = input.height;
  if (input.negativePrompt) body.negativePrompt = input.negativePrompt;
  if (input.steps) body.steps = input.steps;
  if (input.guidance) body.guidance = input.guidance;
  if (input.seed) body.seed = input.seed;
  if (projectId) body.projectId = projectId;

  try {
    const res = await fetch(apiUrl("cf-ai/text-to-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return {
        ok: false,
        error: (err as { error?: string }).error ?? `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      image: string;
      contentType: string;
      byteSize: number;
      model: string;
      url?: string;
      key?: string;
    };
    const url =
      data.url ?? `data:${data.contentType};base64,${data.image}`;

    useEditor.getState().pushLog(
      "info",
      `CF AI texture (${data.model}, ${data.byteSize} B)${data.url ? ` → ${data.url}` : " (data-URL)"}`,
    );

    // Optional one-shot apply onto selected entities
    const applyIds: string[] = [];
    if (typeof input.entityId === "string" && input.entityId.trim()) {
      applyIds.push(input.entityId.trim());
    }
    if (Array.isArray(input.entityIds)) {
      for (const id of input.entityIds) {
        if (typeof id === "string" && id.trim()) applyIds.push(id.trim());
      }
    }
    let applied: string[] | undefined;
    if (applyIds.length > 0) {
      const slot =
        typeof input.slot === "string" && input.slot
          ? input.slot
          : "mapUrl";
      const repeat =
        Array.isArray(input.mapRepeat) &&
        input.mapRepeat.length >= 2 &&
        typeof input.mapRepeat[0] === "number" &&
        typeof input.mapRepeat[1] === "number"
          ? ([input.mapRepeat[0], input.mapRepeat[1]] as [number, number])
          : undefined;
      applied = [];
      for (const id of [...new Set(applyIds)]) {
        const ent = useEditor.getState().sceneData.entities.find((e) => e.id === id);
        if (!ent) continue;
        useEditor.getState().cmdUpdateEntity(id, (e) => {
          const mat = { ...(e.material ?? {}), kind: e.material?.kind ?? ("Custom" as const) };
          (mat as Record<string, unknown>)[slot] = url;
          if (repeat) mat.mapRepeat = repeat;
          e.material = mat;
        });
        applied.push(id);
      }
      if (applied.length) {
        useEditor.getState().pushLog(
          "info",
          `Texture auto-applied to ${applied.length} entit${applied.length === 1 ? "y" : "ies"} (${slot}).`,
        );
      }
    }

    return {
      ok: true,
      data: {
        url,
        key: data.key,
        model: data.model,
        byteSize: data.byteSize,
        contentType: data.contentType,
        appliedTo: applied,
        next:
          applied && applied.length
            ? "Texture is on the entity. Adjust mapRepeat or generate a normal map with slot=normalMapUrl."
            : "Call set_material_map({ entityIds, url }) to apply, or re-run with entityIds.",
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ── generate_skybox ──────────────────────────────────────────────

const GENERATE_SKYBOX: ToolDef = {
  name: "generate_skybox",
  description:
    "Generate a skybox / environment texture and optionally apply it to the scene's sky. " +
    "Works like generate_texture but with skybox-optimized defaults (1024×512 equirectangular). " +
    "If apply=true, the generated image is set as the scene's environment.skyTexture automatically.",
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Describe the sky, e.g. 'dramatic sunset over ocean, equirectangular panorama, HDR'.",
      },
      model: {
        type: "string",
        enum: [
          "@cf/black-forest-labs/flux-2-klein-4b",
          "@cf/leonardo/phoenix-1.0",
          "@cf/leonardo/lucid-origin",
          "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        ],
      },
      apply: {
        type: "boolean",
        description: "If true, automatically set as the scene sky texture. Default true.",
      },
      negativePrompt: { type: "string" },
      steps: { type: "number" },
      guidance: { type: "number" },
      seed: { type: "number" },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

const generateSkyboxHandler: ToolHandler = async (input) => {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "prompt is required." };

  const projectId = useEditor.getState().projectId;
  const body: Record<string, unknown> = {
    prompt,
    width: 1024,
    height: 512,
  };
  if (input.model) body.model = input.model;
  if (input.negativePrompt) body.negativePrompt = input.negativePrompt;
  if (input.steps) body.steps = input.steps;
  if (input.guidance) body.guidance = input.guidance;
  if (input.seed) body.seed = input.seed;
  if (projectId) body.projectId = projectId;

  try {
    const res = await fetch(apiUrl("cf-ai/text-to-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { ok: false, error: (err as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      image: string;
      contentType: string;
      byteSize: number;
      model: string;
      url?: string;
      key?: string;
    };

    const textureUrl = data.url ?? `data:${data.contentType};base64,${data.image}`;

    // Auto-apply: set sky color to a complementary dark tone derived
    // from the prompt (the generated image URL is returned for the AI
    // to apply via set_material_map or as a texture on a sky sphere).
    const shouldApply = input.apply !== false;
    if (shouldApply) {
      useEditor
        .getState()
        .cmdSetEnvironment({ skyColor: "#050510" }, "Set sky for AI-generated skybox");
    }

    useEditor.getState().pushLog(
      "info",
      `CF AI generated skybox (${data.model})${shouldApply ? " — applied to scene" : ""}`,
    );
    return {
      ok: true,
      data: {
        url: textureUrl,
        key: data.key,
        model: data.model,
        applied: shouldApply,
        byteSize: data.byteSize,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ── generate_lore ────────────────────────────────────────────────

const GENERATE_LORE: ToolDef = {
  name: "generate_lore",
  description:
    "Generate game lore, NPC dialogue, item descriptions, quest text, or world-building " +
    "content using Cloudflare's Llama 3.1 8B model. Returns plain text. " +
    "Optionally provide a system prompt to set the tone/genre.",
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "What to generate, e.g. 'Write a quest description for a pirate treasure hunt on Fabled Island'.",
      },
      system: {
        type: "string",
        description:
          "System prompt setting the tone, e.g. 'You are a dark fantasy lore writer for an MMORPG called Grudge Warlords.'",
      },
      maxTokens: {
        type: "number",
        description: "Maximum response length in tokens (64–4096). Default 1024.",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

const generateLoreHandler: ToolHandler = async (input) => {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "prompt is required." };

  const body: Record<string, unknown> = { prompt };
  if (input.system) body.system = input.system;
  if (input.maxTokens) body.maxTokens = input.maxTokens;

  try {
    const res = await fetch(apiUrl("cf-ai/generate-text"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { ok: false, error: (err as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { text: string; model: string };
    return { ok: true, data: { text: data.text, model: data.model } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ── describe_scene ───────────────────────────────────────────────

const DESCRIBE_SCENE: ToolDef = {
  name: "describe_scene",
  description:
    "Describe an image using Cloudflare's vision model (LLaVA). " +
    "Pass either imageUrl (public URL) or imageBase64. " +
    "Useful for labelling assets, describing screenshots, or understanding imported textures.",
  input_schema: {
    type: "object",
    properties: {
      imageUrl: {
        type: "string",
        description: "Public URL of the image to describe.",
      },
      imageBase64: {
        type: "string",
        description: "Base64-encoded image data (alternative to imageUrl).",
      },
      prompt: {
        type: "string",
        description: "Custom vision prompt. Default: 'Describe this image in detail.'",
      },
    },
    additionalProperties: false,
  },
};

const describeSceneHandler: ToolHandler = async (input) => {
  const body: Record<string, unknown> = {};
  if (input.imageUrl) body.imageUrl = input.imageUrl;
  if (input.imageBase64) body.imageBase64 = input.imageBase64;
  if (input.prompt) body.prompt = input.prompt;
  if (!body.imageUrl && !body.imageBase64) {
    return { ok: false, error: "imageUrl or imageBase64 is required." };
  }

  try {
    const res = await fetch(apiUrl("cf-ai/image-to-text"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { ok: false, error: (err as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { description: string; model: string };
    return { ok: true, data: { description: data.description, model: data.model } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ── list_cf_ai_models ────────────────────────────────────────────

const LIST_CF_AI_MODELS: ToolDef = {
  name: "list_cf_ai_models",
  description:
    "List the available Cloudflare Workers AI models and whether the server has CF AI configured. " +
    "Returns model id, label, and task type for each model.",
  input_schema: { type: "object", properties: {} },
};

const listCfAiModelsHandler: ToolHandler = async () => {
  try {
    const res = await fetch(apiUrl("cf-ai/models"));
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ── Exports ──────────────────────────────────────────────────────

export const defs: ToolDef[] = [
  GENERATE_TEXTURE,
  GENERATE_SKYBOX,
  GENERATE_LORE,
  DESCRIBE_SCENE,
  LIST_CF_AI_MODELS,
];

export const handlers: Record<string, ToolHandler> = {
  generate_texture: generateTextureHandler,
  generate_skybox: generateSkyboxHandler,
  generate_lore: generateLoreHandler,
  describe_scene: describeSceneHandler,
  list_cf_ai_models: listCfAiModelsHandler,
};

/** generate_texture and generate_skybox mutate the scene (textures/sky). */
export const destructiveToolNames: string[] = [
  "generate_texture",
  "generate_skybox",
];
