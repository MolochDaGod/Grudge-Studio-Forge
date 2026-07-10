/**
 * AI Worker chat client.
 *
 * Wraps the /api/ai/chat SSE endpoint in a tool-aware loop:
 *   1. POST { messages, tools, system } and read the SSE stream.
 *   2. Surface text deltas to the UI in real time.
 *   3. When the assistant emits one or more tool_use blocks, execute each
 *      against the local editor (see aiTools.ts), append a single user
 *      message containing all the tool_results, then POST again.
 *   4. Stop when stop_reason !== "tool_use".
 *
 * SSE protocol (server → client):
 *   { type: "text_delta",  text }
 *   { type: "text_block",  text }            // final text block (transcript)
 *   { type: "tool_use",    id, name, input }
 *   { type: "stop",        stop_reason }
 *   { type: "error",       error }
 */
import { runTool, DESTRUCTIVE_TOOLS, type ToolDef } from "@/lib/aiTools";
import { recordAiToolCall } from "@/ai/aiAuditLog";
import {
  getProvider,
  findModel,
  type ModelOption,
} from "@/lib/ai/providers";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  /** String for text-only results; array for multimodal (text + image). */
  content: string | ToolResultContentBlock[];
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/** Browser-native confirmation. We keep this separate so it can be swapped
 *  for a richer in-panel modal later. The summary is intentionally short —
 *  the chip in the AI Worker panel still shows the full input JSON. */
function confirmDestructive(name: string, input: unknown): boolean {
  let summary: string;
  try {
    summary = JSON.stringify(input, null, 2);
    if (summary.length > 400) summary = summary.slice(0, 400) + "…";
  } catch {
    summary = String(input);
  }
  return window.confirm(
    `The AI Worker wants to run '${name}'.\n\n` +
      `This action mutates your scene/scripts and may be hard to undo.\n\n` +
      `Input:\n${summary}\n\nAllow?`,
  );
}

export interface RunHandlers {
  /** Called for every text delta (token-level streaming). */
  onTextDelta: (text: string) => void;
  /** Called immediately before each tool dispatch, after the destructive-op
   *  confirmation but before any state mutation. Lets the caller capture a
   *  pre-tool snapshot for atomic undo. */
  onBeforeTool?: (call: { id: string; name: string; input: unknown }) => void;
  /** Called once per tool call, with its execution result. */
  onTool: (call: { id: string; name: string; input: unknown; result: unknown }) => void;
  /** Called when a turn finishes (after tools run, before the next turn). */
  onTurnEnd: (assistantMsg: ChatMessage) => void;
  /** Called once for fatal errors. */
  onError: (err: string) => void;
  /** When set + signalled, the in-flight network request and any pending
   *  tool dispatches abort cleanly. The panel uses this to power the
   *  Interrupt button. */
  signal?: AbortSignal;
  /** Optional model selection. When omitted, the first entry of `MODELS`
   *  (Claude Sonnet 4.6 via the server proxy) is used — preserves the
   *  pre-provider-abstraction default. */
  model?: ModelOption;
}

/** Research (GitHub/docs) + multi-step scene builds need headroom beyond
 *  the old 15-turn cap. Cooldown still forces a clean wind-down. */
const MAX_TURNS = 18;

/** Turns at which the AI enters "cooldown" mode — the system prompt is
 *  augmented to instruct the model to wrap up, summarise changes, update
 *  game info, and run a consistency check against the current project
 *  state (README, scene data, AI tool registry). */
const COOLDOWN_TURN = 16;

const COOLDOWN_SYSTEM_SUFFIX = `

--- COOLDOWN PHASE ---
You are running low on remaining tool turns. Use this and the next turn to:
1. Finalise any in-progress changes — do NOT start new features or new GitHub/doc research.
2. Update the project's game info (scene name, entity counts, environment settings) via get_scene_summary so it reflects the current state.
3. Review your changes for consistency — verify names, positions, and references are correct by calling list_entities (and list_r2_storage if you imported assets).
4. Provide a concise summary of everything you changed this session.
Do NOT begin new multi-step tasks. Focus on verification and cleanup.`;

/** Sentinel error thrown internally when the caller aborts mid-stream. We
 *  swallow this in runConversation so the caller's onError isn't fired with
 *  a generic "AbortError" — a user-initiated cancel isn't a failure. */
class UserAbortError extends Error {
  constructor() {
    super("User aborted AI turn.");
    this.name = "UserAbortError";
  }
}

