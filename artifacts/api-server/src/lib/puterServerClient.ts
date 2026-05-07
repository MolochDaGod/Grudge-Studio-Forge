/**
 * Server-side Puter SDK shim.
 *
 * The browser SDK is a UI-heavy bundle we can't run in Node, but Puter's
 * REST surface is fully usable with a bearer token. This module exposes
 * just the slices the server needs:
 *   - `chat(token, request)` — wraps `puter.ai.chat`. Used by the
 *     `provider=puter` branch of `/api/ai/chat`.
 *   - `whoami(token)` — re-export of `puterAuth.verifyPuterToken` for
 *     callers (POST /api/puter/exchange) that want a single import.
 *
 * The chat call currently emits ONE final `text_block` rather than
 * incremental deltas because Puter's REST surface returns the whole
 * message at once. The client's SSE consumer is happy with that shape
 * — the UI just renders the text on arrival. Streaming can be added
 * later by switching to Puter's WebSocket variant.
 */
import { verifyPuterToken } from "./puterAuth";
import { logger } from "./logger";

export { verifyPuterToken } from "./puterAuth";

function puterApiBase(): string {
  return process.env.PUTER_API_BASE ?? "https://api.puter.com";
}

interface PuterChatRequest {
  /** Anthropic-shaped messages. Translated to Puter's `prompt + messages`
   *  shape inside this module. */
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  system?: string;
  model?: string;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  maxTokens?: number;
}

export interface PuterChatBlock {
  type: "text" | "tool_use";
  /** Present for text blocks. */
  text?: string;
  /** Present for tool_use blocks. */
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface PuterChatResult {
  blocks: PuterChatBlock[];
  stopReason: string;
}

/** Puter content block. Puter's chat surface accepts either a plain
 *  string OR an OpenAI-style content array of `{type:"text"|"image_url",...}`
 *  parts. We translate Anthropic-shaped images into `image_url` data URLs
 *  so screenshot tools (capture_viewport, polish_scene) survive the
 *  round-trip and the model can actually see what it just rendered. */
type PuterPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Translate an Anthropic content blob into Puter's content shape. Returns
 *  a plain string when no images are present (cheaper for text-only
 *  models) and the structured array otherwise. */
export function translateContentForPuter(content: unknown): string | PuterPart[] {
  const parts: PuterPart[] = [];
  let hasImage = false;

  const pushImage = (mediaType: string, base64: string) => {
    if (!base64) return;
    hasImage = true;
    parts.push({
      type: "image_url",
      image_url: { url: `data:${mediaType};base64,${base64}` },
    });
  };
  const pushText = (text: string) => {
    if (!text) return;
    parts.push({ type: "text", text });
  };

  const walk = (block: unknown): void => {
    if (typeof block === "string") {
      pushText(block);
      return;
    }
    if (!block || typeof block !== "object") return;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      pushText(b.text);
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      pushText(`[assistant called tool ${String(b.name)}]`);
    } else if (b.type === "tool_result") {
      const inner = b.content;
      if (typeof inner === "string") {
        pushText(inner);
      } else if (Array.isArray(inner)) {
        for (const part of inner) walk(part);
      }
    } else if (b.type === "image") {
      // Anthropic shape: { type:"image", source:{ type:"base64", media_type, data } }
      const src = b.source as
        | { type?: string; media_type?: string; data?: string }
        | undefined;
      if (src && typeof src.media_type === "string" && typeof src.data === "string") {
        pushImage(src.media_type, src.data);
      }
    } else if (b.type === "image_url" && b.image_url) {
      // Already in Puter shape — pass through.
      const u = (b.image_url as { url?: string }).url;
      if (typeof u === "string") {
        parts.push({ type: "image_url", image_url: { url: u } });
        hasImage = true;
      }
    }
  };

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) walk(block);
  } else {
    walk(content);
  }

  if (!hasImage) return parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  return parts;
}

/** Map Puter's chat response into our normalized block list. Puter's
 *  shape varies slightly across models (some return `{message:{content}}`,
 *  some `{text}`, some an array). We accept the common shapes. */
function normalize(raw: unknown): PuterChatResult {
  const blocks: PuterChatBlock[] = [];
  let stopReason = "end_turn";
  if (!raw || typeof raw !== "object") {
    return { blocks, stopReason: "error" };
  }
  const r = raw as Record<string, unknown>;
  const message = (r.message ?? r) as Record<string, unknown>;
  const content = message.content;
  if (typeof content === "string" && content.length > 0) {
    blocks.push({ type: "text", text: content });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") {
        blocks.push({ type: "text", text: p.text });
      } else if (p.type === "tool_use") {
        blocks.push({
          type: "tool_use",
          id: typeof p.id === "string" ? p.id : `tu_${blocks.length}`,
          name: typeof p.name === "string" ? p.name : "",
          input: (p.input as Record<string, unknown>) ?? {},
        });
        stopReason = "tool_use";
      }
    }
  } else if (typeof r.text === "string") {
    blocks.push({ type: "text", text: r.text });
  }
  // Puter sometimes returns an explicit `tool_calls` array on the message.
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : null;
  if (toolCalls) {
    for (const tc of toolCalls) {
      if (!tc || typeof tc !== "object") continue;
      const t = tc as Record<string, unknown>;
      const fn = (t.function ?? t) as Record<string, unknown>;
      const name = typeof fn.name === "string" ? fn.name : null;
      if (!name) continue;
      let input: Record<string, unknown> = {};
      const args = fn.arguments ?? fn.input;
      if (typeof args === "string") {
        try {
          input = JSON.parse(args) as Record<string, unknown>;
        } catch {
          input = {};
        }
      } else if (args && typeof args === "object") {
        input = args as Record<string, unknown>;
      }
      blocks.push({
        type: "tool_use",
        id: typeof t.id === "string" ? t.id : `tu_${blocks.length}`,
        name,
        input,
      });
      stopReason = "tool_use";
    }
  }
  if (typeof r.stop_reason === "string") stopReason = r.stop_reason;
  return { blocks, stopReason };
}

/**
 * Forward a single chat turn to Puter using the user's bearer token.
 *
 * The endpoint shape mirrors Puter's documented `puter.ai.chat` REST
 * call (POST /v2/ai/chat). Tools are forwarded in OpenAI/Anthropic
 * function-calling shape; Puter's gateway picks the right adapter for
 * the requested model.
 */
export async function puterChat(
  token: string,
  req: PuterChatRequest,
): Promise<PuterChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);

  const body = {
    model: req.model ?? "claude-3-5-sonnet",
    messages: req.messages.map((m) => ({
      role: m.role,
      content: translateContentForPuter(m.content),
    })),
    system: req.system,
    tools: req.tools,
    max_tokens: req.maxTokens,
    stream: false,
  };

  let res: Response;
  try {
    res = await fetch(`${puterApiBase()}/v2/ai/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `Puter AI request failed: ${(err as Error).message ?? String(err)}`,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, body: txt.slice(0, 500) },
      "puter chat upstream failed",
    );
    throw new Error(`Puter AI HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Puter AI returned non-JSON response");
  }
  return normalize(json);
}

/**
 * Verify a token + return a public-safe view. Used by
 * `POST /api/puter/exchange` so the client can confirm a token is real
 * before storing it. Distinct from `auth/puter/sync` which also
 * upserts the shared `users` row.
 */
export async function exchangePuterToken(
  token: string,
): Promise<{ uuid: string; username: string; email: string | null }> {
  const id = await verifyPuterToken(token);
  return { uuid: id.uuid, username: id.username, email: id.email };
}
