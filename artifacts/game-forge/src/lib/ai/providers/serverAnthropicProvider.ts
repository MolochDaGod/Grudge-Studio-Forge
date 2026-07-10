/**
 * Default provider — POST /api/ai/chat (no provider qs param).
 *
 * The server proxies Anthropic via the Grudge API server, streams
 * SSE events back, and we yield them through unchanged.
 */
import type { AIProvider, ProviderEvent, ProviderRequest } from "./types";
import { readSSE } from "./sse";

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

export const serverAnthropicProvider: AIProvider = {
  id: "server-anthropic",
  label: "Anthropic (server proxy)",
  async *streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const res = await fetch(apiUrl("ai/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: req.messages,
        tools: req.tools,
        system: req.system,
        model: req.model,
        maxTokens: req.maxTokens,
      }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const auth =
        res.status === 401 ||
        /invalid x-api-key|authentication_error/i.test(body);
      yield {
        type: "error",
        error: auth
          ? "Server Anthropic key is missing/invalid. Switch the model picker to a Puter model (sign in) or a local Ollama model."
          : `AI chat HTTP ${res.status}: ${body.slice(0, 240)}`,
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }
    // Map upstream auth errors that still stream as 200 SSE.
    for await (const ev of readSSE(res.body, req.signal)) {
      if (ev.type === "error" && /invalid x-api-key|authentication_error|401/i.test(ev.error)) {
        yield {
          type: "error",
          error:
            "Server Anthropic key is invalid. Use a Puter model (sign in with Puter) or Ollama (local).",
        };
        yield { type: "stop", stop_reason: "error" };
        return;
      }
      yield ev;
    }
  },
};
