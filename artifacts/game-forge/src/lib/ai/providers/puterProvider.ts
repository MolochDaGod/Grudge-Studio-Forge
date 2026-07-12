/**
 * Puter provider — free browser AI via the user's Puter account.
 *
 * Order of attempts:
 *   1. Ensure Puter session (sign-in popup if needed — caller should already
 *      have triggered sign-in from a click handler).
 *   2. Browser `puter.ai.chat` (full tools when the SDK supports them).
 *   3. Server proxy `/api/ai/chat?provider=puter` with X-Puter-Token
 *      (structured tool_use SSE when REST is available).
 *
 * No Anthropic server key required.
 */
import type { AIProvider, ProviderEvent, ProviderRequest } from "./types";
import { readSSE } from "./sse";
import { useAuth } from "@/store/auth";
import {
  getPuter,
  loadPuterSdk,
  readAccessToken,
  type PuterSdk,
} from "@/lib/puterSdk";
import { signInWithPuter } from "@/lib/authBootstrap";

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

async function ensurePuterSession(): Promise<{
  sdk: PuterSdk;
  token: string | null;
}> {
  let sdk = getPuter();
  if (!sdk) sdk = await loadPuterSdk();

  let signedIn = false;
  try {
    signedIn = Boolean(await Promise.resolve(sdk.auth.isSignedIn()));
  } catch {
    signedIn = useAuth.getState().isPuterSignedIn;
  }

  if (signedIn) {
    // Hydrate Zustand from existing Puter session without re-opening popup.
    if (!useAuth.getState().isPuterSignedIn) {
      try {
        const u = await sdk.auth.getUser();
        if (u?.uuid && u?.username) {
          useAuth.getState().setSignedIn({
            id: u.uuid,
            name: u.username,
            puter: {
              uuid: u.uuid,
              username: u.username,
              email: typeof u.email === "string" ? u.email : null,
              isTemp: false,
            },
          });
        }
      } catch {
        /* ai.chat can still work with SDK session alone */
      }
    }
  } else if (!useAuth.getState().isPuterSignedIn) {
    // Opens Puter popup — must sit on a user-gesture stack (Send click).
    await signInWithPuter();
    sdk = getPuter() ?? (await loadPuterSdk());
  }

  const token = await readAccessToken(sdk);
  return { sdk, token };
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
          if (
            x &&
            typeof x === "object" &&
            (x as { type?: string }).type === "text"
          ) {
            parts.push(String((x as { text?: string }).text ?? ""));
          }
        }
      }
    }
  }
  return parts.join("\n");
}

/** OpenAI-style tools for Puter browser SDK. */
function toPuterTools(tools: ProviderRequest["tools"]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

/** Build messages array for puter.ai.chat structured mode. */
function toPuterMessages(req: ProviderRequest): Array<{
  role: string;
  content: string;
}> {
  const out: Array<{ role: string; content: string }> = [];
  if (req.system) {
    out.push({ role: "system", content: req.system });
  }
  for (const m of req.messages) {
    out.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: flattenUserText(m.content),
    });
  }
  return out;
}

function extractText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return String(raw ?? "");
  const o = raw as Record<string, unknown>;
  if (typeof o.message === "string") return o.message;
  if (typeof o.text === "string") return o.text;
  if (o.message && typeof o.message === "object") {
    const msg = o.message as Record<string, unknown>;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((p) =>
          p && typeof p === "object" && (p as { type?: string }).type === "text"
            ? String((p as { text?: string }).text ?? "")
            : "",
        )
        .join("");
    }
  }
  if (typeof o.content === "string") return o.content;
  return "";
}

type ToolUseOut = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

