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
  /** Called once per tool call, with its execution result. */
  onTool: (call: { id: string; name: string; input: unknown; result: unknown }) => void;
  /** Called when a turn finishes (after tools run, before the next turn). */
  onTurnEnd: (assistantMsg: ChatMessage) => void;
  /** Called once for fatal errors. */
  onError: (err: string) => void;
}

const MAX_TURNS = 8;

export async function runConversation(
  messages: ChatMessage[],
  tools: ToolDef[],
  system: string,
  handlers: RunHandlers,
): Promise<ChatMessage[]> {
  const transcript: ChatMessage[] = [...messages];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = await fetchChatStream(transcript, tools, system);
    if (!stream) return transcript;

    const assistantBlocks: ContentBlock[] = [];
    let stopReason: string | null = null;
    let aborted = false;

    try {
      await readSSE(stream, (event) => {
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
      handlers.onError(err instanceof Error ? err.message : String(err));
      return transcript;
    }

    if (aborted) return transcript;

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
      if (DESTRUCTIVE_TOOLS.has(call.name) && !confirmDestructive(call.name, call.input)) {
        result = {
          ok: false,
          error: `User declined to run destructive tool '${call.name}'.`,
        };
      } else {
        result = await runTool(call.name, call.input);
      }
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
): Promise<ReadableStream<Uint8Array> | null> {
  const res = await fetch(apiUrl("ai/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools, system }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI chat HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.body;
}

/** Minimal SSE parser — yields one parsed JSON event per `data: ...` line. */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
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
}
