/**
 * Orchestrated conversation: intent → packs → route → runConversation with failover.
 */
import {
  runConversation,
  type ChatMessage,
  type RunHandlers,
} from "@/lib/aiClient";
import { TOOL_DEFS, buildSystemPrompt, type ToolDef } from "@/lib/aiTools";
import type { ModelOption } from "@/lib/ai/providers";
import {
  classifyIntent,
  roleForIntent,
  type ForgeIntent,
} from "./intent";
import {
  packsForIntent,
  renderPacks,
  toolNameAllowlist,
} from "./packs";
import {
  buildFailoverChain,
  type RoutingProbe,
  statusLabel,
} from "./routing";

export type OrchestratorResult = {
  intent: ForgeIntent;
  model: ModelOption;
  status: string;
  messages: ChatMessage[];
  usedFailover: boolean;
  attempts: Array<{ modelId: string; error?: string }>;
};

function filterTools(intent: ForgeIntent): ToolDef[] {
  const allow = toolNameAllowlist(intent);
  if (!allow) return TOOL_DEFS;
  const set = new Set(allow);
  return TOOL_DEFS.filter((t) => set.has(t.name));
}

function augmentSystem(intent: ForgeIntent, base: string): string {
  const packs = packsForIntent(intent);
  const packBlock = renderPacks(packs);
  return [
    base,
    "",
    "--- ORCHESTRATOR ---",
    `Active intent: ${intent}`,
    "You are the best-available Forge AI agent. Prefer tools over guesses.",
    "Start complex work with a short <plan>…</plan> checklist when multi-step.",
    "",
    packBlock,
  ].join("\n");
}

function isRetryableProviderError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("429") ||
    m.includes("rate") ||
    m.includes("quota") ||
    m.includes("api key") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("not configured") ||
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("econnrefused") ||
    m.includes("timeout") ||
    m.includes("503") ||
    m.includes("502") ||
    m.includes("overloaded")
  );
}

/**
 * Run one user turn with automatic provider failover.
 */
export async function runOrchestratedConversation(
  messages: ChatMessage[],
  opts: {
    userText: string;
    intentOverride?: ForgeIntent | null;
    probe: RoutingProbe;
    handlers: RunHandlers;
    /** Called when the active model changes (failover). */
    onRoute?: (info: { model: ModelOption; status: string; intent: ForgeIntent }) => void;
  },
): Promise<OrchestratorResult> {
  const intent = classifyIntent(opts.userText, opts.intentOverride);
  const role = roleForIntent(intent);
  const chain = buildFailoverChain(role, opts.probe);
  const tools = filterTools(intent);
  const system = augmentSystem(intent, buildSystemPrompt());

  const attempts: Array<{ modelId: string; error?: string }> = [];
  let usedFailover = false;
  let lastError = "";

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]!;
    if (i > 0) usedFailover = true;

    const status = statusLabel(model, opts.probe);
    opts.onRoute?.({ model, status, intent });

    let turnError: string | null = null;
    const wrapped: RunHandlers = {
      ...opts.handlers,
      model,
      onError: (err) => {
        turnError = err;
        // Defer UI onError until chain exhausted if retryable
        if (!isRetryableProviderError(err) || i === chain.length - 1) {
          opts.handlers.onError(err);
        }
      },
    };

    try {
      const out = await runConversation(messages, tools, system, wrapped);
      if (turnError && isRetryableProviderError(turnError)) {
        attempts.push({ modelId: model.id, error: turnError });
        lastError = turnError;
        continue;
      }
      attempts.push({ modelId: model.id });
      return {
        intent,
        model,
        status,
        messages: out,
        usedFailover,
        attempts,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ modelId: model.id, error: msg });
      lastError = msg;
      if (!isRetryableProviderError(msg) || i === chain.length - 1) {
        opts.handlers.onError(msg);
        return {
          intent,
          model,
          status,
          messages,
          usedFailover,
          attempts,
        };
      }
    }
  }

  opts.handlers.onError(
    lastError || "No AI provider available. Open ⚙ Routing for BYOK or start Ollama.",
  );
  const fallback = chain[0]!;
  return {
    intent,
    model: fallback,
    status: statusLabel(fallback, opts.probe),
    messages,
    usedFailover: true,
    attempts,
  };
}

export { classifyIntent, intentLabel } from "./intent";
export type { ForgeIntent } from "./intent";
export { probeRouting, pickBestModel, statusLabel } from "./routing";
export type { RoutingProbe } from "./routing";
