/**
 * Puter provider — same `/api/ai/chat` endpoint with `?provider=puter`
 * and an `X-Puter-Token` header carrying the user's Puter access token.
 *
 * The server forwards the request to `puter.ai.chat()` server-side
 * (Puter SDK supports Node) and re-emits the result as the same SSE
 * shape the client already understands (text_delta / text_block /
 * tool_use / stop / error). That keeps the client provider-agnostic.
 *
 * If the user isn't signed in with Puter we yield a structured error
 * immediately rather than firing a doomed request — avoids confusing
 * 401 noise in the UI.
 */
import type { AIProvider, ProviderEvent, ProviderRequest } from "./types";
import { readSSE } from "./sse";
import { useAuth } from "@/store/auth";
import { getPuter, loadPuterSdk, readAccessToken } from "@/lib/puterSdk";

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

async function getPuterToken(): Promise<string | null> {
  if (!useAuth.getState().isPuterSignedIn) return null;
  let sdk = getPuter();
  if (!sdk) {
    try {
      sdk = await loadPuterSdk();
    } catch {
      return null;
    }
  }
  return readAccessToken(sdk);
}

export const puterProvider: AIProvider = {
  id: "puter",
  label: "Puter AI",
  async *streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const token = await getPuterToken();
    if (!token) {
      yield {
        type: "error",
        error:
          "Puter models require sign-in. Click 'Sign in with Puter' in the toolbar, or pick a server-proxied model.",
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }
    const res = await fetch(apiUrl("ai/chat?provider=puter"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Puter-Token": token,
      },
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
        error: `Puter AI HTTP ${res.status}: ${await res.text().catch(() => "")}`,
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }
    yield* readSSE(res.body, req.signal);
  },
};