function extractToolUses(raw: unknown, text: string): ToolUseOut[] {
  const tools: ToolUseOut[] = [];
  const push = (name: string, input: Record<string, unknown>, id?: string) => {
    if (!name) return;
    tools.push({
      id: id ?? `puter_${Math.random().toString(36).slice(2, 10)}`,
      name,
      input: input ?? {},
    });
  };

  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const message = (o.message ?? o) as Record<string, unknown>;
    const content = message.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type === "tool_use" && typeof p.name === "string") {
          push(
            p.name,
            (p.input as Record<string, unknown>) ?? {},
            typeof p.id === "string" ? p.id : undefined,
          );
        }
      }
    }
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : Array.isArray(o.tool_calls)
        ? o.tool_calls
        : null;
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
        push(name, input, typeof t.id === "string" ? t.id : undefined);
      }
    }
  }

  // Fenced fallback the model may emit as plain text
  const toolRe = /```tool_use\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = toolRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]!.trim()) as {
        name?: string;
        input?: Record<string, unknown>;
        id?: string;
      };
      if (parsed.name) push(parsed.name, parsed.input ?? {}, parsed.id);
    } catch {
      /* ignore */
    }
  }

  return tools;
}

/** Browser puter.ai.chat — free models, no server Anthropic key. */
async function* streamViaBrowserPuter(
  req: ProviderRequest,
  sdk: PuterSdk,
): AsyncIterable<ProviderEvent> {
  const ai = (
    sdk as PuterSdk & {
      ai?: {
        chat?: (
          promptOrMessages: unknown,
          opts?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    }
  ).ai;
  if (!ai?.chat) {
    yield {
      type: "error",
      error:
        "Puter SDK has no ai.chat. Hard-refresh the page to reload js.puter.com/v2/.",
    };
    yield { type: "stop", stop_reason: "error" };
    return;
  }

  const model = req.model ?? "claude-3-5-sonnet";
  const messages = toPuterMessages(req);
  const tools =
    req.tools?.length > 0 ? toPuterTools(req.tools) : undefined;

  try {
    let raw: unknown;
    // Prefer structured messages + tools (agentic loop).
    try {
      raw = await ai.chat(messages, {
        model,
        stream: false,
        ...(tools ? { tools } : {}),
      });
    } catch {
      // Older SDK: single-string prompt
      const lines = messages.map((m) => `${m.role}:\n${m.content}`);
      if (tools?.length) {
        lines.push(
          "\nWhen you need to call a tool, respond with a fenced block:\n```tool_use\n{\"name\":\"tool_name\",\"input\":{...}}\n```",
        );
        for (const t of tools.slice(0, 40)) {
          lines.push(
            `- ${t.function.name}: ${String(t.function.description).slice(0, 120)}`,
          );
        }
      }
      raw = await ai.chat(lines.join("\n\n"), { model, stream: false });
    }

    const text = extractText(raw);
    const toolUses = extractToolUses(raw, text);

    if (!text.trim() && toolUses.length === 0) {
      yield { type: "error", error: "Puter AI returned an empty response." };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    if (text.trim()) {
      yield { type: "text_delta", text };
      yield { type: "text_block", text };
    }
    for (const tu of toolUses) {
      yield {
        type: "tool_use",
        id: tu.id,
        name: tu.name,
        input: tu.input,
      };
    }
    yield {
      type: "stop",
      stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
    };
  } catch (err) {
    yield {
      type: "error",
      error: `Puter AI failed: ${err instanceof Error ? err.message : String(err)}`,
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
  label: "Puter AI (free)",
  async *streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    let sdk: PuterSdk;
    let token: string | null = null;
    try {
      const session = await ensurePuterSession();
      sdk = session.sdk;
      token = session.token;
    } catch (err) {
      yield {
        type: "error",
        error:
          err instanceof Error
            ? err.message
            : "Puter sign-in required for free AI. Click Sign in with Puter, then retry.",
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    // Prefer browser Puter first — uses the user's free Puter AI quota,
    // never the dead server Anthropic key.
    let browserFailed = false;
    let browserErr = "";
    for await (const ev of streamViaBrowserPuter(req, sdk)) {
      if (ev.type === "error") {
        browserFailed = true;
        browserErr = ev.error;
        break;
      }
      yield ev;
      if (ev.type === "stop") return;
    }

    if (browserFailed && token) {
      console.warn(
        "[puterProvider] browser path failed, trying server Puter proxy",
        browserErr,
      );
      for await (const ev of streamViaServerPuter(req, token)) {
        yield ev;
      }
      return;
    }

    if (browserFailed) {
      yield {
        type: "error",
        error:
          browserErr ||
          "Puter AI failed. Sign in with Puter and try again.",
      };
      yield { type: "stop", stop_reason: "error" };
    }
  },
};
