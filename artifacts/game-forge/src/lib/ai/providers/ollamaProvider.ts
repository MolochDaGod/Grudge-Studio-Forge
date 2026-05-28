/**
 * Ollama local AI provider — connects directly to the user's local
 * Ollama instance at http://localhost:11434.
 *
 * No server proxy needed — Ollama runs on the user's machine and the
 * browser talks to it directly. This enables fully offline AI.
 *
 * Wire format: Ollama streams newline-delimited JSON objects, each with
 * `{ message: { role, content, tool_calls? }, done }`. We translate
 * these into the same ProviderEvent shape the tool loop consumes.
 *
 * Tool calling: Ollama uses an OpenAI-compatible `tools` / `tool_calls`
 * format. We translate the Anthropic-shaped tool defs from the editor
 * into Ollama's format and parse tool_calls back into ProviderToolUse.
 */
import type { AIProvider, ProviderEvent, ProviderRequest } from "./types";

const OLLAMA_BASE = "http://localhost:11434";

/** Detect whether Ollama is reachable (cached for 30s). */
let _ollamaOk: boolean | null = null;
let _ollamaCheckedAt = 0;

export async function isOllamaAvailable(): Promise<boolean> {
  if (_ollamaOk !== null && Date.now() - _ollamaCheckedAt < 30_000) {
    return _ollamaOk;
  }
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    _ollamaOk = res.ok;
  } catch {
    _ollamaOk = false;
  }
  _ollamaCheckedAt = Date.now();
  return _ollamaOk;
}

/** List installed Ollama models. */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** Translate Anthropic-style tool defs → Ollama/OpenAI function format. */
function translateTools(
  tools: ProviderRequest["tools"],
): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/** Translate Anthropic-style messages → Ollama chat messages.
 *  Anthropic uses `content: ContentBlock[]`; Ollama wants `content: string`
 *  plus separate `tool_calls` array. We flatten text blocks and extract
 *  tool_result blocks into the format Ollama expects. */
function translateMessages(
  messages: ProviderRequest["messages"],
): Array<{ role: string; content: string; tool_calls?: unknown[] }> {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    if (!Array.isArray(m.content)) {
      return { role: m.role, content: JSON.stringify(m.content) };
    }
    // Flatten content blocks into a single string
    const textParts: string[] = [];
    for (const block of m.content as Array<{ type: string; text?: string; content?: unknown }>) {
      if (block.type === "text" && block.text) {
        textParts.push(block.text);
      } else if (block.type === "tool_result") {
        const resultContent =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
        textParts.push(`[Tool result]: ${resultContent}`);
      } else if (block.type === "tool_use") {
        // Skip — these are assistant tool calls, handled separately
      }
    }
    return { role: m.role, content: textParts.join("\n") || "(no content)" };
  });
}

export const ollamaProvider: AIProvider = {
  id: "ollama",
  label: "Ollama (Local)",
  async *streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const available = await isOllamaAvailable();
    if (!available) {
      yield {
        type: "error",
        error:
          "Ollama is not running. Start it with `ollama serve` or install from https://ollama.ai",
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    const body: Record<string, unknown> = {
      model: req.model ?? "llama3.2",
      messages: [
        { role: "system", content: req.system },
        ...translateMessages(req.messages),
      ],
      stream: true,
    };

    if (req.tools.length > 0) {
      body.tools = translateTools(req.tools);
    }

    let res: Response;
    try {
      res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      yield {
        type: "error",
        error: `Ollama connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      yield {
        type: "error",
        error: `Ollama HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    // Ollama streams newline-delimited JSON
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullText = "";
    let hasToolCalls = false;

    try {
      while (true) {
        if (req.signal?.aborted) return;
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let nlIdx: number;
        while ((nlIdx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nlIdx).trim();
          buf = buf.slice(nlIdx + 1);
          if (!line) continue;

          let chunk: {
            message?: {
              role?: string;
              content?: string;
              tool_calls?: Array<{
                function?: { name?: string; arguments?: Record<string, unknown> | string };
              }>;
            };
            done?: boolean;
          };
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }

          // Stream text deltas
          const delta = chunk.message?.content ?? "";
          if (delta) {
            fullText += delta;
            yield { type: "text_delta", text: delta };
          }

          // Tool calls (emitted on the final chunk)
          if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
            hasToolCalls = true;
            for (const tc of chunk.message.tool_calls) {
              const fn = tc.function;
              if (!fn?.name) continue;
              let input: Record<string, unknown> = {};
              if (typeof fn.arguments === "string") {
                try {
                  input = JSON.parse(fn.arguments);
                } catch {
                  input = { raw: fn.arguments };
                }
              } else if (fn.arguments && typeof fn.arguments === "object") {
                input = fn.arguments;
              }
              yield {
                type: "tool_use",
                id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: fn.name,
                input,
              };
            }
          }

          if (chunk.done) {
            // Emit the full text block for transcript bookkeeping
            if (fullText) {
              yield { type: "text_block", text: fullText };
            }
            yield {
              type: "stop",
              stop_reason: hasToolCalls ? "tool_use" : "end_turn",
            };
            return;
          }
        }
      }
    } finally {
      try {
        reader.cancel().catch(() => undefined);
      } catch {
        /* already closed */
      }
    }

    // Stream ended without a done:true — emit what we have
    if (fullText) {
      yield { type: "text_block", text: fullText };
    }
    yield { type: "stop", stop_reason: hasToolCalls ? "tool_use" : "end_turn" };
  },
};
