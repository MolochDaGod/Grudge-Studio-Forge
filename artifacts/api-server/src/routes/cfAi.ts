/**
 * Cloudflare Workers AI proxy routes.
 *
 * Exposes Cloudflare's serverless AI models to the editor via REST:
 *   - POST /cf-ai/text-to-image    — generate textures / skyboxes
 *   - POST /cf-ai/generate-text    — lore, dialogue, descriptions
 *   - POST /cf-ai/image-to-text    — describe an image (asset labelling)
 *   - GET  /cf-ai/models           — list available models for the UI
 *
 * Auth: the server holds CF_AI_API_TOKEN; the editor never sees it.
 * Rate limiting mirrors the Anthropic endpoint (sliding window per IP).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "crypto";
import {
  cfAiConfigured,
  CF_AI_MODELS,
  isAllowedModel,
  runModel,
  runImageModel,
} from "../lib/cfAiClient";
import { R2StorageService } from "../lib/r2Storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const storage = new R2StorageService();

// ── Rate limiter (10 req/min/IP — image gen is expensive) ────────

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const ipHits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = ipHits.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    ipHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 1000) {
    for (const [k, v] of ipHits) {
      if (v.every((t) => now - t > RATE_WINDOW_MS)) ipHits.delete(k);
    }
  }
  return false;
}

function rejectIfNotConfigured(res: Response): boolean {
  if (cfAiConfigured()) return false;
  res.status(503).json({
    error:
      "Cloudflare AI is not configured. Set CF_ACCOUNT_ID and CF_AI_API_TOKEN.",
  });
  return true;
}

// ── GET /cf-ai/models ────────────────────────────────────────────

router.get("/cf-ai/models", (_req: Request, res: Response) => {
  res.json({
    configured: cfAiConfigured(),
    models: CF_AI_MODELS,
  });
});

// ── POST /cf-ai/text-to-image ────────────────────────────────────
//
// Body: { prompt, model?, width?, height?, negativePrompt?,
//         steps?, guidance?, seed?, projectId? }
//
// When `projectId` is supplied and R2 is configured, the generated
// image is automatically uploaded to R2 and a `url` is returned so
// the AI tools can use it as a texture immediately.

const SAFE_PROJECT_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

router.post("/cf-ai/text-to-image", async (req: Request, res: Response) => {
  if (rejectIfNotConfigured(res)) return;
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded — try again shortly." });
    return;
  }

  const body = req.body as {
    prompt?: string;
    model?: string;
    width?: number;
    height?: number;
    negativePrompt?: string;
    steps?: number;
    guidance?: number;
    seed?: number;
    projectId?: string;
  };

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const model =
    typeof body.model === "string" && isAllowedModel(body.model)
      ? body.model
      : DEFAULT_IMAGE_MODEL;

  const input: Record<string, unknown> = { prompt };
  if (body.negativePrompt) input.negative_prompt = body.negativePrompt;
  if (typeof body.width === "number") input.width = Math.min(2048, Math.max(256, body.width));
  if (typeof body.height === "number") input.height = Math.min(2048, Math.max(256, body.height));
  if (typeof body.steps === "number") input.num_steps = Math.min(50, Math.max(1, body.steps));
  if (typeof body.guidance === "number") input.guidance = body.guidance;
  if (typeof body.seed === "number") input.seed = body.seed;

  try {
    const { buffer, contentType } = await runImageModel(model, input);

    // If the caller supplied a projectId, persist to R2 so the
    // generated image is immediately usable as a texture/skybox.
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    let url: string | undefined;
    let key: string | undefined;
    if (projectId && SAFE_PROJECT_ID.test(projectId)) {
      const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      key = `cf-ai/${projectId}/${hash}.${ext}`;
      try {
        await storage.ensurePublicBytes(key, buffer, { contentType });
        const direct = storage.getPublicUrl(key);
        url = direct ?? `/api/ai-storage/object/${encodeURI(key)}`;
      } catch (err) {
        logger.warn({ err, key }, "CF AI image R2 upload failed — returning base64 only");
      }
    }

    const b64 = buffer.toString("base64");
    res.json({
      image: b64,
      contentType,
      byteSize: buffer.byteLength,
      model,
      ...(url ? { url, key } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, model }, "cf-ai/text-to-image failed");
    res.status(502).json({ error: msg });
  }
});

// ── POST /cf-ai/generate-text ────────────────────────────────────
//
// Body: { prompt, system?, model?, maxTokens? }

const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

router.post("/cf-ai/generate-text", async (req: Request, res: Response) => {
  if (rejectIfNotConfigured(res)) return;
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded — try again shortly." });
    return;
  }

  const body = req.body as {
    prompt?: string;
    system?: string;
    model?: string;
    maxTokens?: number;
  };

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const model =
    typeof body.model === "string" && isAllowedModel(body.model)
      ? body.model
      : DEFAULT_TEXT_MODEL;

  const messages: Array<{ role: string; content: string }> = [];
  if (body.system) messages.push({ role: "system", content: body.system });
  messages.push({ role: "user", content: prompt });

  const maxTokens = Math.max(64, Math.min(4096, Number(body.maxTokens) || 1024));

  try {
    const result = await runModel<{ response?: string }>(model, {
      messages,
      max_tokens: maxTokens,
    });
    res.json({
      text: result.result?.response ?? "",
      model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, model }, "cf-ai/generate-text failed");
    res.status(502).json({ error: msg });
  }
});

// ── POST /cf-ai/image-to-text ────────────────────────────────────
//
// Body: { imageUrl OR imageBase64, prompt?, model? }

const DEFAULT_VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

router.post("/cf-ai/image-to-text", async (req: Request, res: Response) => {
  if (rejectIfNotConfigured(res)) return;
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded — try again shortly." });
    return;
  }

  const body = req.body as {
    imageUrl?: string;
    imageBase64?: string;
    prompt?: string;
    model?: string;
  };

  const model =
    typeof body.model === "string" && isAllowedModel(body.model)
      ? body.model
      : DEFAULT_VISION_MODEL;

  let imageArray: number[] | undefined;

  if (typeof body.imageBase64 === "string" && body.imageBase64.length > 0) {
    const buf = Buffer.from(body.imageBase64, "base64");
    imageArray = [...new Uint8Array(buf)];
  } else if (typeof body.imageUrl === "string" && body.imageUrl.length > 0) {
    // Download the image first
    try {
      const imgRes = await fetch(body.imageUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!imgRes.ok) {
        res.status(502).json({ error: `Failed to fetch image: ${imgRes.status}` });
        return;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.byteLength > 10 * 1024 * 1024) {
        res.status(413).json({ error: "Image exceeds 10 MB limit" });
        return;
      }
      imageArray = [...new Uint8Array(buf)];
    } catch (err) {
      res.status(502).json({
        error: `Failed to fetch image: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
  } else {
    res.status(400).json({ error: "imageUrl or imageBase64 is required" });
    return;
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "Describe this image in detail.";

  try {
    const result = await runModel<{ description?: string }>(model, {
      image: imageArray,
      prompt,
      max_tokens: 512,
    });
    res.json({
      description: result.result?.description ?? "",
      model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, model }, "cf-ai/image-to-text failed");
    res.status(502).json({ error: msg });
  }
});

export default router;
