/**
 * AI Worker chat panel — slide-out from the right edge of the editor.
 *
 * Stays open while you continue working in the viewport (it's a fixed
 * floating panel, NOT a modal Dialog). Streams responses token-by-token
 * and inlines every tool call the model makes so you can see exactly what
 * the AI is doing to your scene.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Send, X, Loader2, Wrench, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useEditor } from "@/store/editor";
import {
  runConversation,
  type ChatMessage,
  type ToolUseBlock,
} from "@/lib/aiClient";
import { TOOL_DEFS, buildSystemPrompt } from "@/lib/aiTools";

interface ToolEvent {
  id: string;
  name: string;
  input: unknown;
  result: { ok: boolean; data?: unknown; error?: string };
}

interface UIMessage {
  role: "user" | "assistant";
  /** Plain text shown in the bubble. Empty for pure tool-call turns. */
  text: string;
  /** Tool calls + their results (assistant turns only). */
  tools: ToolEvent[];
}

const SUGGESTIONS: string[] = [
  "Generate a small city map and drop Blake in it",
  "Add a red point light above the player",
  "Create a script that spins the selected entity",
  "Set the sky to a dusk gradient with warm sun",
];

export function AIWorkerPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const streamingTextRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content. ScrollArea wraps content in a viewport div;
  // we walk up to the nearest scrollable ancestor and pin it to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      let node: HTMLElement | null = el;
      while (node && node.scrollHeight <= node.clientHeight) {
        node = node.parentElement;
      }
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, [history, streaming]);

  // Focus the input when opening.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // The "live" assistant bubble while text is streaming in.
  const [liveText, setLiveText] = useState("");

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    if (!projectId) {
      pushLog("warn", "Open or create a project before chatting with the AI Worker.");
      return;
    }

    const userMsg: UIMessage = { role: "user", text: trimmed, tools: [] };
    setHistory((h) => [...h, userMsg]);
    setInput("");
    setStreaming(true);
    streamingTextRef.current = "";
    setLiveText("");

    // Convert UI history → Anthropic message format. We carry only the
    // user-visible text turns across calls (no tool results) — keeps the
    // payload small and the model can re-inspect the scene at any time
    // via get_scene_summary / list_entities. Each send() launches a fresh
    // tool-use loop so multi-step actions still chain within one request.
    const apiMessages: ChatMessage[] = [];
    for (const m of history) {
      if (!m.text) continue;
      apiMessages.push({
        role: m.role,
        content: [{ type: "text", text: m.text }],
      });
    }
    apiMessages.push({ role: "user", content: [{ type: "text", text: trimmed }] });

    const system = buildSystemPrompt();
    const turnTools: ToolEvent[] = [];
    let turnText = "";

    try {
      await runConversation(apiMessages, TOOL_DEFS, system, {
        onTextDelta: (t) => {
          streamingTextRef.current += t;
          setLiveText(streamingTextRef.current);
        },
        onTool: (call) => {
          turnTools.push(call as ToolEvent);
          // Echo significant tool calls into the editor console for traceability.
          const r = call.result as ToolEvent["result"];
          if (r?.ok) {
            pushLog("info", `AI · ${call.name} ok`);
          } else {
            pushLog("warn", `AI · ${call.name} failed: ${r?.error ?? "?"}`);
          }
        },
        onTurnEnd: (msg) => {
          // After each Anthropic turn, capture the (just-streamed) text
          // and reset the live buffer so the next turn streams fresh.
          const collected = msg.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("");
          if (collected) turnText = collected; // last non-empty text wins
          streamingTextRef.current = "";
          setLiveText("");
        },
        onError: (err) => {
          pushLog("error", `AI Worker: ${err}`);
        },
      });
    } catch (err) {
      pushLog("error", `AI Worker crashed: ${(err as Error).message}`);
    } finally {
      setStreaming(false);
      streamingTextRef.current = "";
      setLiveText("");
      // Final assistant bubble: any text the model produced + every tool it ran.
      setHistory((h) => [
        ...h,
        { role: "assistant", text: turnText, tools: turnTools },
      ]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const isEmpty = history.length === 0 && !streaming;

  return (
    <div
      className={cn(
        "fixed top-12 right-0 bottom-0 w-[400px] z-40 flex flex-col bg-sidebar border-l border-border shadow-2xl transition-transform duration-300",
        open ? "translate-x-0" : "translate-x-full",
      )}
      data-testid="panel-ai-worker"
    >
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-sidebar shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="font-heading text-[11px] uppercase tracking-[0.22em] brand-gold">
            AI Worker
          </span>
          {streaming && <Loader2 className="size-3 animate-spin text-primary" />}
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setHistory([])}
              title="Clear conversation"
              data-testid="button-ai-clear"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            data-testid="button-ai-close"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef} className="p-3 space-y-3">
          {isEmpty && (
            <div className="text-xs text-muted-foreground space-y-3 pt-4">
              <p>
                I can build scenes, generate maps, write game scripts, configure the
                environment — anything you can do in the editor, just ask.
              </p>
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  Try
                </div>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="block w-full text-left text-xs px-2.5 py-1.5 rounded-md border border-border hover-elevate"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          {streaming && liveText && (
            <MessageBubble
              msg={{ role: "assistant", text: liveText, tools: [] }}
              live
            />
          )}
          {streaming && !liveText && (
            <div className="text-[11px] text-muted-foreground italic flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" />
              Thinking…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-2 space-y-2 shrink-0">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            projectId
              ? "Ask the AI Worker… (Enter to send, Shift+Enter for newline)"
              : "Open a project first."
          }
          disabled={!projectId || streaming}
          rows={3}
          className="text-xs resize-none"
          data-testid="input-ai-message"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground font-mono">
            claude-sonnet-4-6
          </span>
          <Button
            size="sm"
            onClick={send}
            disabled={!projectId || streaming || !input.trim()}
            data-testid="button-ai-send"
          >
            {streaming ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="size-3.5 mr-1.5" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, live }: { msg: UIMessage; live?: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div
      className={cn(
        "rounded-md px-3 py-2 text-xs leading-relaxed border",
        isUser
          ? "bg-primary/10 border-primary/30 text-foreground"
          : "bg-card border-border text-foreground",
        live && "border-primary/50",
      )}
    >
      {msg.text && (
        <div className="whitespace-pre-wrap break-words">{msg.text}</div>
      )}
      {msg.tools.length > 0 && (
        <div className={cn("mt-2 space-y-1", !msg.text && "mt-0")}>
          {msg.tools.map((t, i) => (
            <ToolCallChip key={t.id || i} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallChip({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const ok = tool.result?.ok;
  return (
    <div
      className={cn(
        "rounded border text-[10.5px] font-mono",
        ok
          ? "border-accent/40 bg-accent/5"
          : "border-destructive/50 bg-destructive/10",
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover-elevate rounded"
      >
        {ok ? (
          <Wrench className="size-3 text-accent shrink-0" />
        ) : (
          <AlertTriangle className="size-3 text-destructive shrink-0" />
        )}
        <span className={cn("truncate", ok ? "text-accent" : "text-destructive")}>
          {tool.name}
        </span>
        <span className="text-muted-foreground/60 ml-auto">
          {ok ? "ok" : "err"}
        </span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 pt-1 border-t border-border/40 space-y-1">
          <div>
            <div className="text-muted-foreground text-[9px] uppercase tracking-wider mb-0.5">
              input
            </div>
            <pre className="whitespace-pre-wrap break-all text-foreground/90">
              {safeStringify(tool.input)}
            </pre>
          </div>
          <div>
            <div className="text-muted-foreground text-[9px] uppercase tracking-wider mb-0.5">
              {ok ? "result" : "error"}
            </div>
            <pre className="whitespace-pre-wrap break-all text-foreground/90">
              {ok ? safeStringify(tool.result.data) : tool.result.error ?? "(no detail)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
