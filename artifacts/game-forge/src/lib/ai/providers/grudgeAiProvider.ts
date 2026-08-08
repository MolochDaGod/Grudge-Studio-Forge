/**
 * Grudge AI Legion provider — always-on fleet hub via same-origin free-ai proxy.
 *
 * Path: browser → /api/free-ai/chat?provider=grudge-ai → ai.grudge-studio.com/v1/chat
 * Auth: Grudge ID JWT (local session) or server GRUDGE_AI_KEY on free-ai worker.
 * Never put provider secrets in the SPA.
 */
import type { AIProvider, ProviderEvent, ProviderRequest } from "./types";
import { freeAiChatUrl } from "@/lib/forgeEnv";
import { getGrudgeBearerToken } from "@/lib/grudgeAuthBridge";

function messagesForLegion(
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

export const grudgeAiProvider: AIProvider = {
  id: "grudge-ai",
  label: "Grudge AI Legion",
  async *streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const jwt = getGrudgeBearerToken();
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    let role = "dev";
    try {
      const raw = localStorage.getItem("grudge.ai.userSettings.v1");
      if (raw) {
        const s = JSON.parse(raw) as { grudgeAiRole?: string };
        if (s.grudgeAiRole) role = s.grudgeAiRole;
      }
    } catch {
      /* */
    }
    // model id may be role name (dev|toolkit|auto)
    const modelOrRole = req.model || "auto";
    if (modelOrRole && modelOrRole !== "auto" && !modelOrRole.includes("/")) {
      role = modelOrRole;
    }

    const body = {
      provider: "grudge-ai",
      model: modelOrRole === "auto" ? "auto" : modelOrRole,
      role,
      messages: messagesForLegion(req.system, req.messages),
      tools: req.tools.length > 0 ? translateTools(req.tools) : undefined,
      max_tokens: req.maxTokens ?? 8192,
      stream: false,
    };

    let res: Response;
    try {
      res = await fetch(freeAiChatUrl("grudge-ai"), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      yield {
        type: "error",
        error: `Grudge AI unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      yield {
        type: "error",
        error:
          res.status === 401
            ? "Grudge AI: sign in with Grudge ID (or set GRUDGE_AI_KEY on free-ai worker)."
            : `Grudge AI HTTP ${res.status}: ${text.slice(0, 280)}`,
      };
      yield { type: "stop", stop_reason: "error" };
      return;
    }

    const ct = res.headers.get("content-type") || "";
    // Stream OpenAI SSE if free-ai streams; else parse JSON
    if (ct.includes("text/event-stream") && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
      try {
        while (true) {
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
            try {
              const j = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
                response?: string;
              };
              const d = j.choices?.[0]?.delta?.content;
              if (d) {
                full += d;
                yield { type: "text_delta", text: d };
              }
            } catch {
              /* skip */
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (full) yield { type: "text_block", text: full };
      yield { type: "stop", stop_reason: "end_turn" };
      return;
    }

    let data: {
      response?: string;
      content?: string;
      choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
      error?: string;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      yield { type: "error", error: "Grudge AI: invalid JSON" };
      yield { type: "stop", stop_reason: "error" };
      return;
    }
    if (data.error) {
      yield { type: "error", error: String(data.error) };
      yield { type: "stop", stop_reason: "error" };
      return;
    }
    const text =
      data.response ||
      data.content ||
      data.choices?.[0]?.message?.content ||
      "";
    if (text) {
      yield { type: "text_delta", text };
      yield { type: "text_block", text };
    }
    yield { type: "stop", stop_reason: "end_turn" };
  },
};
