/**
 * Cloudflare Workers AI — REST API client.
 *
 * Thin wrapper around `fetch` that talks to the public CF AI inference
 * endpoint:
 *   POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
 *
 * Auth: Bearer token via `CF_AI_API_TOKEN` (needs `Workers AI - Read` +
 * `Workers AI - Edit` permissions in the Cloudflare dashboard).
 *
 * The account ID is reused from `CF_ACCOUNT_ID` (same one the R2 storage
 * adapter already requires).
 */
import { logger } from "./logger";

/** Check whether Cloudflare AI is configured at boot time. */
export function cfAiConfigured(): boolean {
  return Boolean(process.env.CF_ACCOUNT_ID && process.env.CF_AI_API_TOKEN);
}

function baseUrl(): string {
  const accountId = process.env.CF_ACCOUNT_ID;
  if (!accountId) throw new Error("CF_ACCOUNT_ID is required for Workers AI");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;
}

function token(): string {
  const t = process.env.CF_AI_API_TOKEN;
  if (!t) throw new Error("CF_AI_API_TOKEN is required for Workers AI");
  return t;
}

// ─── Public model catalog exposed to the editor ───────────────────

export interface CfAiModelEntry {
  id: string;
  label: string;
  task: "text-to-image" | "text-generation" | "image-to-text";
}

export const CF_AI_MODELS: CfAiModelEntry[] = [
  // Text-to-image
  {
    id: "@cf/black-forest-labs/flux-2-klein-4b",
    label: "FLUX.2 Klein 4B (fast)",
    task: "text-to-image",
  },
  {
    id: "@cf/leonardo/phoenix-1.0",
    label: "Phoenix 1.0 (Leonardo)",
    task: "text-to-image",
  },
  {
    id: "@cf/leonardo/lucid-origin",
    label: "Lucid Origin (Leonardo)",
    task: "text-to-image",
  },
  {
    id: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    label: "Stable Diffusion XL",
    task: "text-to-image",
  },
  // Text generation (lore / dialogue / descriptions)
  {
    id: "@cf/meta/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B Instruct",
    task: "text-generation",
  },
  // Image-to-text (asset description)
  {
    id: "@cf/llava-hf/llava-1.5-7b-hf",
    label: "LLaVA 1.5 7B",
    task: "image-to-text",
  },
];

const MODEL_SET = new Set(CF_AI_MODELS.map((m) => m.id));

export function isAllowedModel(model: string): boolean {
  return MODEL_SET.has(model);
}

// ─── Inference helpers ────────────────────────────────────────────

export interface CfAiError {
  code: number;
  message: string;
}

export interface CfAiResponse<T> {
  result: T;
  success: boolean;
  errors: CfAiError[];
  messages: string[];
}

/** 60 s timeout — image models can be slow on cold start. */
const TIMEOUT_MS = 60_000;

/**
 * Run a model via the CF AI REST API and return the parsed JSON
 * envelope. Throws on network errors or non-2xx responses.
 */
export async function runModel<T = unknown>(
  model: string,
  input: Record<string, unknown>,
): Promise<CfAiResponse<T>> {
  const url = `${baseUrl()}/${model}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error(
        { status: res.status, model, body: text.slice(0, 500) },
        "CF AI request failed",
      );
      throw new Error(`CF AI returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as CfAiResponse<T>;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Run a text-to-image model and return raw image bytes (PNG/JPG).
 * Image models return a binary stream, not JSON, so we handle them
 * separately.
 */
export async function runImageModel(
  model: string,
  input: Record<string, unknown>,
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = `${baseUrl()}/${model}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error(
        { status: res.status, model, body: text.slice(0, 500) },
        "CF AI image request failed",
      );
      throw new Error(`CF AI returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const ct = res.headers.get("content-type") ?? "image/png";
    // Some models return JSON with base64 image instead of raw bytes
    if (ct.includes("application/json")) {
      const json = (await res.json()) as {
        result?: { image?: string };
        image?: string;
      };
      const b64 = json.result?.image ?? json.image;
      if (!b64) throw new Error("CF AI returned JSON but no image field");
      return {
        buffer: Buffer.from(b64, "base64"),
        contentType: "image/png",
      };
    }
    const arrayBuf = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuf),
      contentType: ct.split(";")[0]?.trim() ?? "image/png",
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