export async function runConversation(
  messages: ChatMessage[],
  tools: ToolDef[],
  system: string,
  handlers: RunHandlers,
): Promise<ChatMessage[]> {
  const transcript: ChatMessage[] = [...messages];
  const signal = handlers.signal;

  const model = handlers.model ?? findModel(null);
  const provider = getProvider(model.provider);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) return transcript;

    // Cooldown: augment the system prompt on turns 14+ so the AI
    // winds down gracefully instead of starting new work.
    const turnSystem =
      turn >= COOLDOWN_TURN ? system + COOLDOWN_SYSTEM_SUFFIX : system;

    const assistantBlocks: ContentBlock[] = [];
    let stopReason: string | null = null;
    let aborted = false;

    try {
      const events = provider.streamTurn({
        messages: transcript,
        tools,
        system: turnSystem,
        model: model.modelId,
        signal,
      });
      for await (const event of events) {
        if (signal?.aborted) break;
        if (event.type === "text_delta") {
          handlers.onTextDelta(event.text);
        } else if (event.type === "text_block") {
          assistantBlocks.push({ type: "text", text: event.text });
        } else if (event.type === "tool_use") {
          assistantBlocks.push({
            type: "tool_use",
            id: event.id,
            name: event.name,
            input: event.input ?? {},
          });
        } else if (event.type === "stop") {
          stopReason = event.stop_reason ?? "end_turn";
        } else if (event.type === "error") {
          handlers.onError(event.error);
          aborted = true;
        }
      }
    } catch (err) {
      if (err instanceof UserAbortError || signal?.aborted) return transcript;
      handlers.onError(err instanceof Error ? err.message : String(err));
      return transcript;
    }

    if (aborted) return transcript;
    if (signal?.aborted) return transcript;

    const assistantMsg: ChatMessage = { role: "assistant", content: assistantBlocks };
    transcript.push(assistantMsg);
    handlers.onTurnEnd(assistantMsg);

    const toolCalls = assistantBlocks.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (stopReason !== "tool_use" || toolCalls.length === 0) {
      return transcript;
    }

    // Execute every tool call, collect results into one user message
    // (Anthropic requires all tool_results in a single user turn). Destructive
    // tools require a one-shot human confirmation; if the user declines we
    // surface a structured error back to the model so it can react.
    const resultBlocks: ToolResultBlock[] = [];
    for (const call of toolCalls) {
      let result: Awaited<ReturnType<typeof runTool>>;
      if (signal?.aborted) {
        // User pressed Interrupt mid-batch. Skip the remaining tool calls
        // and return the cancelled-by-user marker so the model has a
        // structured signal if we ever resume.
        result = {
          ok: false,
          error: `Cancelled by user before '${call.name}' ran.`,
        };
      } else if (DESTRUCTIVE_TOOLS.has(call.name) && !confirmDestructive(call.name, call.input)) {
        result = {
          ok: false,
          error: `User declined to run destructive tool '${call.name}'.`,
        };
      } else {
        // Notify caller so it can snapshot store state immediately
        // before the mutation lands.
        try {
          handlers.onBeforeTool?.({ id: call.id, name: call.name, input: call.input });
        } catch {
          // never let a snapshotting bug abort the tool dispatch
        }
        result = await runTool(call.name, call.input);
      }
      // Record into the in-memory audit log first so `get_last_ai_changes`
      // sees this call even if a downstream onTool consumer throws.
      recordAiToolCall({ name: call.name, input: call.input, result });
      handlers.onTool({
        id: call.id,
        name: call.name,
        input: call.input,
        result,
      });
      // If a tool returned an `__image` payload (e.g. capture_viewport),
      // strip it from the textual content and attach it as a separate
      // image block so the model can actually see the screenshot on the
      // next turn (multimodal). Anthropic accepts a tool_result.content
      // array of text + image blocks.
      const image = extractToolImage(result);
      if (image) {
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: [
            { type: "text", text: JSON.stringify(image.scrubbed) },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.base64,
              },
            },
          ],
          is_error: !result.ok,
        });
      } else {
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        });
      }
    }

    transcript.push({ role: "user", content: resultBlocks });
  }

  handlers.onError(`Stopped after ${MAX_TURNS} turns (max tool-use loop reached).`);
  return transcript;
}

/** Pull the `__image` marker off a tool result (set by capture_viewport /
 *  polish_scene) so the multimodal payload can travel as a proper image
 *  content block instead of as inline base64 text. */
function extractToolImage(
  result: unknown,
): { mediaType: string; base64: string; scrubbed: unknown } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { data?: unknown };
  if (!r.data || typeof r.data !== "object") return null;
  const data = r.data as Record<string, unknown>;
  const img = data.__image as { mediaType?: unknown; base64?: unknown } | undefined;
  if (!img || typeof img.mediaType !== "string" || typeof img.base64 !== "string") {
    return null;
  }
  if (img.base64.length === 0) return null;
  // Don't ship the (huge) base64 inside the text block — give the model the
  // metadata only and let the image block carry the pixels.
  const { __image: _omit, ...scrubbedData } = data;
  void _omit;
  const scrubbed = { ...(r as object), data: scrubbedData };
  return { mediaType: img.mediaType, base64: img.base64, scrubbed };
}

// SSE parsing + transport now live in `lib/ai/providers/sse.ts` so each
// provider can adapt the same wire format. UserAbortError is retained for
// internal cancel signalling above.
