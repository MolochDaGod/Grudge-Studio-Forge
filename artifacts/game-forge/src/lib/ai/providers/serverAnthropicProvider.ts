/**
 * Default provider — POST /api/ai/chat (no provider qs param).
 *
 * The server proxies Anthropic via the Replit AI integration, streams
 * SSE events back, and we yield them through unchanged. This is the
 * historical path; nothing about the SSE shape changed when the Puter
 * provider was added.
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
      yield {
        type: "error",
        error: `AI chat HTTP ${res.status}: ${await res.text().catch(() => "")}`,
      };
      return;
    }
    yield* readSSE(res.body, req.signal);
  },
};
