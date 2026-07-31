/**
 * Free OpenAI-compatible providers (Groq, OpenRouter, Gemini, Cerebras, …).
 *
 * Always proxies through same-origin `/api/free-ai/chat` so the browser
 * never hits third-party CORS walls. The proxy uses:
 *   - `X-Api-Key` header when the user pasted a BYOK key, else
 *   - server env secrets (GROQ_API_KEY, OPENROUTER_API_KEY, …).
 *
 * Streams OpenAI SSE → Forge ProviderEvent shape (text_delta / tool_use).
 */
import type { AIProvider, ProviderEvent, ProviderRequest } from "./types";
import {
  FREE_PROVIDERS,
  getStoredApiKey,
  type FreeProviderId,
} from "./freeApis";
import { freeAiChatUrl } from "@/lib/forgeEnv";

/** Same-origin free-ai worker proxy (avoids browser CORS). */
const proxyPath = (provider: string) => freeAiChatUrl(provider);

function translateTools(tools: ProviderRequest["tools"]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

function translateMessages(
  system: string,
  messages: ProviderRequest["messages"],
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) {
      out.push({ role: m.role, content: JSON.stringify(m.content) });
      continue;
    }
    const parts: string[] = [];
    for (const block of m.content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      } else if (block.type === "tool_result") {
        const c = block.content;
        parts.push(
          `[Tool result]: ${typeof c === "string" ? c : JSON.stringify(c)}`,
        );
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        parts.push(`[Called tool ${block.name}]`);
      }
    }
    out.push({ role: m.role, content: parts.join("\n") || "(empty)" });
  }
  return out;
}

async function* streamOpenAiSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let hasTools = false;
  const onAbort = () => {
    try {
      reader.cancel().catch(() => undefined);
    } catch {
      /* */
    }
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let json: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                id?: string;
                index?: number;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          error?: { message?: string };
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.error?.message) {
          yield { type: "error", error: json.error.message };
          yield { type: "stop", stop_reason: "error" };
          return;
        }

        const choice = json.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          fullText += delta.content;
          yield { type: "text_delta", text: delta.content };
        }

        // Accumulate tool_calls across chunks (OpenAI streams args piecemeal)
        if (delta?.tool_calls) {
          hasTools = true;
          for (const tc of delta.tool_calls) {
            // Emit complete tool only when name is present (first chunk)
            // Arguments may arrive later — we buffer via a module-level map
            const idx = tc.index ?? 0;
            const slot = ensureToolSlot(idx, tc.id);
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
        }

        if (choice?.finish_reason === "tool_calls" || choice?.finish_reason === "stop") {
          // flush tools
          for (const slot of flushToolSlots()) {
            if (!slot.name) continue;
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(slot.args || "{}") as Record<string, unknown>;
            } catch {
              input = { raw: slot.args };
            }
            hasTools = true;
            yield {
              type: "tool_use",
              id: slot.id,
              name: slot.name,
              input,
            };
          }
          if (fullText) yield { type: "text_block", text: fullText };
          yield {
            type: "stop",
            stop_reason: hasTools ? "tool_use" : "end_turn",
          };
          return;
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    clearToolSlots();
  }

  // Stream ended without finish_reason
  for (const slot of flushToolSlots()) {
    if (!slot.name) continue;
    hasTools = true;
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(slot.args || "{}") as Record<string, unknown>;
    } catch {
      input = { raw: slot.args };
    }
    yield { type: "tool_use", id: slot.id, name: slot.name, input };
  }
  if (fullText) yield { type: "text_block", text: fullText };
  yield { type: "stop", stop_reason: hasTools ? "tool_use" : "end_turn" };
}

// ── tool_call accumulation (per-turn) ────────────────────────────────
type ToolSlot = { id: string; name: string; args: string };
let _slots = new Map<number, ToolSlot>();

function ensureToolSlot(idx: number, id?: string): ToolSlot {
  let s = _slots.get(idx);
  if (!s) {
    s = {
      id: id ?? `free_${Date.now()}_${idx}`,
      name: "",
      args: "",
    };
    _slots.set(idx, s);
  } else if (id) {
    s.id = id;
  }
  return s;
}
function flushToolSlots(): ToolSlot[] {
  const arr = Array.from(_slots.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
  _slots = new Map();
  return arr;
}
function clearToolSlots() {
  _slots = new Map();
}

export function createFreeApiProvider(providerId: FreeProviderId): AIProvider {
  const cfg = FREE_PROVIDERS[providerId];
  return {
    id: providerId,
    label: `${cfg.label} (free)`,
    async *streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent> {
      clearToolSlots();
      const userKey = getStoredApiKey(providerId);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (userKey) headers["X-Api-Key"] = userKey;

      const body = {
        provider: providerId,
        model: req.model,
        messages: translateMessages(req.system, req.messages),
        tools: req.tools.length > 0 ? translateTools(req.tools) : undefined,
        max_tokens: req.maxTokens ?? 8192,
        stream: true,
      };

      let res: Response;
      try {
        res = await fetch(proxyPath(providerId), {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (err) {
        yield {
          type: "error",
          error: `${cfg.label} proxy unreachable: ${err instanceof Error ? err.message : String(err)}`,
        };
        yield { type: "stop", stop_reason: "error" };
        return;
      }

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        const needsKey =
          res.status === 401 ||
          res.status === 403 ||
          /api[_ ]?key|unauthorized|invalid.*key/i.test(text);
        yield {
          type: "error",
          error: needsKey
            ? `${cfg.label}: missing/invalid API key. Paste a free key in AI Worker → Free API keys (${cfg.signupUrl}).`
            : `${cfg.label} HTTP ${res.status}: ${text.slice(0, 280)}`,
        };
        yield { type: "stop", stop_reason: "error" };
        return;
      }

      // Proxy may stream raw OpenAI SSE or our own SSE wrapper.
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/event-stream") || ct.includes("application/x-ndjson") || true) {
        // Peek first bytes? Just use OpenAI SSE parser — our worker streams
        // passthrough OpenAI format with data: lines.
        yield* streamOpenAiSse(res.body, req.signal);
      }
    },
  };
}

export const groqProvider = createFreeApiProvider("groq");
export const openrouterProvider = createFreeApiProvider("openrouter");
export const geminiFreeProvider = createFreeApiProvider("gemini");
export const cerebrasProvider = createFreeApiProvider("cerebras");
export const deepseekProvider = createFreeApiProvider("deepseek");
export const togetherProvider = createFreeApiProvider("together");
