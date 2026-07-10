/**
 * Puter provider — prefers browser-side `puter.ai.chat` (no server key),
 * falls back to `/api/ai/chat?provider=puter` with X-Puter-Token.
 *
 * Tools / messages / system prompt stay identical for the AI Worker loop.
 */
import type { AIProvider, ProviderEvent, ProviderRequest } from "./types";
import { readSSE } from "./sse";
import { useAuth } from "@/store/auth";
import { getPuter, loadPuterSdk, readAccessToken, type PuterSdk } from "@/lib/puterSdk";

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

function flattenUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    if (b.type === "tool_result") {
      const c = b.content;
      if (typeof c === "string") parts.push(`[tool_result] ${c}`);
      else if (Array.isArray(c)) {
        for (const x of c) {
          if (x && typeof x === "object" && (x as { type?: string }).type === "text") {
            parts.push(String((x as { text?: string }).text ?? ""));
          }
        }
      }
    }
  }
  return parts.join("\n");
}

/** Try browser Puter SDK AI (works when user is signed into Puter in-page). */
async function* streamViaBrowserPuter(
  req: ProviderRequest,
): AsyncIterable<ProviderEvent> {
  let sdk: PuterSdk;
  try {
    sdk = await loadPuterSdk();
  } catch (err) {
    yield {
      type: "error",
      error: `Puter SDK failed to load: ${err instanceof Error ? err.message : String(err)}`,
    };
    yield { type: "stop", stop_reason: "error" };
    return;
  }

  const ai = (sdk as PuterSdk & { ai?: { chat?: (...args: unknown[]) => Promise<unknown> } }).ai;
  if (!ai?.chat) {
    yield {
      type: "error",
      error:
        "This Puter SDK build has no ai.chat. Update Puter or use the server proxy after sign-in.",
    };
    yield { type: "stop", stop_reason: "error" };
    return;
  }

  // Flatten transcript to a single prompt + recent history for Puter browser API.
  const lines: string[] = [];
  if (req.system) lines.push(`System:\n${req.system}\n`);
  for (const m of req.messages) {
    const role = m.role === "assistant" ? "Assistant" : "User";
    lines.push(`${role}:\n${flattenUserText(m.content)}`);
  }
  // Nudge tool usage when tools are present
  if (req.tools?.length) {
    lines.push(
      `\nAvailable tools (name + purpose). Prefer calling tools via the server Puter route when you need structured tool_use; for browser chat, describe the tool plan as JSON blocks the editor can parse.`,
    );
    for (const t of req.tools.slice(0, 40)) {
      lines.push(`- ${t.name}: ${t.description.slice(0, 120)}`);
    }
  }
  const prompt = lines.join("\n\n");

  try {
    const raw = await ai.chat(prompt, {
      model: req.model ?? "claude-3-5-sonnet",
      stream: false,
    });
    let text = "";
    if (typeof raw === "string") text = raw;
    else if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      if (typeof o.message === "string") text = o.message;
      else if (typeof o.text === "string") text = o.text;
      else if (o.message && typeof o.message === "object") {
        text = String((o.message as { content?: string }).content ?? JSON.stringify(o.message));
      } else text = JSON.stringify(raw);
    } else text = String(raw ?? "");

    if (!text.trim()) {
      yield { type: "error", error: "Puter AI returned an empty response." };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    // Stream as one delta + block so the UI lights up immediately.
    yield { type: "text_delta", text };
    yield { type: "text_block", text };
    // Best-effort: parse ```tool_use style blocks the model may emit
    const toolRe =
      /```tool_use\s*([\s\S]*?)```/gi;
    let m: RegExpExecArray | null;
    let anyTool = false;
    while ((m = toolRe.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(m[1]!.trim()) as {
          name?: string;
          input?: Record<string, unknown>;
          id?: string;
        };
        if (parsed.name) {
          anyTool = true;
          yield {
            type: "tool_use",
            id: parsed.id ?? `puter_${Math.random().toString(36).slice(2, 10)}`,
            name: parsed.name,
            input: parsed.input ?? {},
          };
        }
      } catch {
        /* ignore malformed */
      }
    }
    yield { type: "stop", stop_reason: anyTool ? "tool_use" : "end_turn" };
  } catch (err) {
    yield {
      type: "error",
      error: `Puter browser AI failed: ${err instanceof Error ? err.message : String(err)}`,
    };
    yield { type: "stop", stop_reason: "error" };
  }
}

async function* streamViaServerPuter(
  req: ProviderRequest,
  token: string,
): AsyncIterable<ProviderEvent> {
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
}

export const puterProvider: AIProvider = {
  id: "puter",
  label: "Puter AI",
  async *streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    if (!useAuth.getState().isPuterSignedIn) {
      yield {
        type: "error",
        error:
          "Puter models require sign-in. Click 'Sign in with Puter' in the toolbar (or AI Worker banner), then retry.",
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    // Prefer server proxy when we have a token — full tool_use loop works.
    const token = await getPuterToken();
    if (token) {
      try {
        let sawError = false;
        let errMsg = "";
        for await (const ev of streamViaServerPuter(req, token)) {
          if (ev.type === "error") {
            sawError = true;
            errMsg = ev.error;
            // Fall through to browser puter instead of dying on server puter bugs
            break;
          }
          yield ev;
          if (ev.type === "stop") return;
        }
        if (sawError) {
          // fall through to browser
          console.warn("[puterProvider] server path failed, trying browser puter.ai.chat", errMsg);
        } else {
          return;
        }
      } catch (err) {
        console.warn("[puterProvider] server path threw", err);
      }
    }

    // Browser SDK path — always available after Puter sign-in.
    yield* streamViaBrowserPuter(req);
  },
};
