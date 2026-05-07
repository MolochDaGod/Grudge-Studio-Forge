/**
 * AI Worker chat endpoint.
 *
 * The actual editor tools live on the CLIENT (only the browser has the live
 * Zustand store, R3F scene, etc.). This server is a thin SSE proxy:
 *
 *   1. Client sends { messages, tools, system } in Anthropic message format.
 *   2. We forward to Anthropic, stream `text_delta` events to the client as
 *      they arrive.
 *   3. After the stream ends we read the final assembled message and emit
 *      one `tool_use` event per tool block (already JSON-parsed).
 *   4. Client executes the tools against the editor, appends a `tool_result`
 *      user message, and POSTs again. The loop terminates when the model
 *      returns no tool_use (stop_reason "end_turn").
 *
 * Tool *definitions* (JSON schemas) are owned by the client and shipped with
 * every request, so adding a new editor capability never requires touching
 * the server. */
import { Router, type IRouter } from "express";
import { anthropic } from "../lib/anthropicClient";
import { logger } from "../lib/logger";
import { puterChat } from "../lib/puterServerClient";

const router: IRouter = Router();

type AnyMessage = {
  role: "user" | "assistant";
  content: unknown;
};

type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

interface ChatBody {
  messages: AnyMessage[];
  tools?: ToolDef[];
  system?: string;
  model?: string;
  maxTokens?: number;
}

// Allowlist what callers can ask for so a third-party who finds the unauth
// endpoint can't pin us to an expensive model or extreme token budget.
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]);
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS_CAP = 8192;
const MAX_MESSAGES = 64;

// Simple per-IP sliding-window rate limiter. The endpoint proxies a paid
// upstream so we cap throughput (not just request count) to keep abuse cheap.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
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
  // Opportunistic cleanup so the map can't grow forever.
  if (ipHits.size > 1000) {
    for (const [k, v] of ipHits) {
      if (v.every((t) => now - t > RATE_WINDOW_MS)) ipHits.delete(k);
    }
  }
  return false;
}

router.post("/ai/chat", async (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded — try again shortly." });
    return;
  }

  const body = req.body as Partial<ChatBody>;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "Missing 'messages' (non-empty array)" });
    return;
  }
  if (body.messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES})` });
    return;
  }

  // Clamp model + tokens regardless of what the client sent.
  const requestedModel = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const maxTokens = Math.max(
    256,
    Math.min(MAX_TOKENS_CAP, Number(body.maxTokens) || 4096),
  );

  // SSE headers — keep the connection alive while we stream.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Provider switch: `?provider=puter` proxies through the user's Puter
  // session instead of the server's Anthropic key. Tools / messages /
  // system prompt stay identical — `puterServerClient` translates as
  // needed and re-emits the same SSE event shape.
  const provider =
    typeof req.query.provider === "string" ? req.query.provider : "anthropic";
  if (provider === "puter") {
    const token = req.header("x-puter-token");
    if (!token) {
      send({ type: "error", error: "Missing X-Puter-Token header." });
      send({ type: "stop", stop_reason: "error" });
      res.end();
      return;
    }
    try {
      const result = await puterChat(token, {
        messages: body.messages,
        system: body.system,
        model: typeof body.model === "string" ? body.model : undefined,
        tools: body.tools,
        maxTokens,
      });
      for (const block of result.blocks) {
        if (block.type === "text" && block.text) {
          // Puter REST returns whole-message; surface as one delta + a final
          // text_block so the UI both renders text and the transcript can
          // reconstruct the assistant message.
          send({ type: "text_delta", text: block.text });
          send({ type: "text_block", text: block.text });
        } else if (block.type === "tool_use") {
          send({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input ?? {},
          });
        }
      }
      send({ type: "stop", stop_reason: result.stopReason });
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, provider: "puter" }, "ai/chat puter forward failed");
      try {
        send({ type: "error", error: message });
        send({ type: "stop", stop_reason: "error" });
        res.end();
      } catch {
        /* socket already closed */
      }
    }
    return;
  }

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      system: body.system,
      tools: body.tools as never,
      messages: body.messages as never,
    });

    for await (const event of stream) {
      // Forward text deltas in real time so the chat UI feels responsive.
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        send({ type: "text_delta", text: event.delta.text });
      }
    }

    const final = await stream.finalMessage();

    // Emit each text + tool_use block once the message is fully assembled.
    // Text was already streamed; we re-emit a `text` block (with the same
    // text) so the client can rebuild a structured assistant message to send
    // back next turn. Re-emission is harmless — the UI ignores the second
    // copy and uses it only for transcript bookkeeping.
    for (const block of final.content) {
      if (block.type === "tool_use") {
        send({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        });
      } else if (block.type === "text") {
        send({ type: "text_block", text: block.text });
      }
    }

    send({ type: "stop", stop_reason: final.stop_reason });
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "ai/chat stream failed");
    // The client may have already received text_delta events — we still send
    // a structured error so the UI can surface it instead of hanging.
    try {
      send({ type: "error", error: message });
      res.end();
    } catch {
      // socket already closed
    }
  }
});

export default router;
