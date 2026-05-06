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

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

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
}

const MAX_TURNS = 8;

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

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) return transcript;
    let stream: ReadableStream<Uint8Array> | null;
    try {
      stream = await fetchChatStream(transcript, tools, system, signal);
    } catch (err) {
      if (signal?.aborted) return transcript;
      handlers.onError(err instanceof Error ? err.message : String(err));
      return transcript;
    }
    if (!stream) return transcript;

    const assistantBlocks: ContentBlock[] = [];
    let stopReason: string | null = null;
    let aborted = false;

    try {
      await readSSE(stream, signal, (event) => {
        if (event.type === "text_delta") {
          handlers.onTextDelta(event.text as string);
        } else if (event.type === "text_block") {
          assistantBlocks.push({ type: "text", text: event.text as string });
        } else if (event.type === "tool_use") {
          assistantBlocks.push({
            type: "tool_use",
            id: event.id as string,
            name: event.name as string,
            input: (event.input as Record<string, unknown>) ?? {},
          });
        } else if (event.type === "stop") {
          stopReason = (event.stop_reason as string) ?? "end_turn";
        } else if (event.type === "error") {
          handlers.onError(String(event.error));
          aborted = true;
        }
      });
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
      resultBlocks.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }

    transcript.push({ role: "user", content: resultBlocks });
  }

  handlers.onError(`Stopped after ${MAX_TURNS} turns (max tool-use loop reached).`);
  return transcript;
}

async function fetchChatStream(
  messages: ChatMessage[],
  tools: ToolDef[],
  system: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  const res = await fetch(apiUrl("ai/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools, system }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI chat HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.body;
}

/** Minimal SSE parser — yields one parsed JSON event per `data: ...` line.
 *  When `signal` is aborted mid-stream we cancel the underlying reader and
 *  throw `UserAbortError`, which `runConversation` swallows so the panel
 *  doesn't surface the user's own cancel as a fatal error. */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const onAbort = () => {
    try { reader.cancel().catch(() => undefined); } catch { /* already closed */ }
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      throw new UserAbortError();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const decoder = new TextDecoder();
  let buf = "";
  try {
  while (true) {
    if (signal?.aborted) throw new UserAbortError();
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    // Each event ends with \n\n
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try {
          onEvent(JSON.parse(json));
        } catch {
          // skip malformed event
        }
      }
    }
  }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
