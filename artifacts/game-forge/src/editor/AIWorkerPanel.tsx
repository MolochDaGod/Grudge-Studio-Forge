/**
 * AI Worker chat panel — slide-out from the right edge of the editor.
 *
 * Stays open while you continue working in the viewport (it's a fixed
 * floating panel, NOT a modal Dialog). Streams responses token-by-token
 * and inlines every tool call the model makes so you can see exactly what
 * the AI is doing to your scene.
 *
 * Each AI response forms a `turn` (see ai/aiTurn.ts) carrying the model's
 * stated plan, every tool call, and the suggested follow-ups. Mutating
 * tool calls are wrapped in per-tool sceneData snapshots; at the end of
 * the turn we build a single composite Command (`makeAITurnCommand`) and
 * push it onto the editor's existing CommandStack — so "Undo last AI
 * turn" replays through the same undo system human edits use, atomically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  X,
  Loader2,
  Wrench,
  AlertTriangle,
  Trash2,
  Undo2,
  Square,
  Check,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AIIcon3D } from "@/editor/AIIcon3D";
import { useEditor } from "@/store/editor";
import { useToast } from "@/hooks/use-toast";
import { runConversation, type ChatMessage } from "@/lib/aiClient";
import { TOOL_DEFS, buildSystemPrompt } from "@/lib/aiTools";
import {
  MODELS,
  DEFAULT_MODEL_ID,
  findModel,
  type ModelOption,
} from "@/lib/ai/providers";
import { useAuth } from "@/store/auth";
import { signInWithPuter } from "@/lib/authBootstrap";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isOllamaAvailable } from "@/lib/ai/providers/ollamaProvider";
import { MUTATING_TOOLS } from "@/ai/aiAuditLog";
import {
  countCompletedSteps,
  extractEntityIdsFromTool,
  makeAITurnCommand,
  parseNextActions,
  parsePlan,
  stripProtocolTags,
  type AIToolEvent,
  type AITurn,
  type AITurnStep,
} from "@/ai/aiTurn";
import type { SceneData } from "@/scene/types";

type HistoryEntry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "ai"; turn: AITurn };

const SUGGESTIONS: string[] = [
  "Generate a small city map and drop Blake in it",
  "Add a red point light above the player",
  "Create a script that spins the selected entity",
  "Set the sky to a dusk gradient with warm sun",
];

const MAX_PERSISTED_ENTRIES = 100;
const STORAGE_PREFIX = "gameforge.aiWorker.history.v2.";

function storageKey(projectId: number | string | null | undefined): string | null {
  return projectId != null ? STORAGE_PREFIX + String(projectId) : null;
}

const newId = () => Math.random().toString(36).slice(2, 10);

function loadHistory(projectId: number | string | null | undefined): HistoryEntry[] {
  const key = storageKey(projectId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === "object" && (e.kind === "user" || e.kind === "ai"))
      .map((e): HistoryEntry => {
        if (e.kind === "user") {
          return {
            id: typeof e.id === "string" ? e.id : newId(),
            kind: "user",
            text: typeof e.text === "string" ? e.text : "",
          };
        }
        const t = (e.turn ?? {}) as Partial<AITurn>;
        return {
          id: typeof e.id === "string" ? e.id : newId(),
          kind: "ai",
          turn: {
            id: typeof t.id === "string" ? t.id : newId(),
            text: typeof t.text === "string" ? t.text : "",
            plan: Array.isArray(t.plan) ? (t.plan as AITurn["plan"]) : [],
            nextActions: Array.isArray(t.nextActions)
              ? (t.nextActions as string[]).filter((s) => typeof s === "string")
              : [],
            tools: Array.isArray(t.tools) ? (t.tools as AIToolEvent[]) : [],
            // Composite commands aren't serializable — undo is in-session only.
            hasUndoCommand: false,
            cancelled: !!t.cancelled,
            error: typeof t.error === "string" ? t.error : undefined,
          },
        };
      });
  } catch {
    return [];
  }
}

function saveHistory(projectId: number | string | null | undefined, history: HistoryEntry[]): void {
  const key = storageKey(projectId);
  if (!key) return;
  try {
    // Drop the in-session undo flag from the persisted copy — the underlying
    // command doesn't survive reload so it would be misleading on rehydrate.
    const slim = history.map((e) =>
      e.kind === "ai" ? { ...e, turn: { ...e.turn, hasUndoCommand: false } } : e,
    );
    const trimmed =
      slim.length > MAX_PERSISTED_ENTRIES
        ? slim.slice(slim.length - MAX_PERSISTED_ENTRIES)
        : slim;
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // QuotaExceeded etc. — silently drop persistence rather than crash the UI.
  }
}

export function AIWorkerPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const { toast } = useToast();
  const isPuterSignedIn = useAuth((s) => s.isPuterSignedIn);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ollamaOk, setOllamaOk] = useState(false);
  const [aiStatusHint, setAiStatusHint] = useState<string | null>(null);
  // Per-project model selection: each project remembers which model it
  // was last using. Falls back to the global default when the project
  // hasn't picked one yet (or in pre-project state).
  const modelStorageKey = projectId
    ? `grudge.ai.model:${projectId}`
    : "grudge.ai.model";
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(modelStorageKey) ||
        localStorage.getItem("grudge.ai.model") ||
        DEFAULT_MODEL_ID
      );
    } catch {
      return DEFAULT_MODEL_ID;
    }
  });
  // When the open project changes, re-hydrate the picker from that
  // project's stored preference.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(modelStorageKey);
      if (stored) setSelectedModelId(stored);
    } catch {
      /* ignore */
    }
  }, [modelStorageKey]);
  const selectedModel = useMemo(() => findModel(selectedModelId), [selectedModelId]);
  // Stable ref so the in-flight `runConversation` can read the latest pick
  // without resubscribing — model is captured at turn-start, not mid-stream.
  const selectedModelRef = useRef<ModelOption>(selectedModel);
  useEffect(() => {
    selectedModelRef.current = selectedModel;
    try {
      localStorage.setItem(modelStorageKey, selectedModelId);
    } catch {
      /* private mode — non-fatal */
    }
  }, [selectedModel, selectedModelId, modelStorageKey]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    setHistory(loadHistory(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    if (streaming) return;
    saveHistory(projectId, history);
  }, [projectId, history, streaming]);

  const clearHistory = () => {
    setHistory([]);
    const key = storageKey(projectId);
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  };

  // Auto-scroll on new content.
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

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Live streaming-bubble state.
  const [liveTick, setLiveTick] = useState(0);
  const liveTextRef = useRef("");
  const livePlanRef = useRef<AITurn["plan"]>([]);
  const liveToolsRef = useRef<AIToolEvent[]>([]);
  const bumpLive = () => setLiveTick((t) => t + 1);

  // Probe local Ollama + server AI status when panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const ok = await isOllamaAvailable();
      if (!cancelled) setOllamaOk(ok);
      try {
        const res = await fetch("/api/ai/status", { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const j = (await res.json()) as { anthropic?: boolean; hint?: string };
          if (!cancelled && !j.anthropic && j.hint) setAiStatusHint(j.hint);
          else if (!cancelled && j.anthropic) setAiStatusHint(null);
        }
      } catch {
        if (!cancelled) {
          setAiStatusHint(
            "AI status endpoint unreachable — Puter (sign-in) or local Ollama still work from the browser.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const interrupt = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    pushLog("info", "AI Worker: cancelled by user.");
    toast({
      title: "AI Worker stopped",
      description: "The model was interrupted. Any tool calls already made will stay in your scene — use Undo last AI turn to roll them back.",
    });
  };

  const send = async (override?: string) => {
    const trimmed = (override ?? input).trim();
    if (!trimmed || streaming) return;
    if (!projectId) {
      pushLog("warn", "Open or create a project before chatting with the AI Worker.");
      return;
    }

    const requestProjectId = projectId;
    const turnId = newId();
    const userEntry: HistoryEntry = { id: newId(), kind: "user", text: trimmed };
    setHistory((h) => [...h, userEntry]);
    setInput("");
    setStreaming(true);
    liveTextRef.current = "";
    livePlanRef.current = [];
    liveToolsRef.current = [];
    bumpLive();

    const controller = new AbortController();
    abortRef.current = controller;

    // Plan-locking: capture the plan from the FIRST assistant message that
    // contains `</plan>`. After that, ignore later text — Anthropic's
    // tool-use loop usually emits the plan in turn 1 and a summary +
    // <next_actions> in the final turn, so re-parsing accumulated text
    // can lose the original plan once it scrolls out of the buffer.
    let lockedPlan: AITurn["plan"] = [];

    // Per-tool snapshot tracking for atomic undo via the editor's
    // CommandStack. We push one composite Command at end of turn.
    const turnSteps: AITurnStep[] = [];
    let pendingPrev: SceneData | null = null;

    const cloneScene = (): SceneData =>
      JSON.parse(JSON.stringify(useEditor.getState().sceneData));

    const apiMessages: ChatMessage[] = [];
    for (const m of history) {
      if (m.kind === "user") {
        if (!m.text) continue;
        apiMessages.push({ role: "user", content: [{ type: "text", text: m.text }] });
      } else {
        const t = m.turn.text;
        if (!t) continue;
        apiMessages.push({ role: "assistant", content: [{ type: "text", text: t }] });
      }
    }
    apiMessages.push({ role: "user", content: [{ type: "text", text: trimmed }] });

    const system = buildSystemPrompt();
    const turnTools: AIToolEvent[] = [];
    let turnText = "";
    let turnError: string | undefined;

    try {
      await runConversation(apiMessages, TOOL_DEFS, system, {
        model: selectedModelRef.current,
        onTextDelta: (t) => {
          liveTextRef.current += t;
          // Lock the plan in as soon as the closing tag streams in. Once
          // locked, never recompute — later text rounds shouldn't move it.
          if (lockedPlan.length === 0 && liveTextRef.current.includes("</plan>")) {
            const parsed = parsePlan(liveTextRef.current);
            if (parsed.length > 0) {
              lockedPlan = parsed;
              livePlanRef.current = parsed;
            }
          }
          bumpLive();
        },
        onBeforeTool: (call) => {
          // Only mutating tools contribute to undo. For read-only tools
          // we still skip snapshotting to keep undo focused on real edits.
          if (MUTATING_TOOLS.has(call.name)) {
            pendingPrev = cloneScene();
          } else {
            pendingPrev = null;
          }
        },
        onTool: (call) => {
          const ev = call as AIToolEvent;
          turnTools.push(ev);
          liveToolsRef.current = [...liveToolsRef.current, ev];
          if (pendingPrev && ev.result?.ok && MUTATING_TOOLS.has(ev.name)) {
            const next = cloneScene();
            turnSteps.push({ name: ev.name, prev: pendingPrev, next });
          }
          pendingPrev = null;
          if (ev.result?.ok) {
            pushLog("info", `AI · ${ev.name} ok`);
          } else {
            pushLog("warn", `AI · ${ev.name} failed: ${ev.result?.error ?? "?"}`);
          }
          bumpLive();
        },
        onTurnEnd: (msg) => {
          const collected = msg.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("");
          // Accumulate text across tool-loop turns so we can pick up
          // <next_actions> from whichever turn the model placed it in.
          if (collected) turnText = turnText ? `${turnText}\n${collected}` : collected;
          // After each completed Anthropic turn, reset the streaming
          // text buffer — its job for that turn is done. Plan stays locked.
          liveTextRef.current = "";
          bumpLive();
        },
        onError: (err) => {
          turnError = err;
          pushLog("error", `AI Worker: ${err}`);
        },
        signal: controller.signal,
      });
    } catch (err) {
      turnError = (err as Error).message;
      pushLog("error", `AI Worker crashed: ${turnError}`);
    } finally {
      const cancelled = controller.signal.aborted;
      abortRef.current = null;
      setStreaming(false);
      liveTextRef.current = "";
      livePlanRef.current = [];
      liveToolsRef.current = [];

      // Plan: prefer the early-locked plan; fall back to a final re-parse
      // in case `</plan>` arrived after we'd already trimmed the buffer.
      const plan = lockedPlan.length > 0 ? lockedPlan : parsePlan(turnText);
      const nextActions = parseNextActions(turnText);
      const visibleText = stripProtocolTags(turnText);

      // Push composite undo command if anything mutated. Doing it
      // post-hoc (without re-running do()) is safe because the steps
      // are already applied — we just need the stack entry so the
      // existing undo system can roll back.
      let hasUndoCommand = false;
      if (turnSteps.length > 0 && projectIdRef.current === requestProjectId) {
        const label =
          turnSteps.length === 1
            ? `AI · ${turnSteps[0].name}`
            : `AI turn (${turnSteps.length} steps)`;
        const cmd = makeAITurnCommand({
          label,
          steps: turnSteps,
          // command-stack: bypass — invoked from inside the AI turn command's
          // own do/undo to replace the scene snapshot; the surrounding
          // makeAITurnCommand IS the undoable record.
          apply: (data) => useEditor.getState().setSceneData(data),
        });
        // The stack runs cmd.do() on push, which would re-apply the same
        // final state we already have — a no-op write. Use the lower-level
        // bookkeeping path: temporarily swap do() to a noop for the
        // initial push, then restore it for redo.
        const realDo = cmd.do;
        cmd.do = () => undefined;
        useEditor.getState().commandStack.push(cmd);
        cmd.do = realDo;
        hasUndoCommand = true;
      }

      const turn: AITurn = {
        id: turnId,
        text: visibleText,
        plan,
        nextActions,
        tools: turnTools,
        hasUndoCommand,
        cancelled,
        error: turnError,
      };
      const aiEntry: HistoryEntry = { id: newId(), kind: "ai", turn };

      if (projectIdRef.current === requestProjectId) {
        setHistory((h) => [...h, aiEntry]);
      } else {
        const stored = loadHistory(requestProjectId);
        saveHistory(requestProjectId, [...stored, userEntry, aiEntry]);
      }

      if (cancelled && turnSteps.length > 0) {
        toast({
          title: "Partial AI changes applied",
          description: `${turnSteps.length} change(s) ran before you stopped. Use Undo last AI turn to revert them.`,
        });
      }
    }
  };

  const undoLastTurn = useCallback(() => {
    const stack = useEditor.getState().commandStack;
    // Find the most recent AI turn entry that still has its undo command
    // on the stack. If the user has done other ops since, those need to
    // come off first — we surface that as a warning rather than silently
    // popping someone's intervening manual edits.
    let idx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i];
      if (e.kind === "ai" && e.turn.hasUndoCommand) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      pushLog(
        "warn",
        "AI Worker: no in-session AI turn left to undo (undo is reset on reload).",
      );
      return;
    }
    const target = history[idx] as Extract<HistoryEntry, { kind: "ai" }>;
    const topLabel = stack.peekUndoLabel();
    if (!topLabel || !topLabel.startsWith("AI")) {
      toast({
        title: "Undo blocked",
        description:
          "You've made manual edits since the AI ran. Press Ctrl/Cmd+Z to undo those first, then try again.",
      });
      return;
    }
    const ok = stack.undo();
    if (!ok) {
      pushLog("warn", "AI Worker: command stack was already empty.");
      return;
    }
    pushLog("info", `AI Worker: rolled back ${target.turn.tools.length} tool change(s).`);
    setHistory((h) =>
      h.map((e, i) =>
        i === idx && e.kind === "ai"
          ? { ...e, turn: { ...e.turn, hasUndoCommand: false } }
          : e,
      ),
    );
    toast({ title: "AI turn undone", description: target.turn.plan[0]?.intent ?? topLabel });
  }, [history, pushLog, toast]);

  const focusEntities = (ids: string[]) => {
    if (ids.length === 0) return;
    const s = useEditor.getState();
    const found = s.sceneData.entities.find((e) => ids.includes(e.id));
    if (!found) {
      pushLog("warn", `AI Worker: entity no longer in scene (${ids[0]}).`);
      return;
    }
    s.selectEntity(found.id);
    s.requestFocus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const isEmpty = history.length === 0 && !streaming;
  const lastTurn = useMemo<AITurn | null>(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i];
      if (e.kind === "ai") return e.turn;
    }
    return null;
  }, [history]);
  const hasUndoableTurn = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i];
      if (e.kind === "ai" && e.turn.hasUndoCommand) return true;
    }
    return false;
  }, [history]);

  void liveTick;
  const livePlan = livePlanRef.current;
  const liveTools = liveToolsRef.current;
  const liveCompleted = countCompletedSteps(livePlan, liveTools);
  const liveText = liveTextRef.current;
  const liveVisibleText = liveText ? stripProtocolTags(liveText) : "";

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
          <AIIcon3D size={18} active={streaming} />
          <span className="font-heading text-[11px] uppercase tracking-[0.22em] brand-gold">
            AI Worker
          </span>
          {streaming && <Loader2 className="size-3 animate-spin text-primary" />}
          <span
            className={cn(
              "text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
              isPuterSignedIn
                ? "border-emerald-500/40 text-emerald-400"
                : "border-border text-muted-foreground",
            )}
            title="Puter AI (free cloud models)"
          >
            Puter {isPuterSignedIn ? "on" : "off"}
          </span>
          <span
            className={cn(
              "text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
              ollamaOk
                ? "border-sky-500/40 text-sky-400"
                : "border-border text-muted-foreground",
            )}
            title="Local Ollama at localhost:11434"
          >
            Ollama {ollamaOk ? "on" : "off"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {hasUndoableTurn && !streaming && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={undoLastTurn}
              title="Undo last AI turn (atomic — replays all tool calls in reverse via the editor's undo stack)"
              data-testid="button-ai-undo-turn"
            >
              <Undo2 className="size-3.5" />
            </Button>
          )}
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={clearHistory}
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

      {!isPuterSignedIn && (
        <div className="px-3 py-2 border-b border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-100/90 space-y-1.5 shrink-0">
          <p className="leading-snug">
            <strong className="text-amber-200">Sign in with Puter</strong> to use free agentic models
            (Claude / GPT / Gemini). Server Anthropic is optional; Ollama works offline when running locally.
          </p>
          <Button
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => {
              void signInWithPuter()
                .then(() => toast({ title: "Signed in with Puter", description: "Free AI models unlocked." }))
                .catch((err: unknown) =>
                  toast({
                    title: "Puter sign-in failed",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  }),
                );
            }}
            data-testid="button-ai-puter-signin"
          >
            Sign in with Puter
          </Button>
        </div>
      )}
      {aiStatusHint && isPuterSignedIn && (
        <div className="px-3 py-1.5 border-b border-border text-[10px] text-muted-foreground shrink-0">
          {aiStatusHint}
        </div>
      )}

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

          {history.map((entry) =>
            entry.kind === "user" ? (
              <UserBubble key={entry.id} text={entry.text} />
            ) : (
              <AITurnBubble
                key={entry.id}
                turn={entry.turn}
                onFocusEntities={focusEntities}
              />
            ),
          )}

          {streaming && (livePlan.length > 0 || liveVisibleText || liveTools.length > 0) && (
            <AITurnBubble
              turn={{
                id: "live",
                text: liveVisibleText,
                plan: livePlan,
                nextActions: [],
                tools: liveTools,
              }}
              live
              liveCompleted={liveCompleted}
              onFocusEntities={focusEntities}
            />
          )}
          {streaming && livePlan.length === 0 && !liveVisibleText && liveTools.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" />
              Thinking…
            </div>
          )}

          {!streaming && lastTurn && lastTurn.nextActions.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                Next
              </div>
              {lastTurn.nextActions.map((a) => (
                <button
                  key={a}
                  onClick={() => setInput(a)}
                  className="block w-full text-left text-xs px-2.5 py-1.5 rounded-md border border-primary/30 bg-primary/5 hover-elevate"
                  data-testid="button-ai-next-action"
                  title="Drop into the input — review then press Send"
                >
                  {a}
                </button>
              ))}
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
        <div className="flex items-center justify-between gap-2">
          <Select
            value={selectedModelId}
            onValueChange={setSelectedModelId}
            disabled={streaming}
          >
            <SelectTrigger
              className="h-7 text-[11px] flex-1 max-w-[230px]"
              data-testid="select-ai-model"
            >
              <SelectValue placeholder="Pick a model" />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => {
                // Allow selecting Puter models even when signed out — send()
                // surfaces a clear sign-in prompt instead of a dead dropdown.
                const locked = m.provider === "ollama" && !ollamaOk;
                return (
                  <SelectItem
                    key={m.id}
                    value={m.id}
                    disabled={locked}
                    data-testid={`option-model-${m.id}`}
                  >
                    <div className="flex flex-col">
                      <span className="text-xs">
                        {m.label}
                        {m.requiresPuterAuth && !isPuterSignedIn && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            (sign in)
                          </span>
                        )}
                        {m.provider === "ollama" && !ollamaOk && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            (offline)
                          </span>
                        )}
                      </span>
                      {m.hint && (
                        <span className="text-[10px] text-muted-foreground">
                          {m.hint}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {streaming ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={interrupt}
              data-testid="button-ai-interrupt"
              title="Stop the AI mid-response"
            >
              <Square className="size-3.5 mr-1.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => send()}
              disabled={!projectId || !input.trim()}
              data-testid="button-ai-send"
            >
              <Send className="size-3.5 mr-1.5" />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="rounded-md px-3 py-2 text-xs leading-relaxed border bg-primary/10 border-primary/30 text-foreground">
      <div className="whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
}

function AITurnBubble({
  turn,
  live,
  liveCompleted,
  onFocusEntities,
}: {
  turn: AITurn;
  live?: boolean;
  liveCompleted?: number;
  onFocusEntities: (ids: string[]) => void;
}) {
  const completed = live
    ? (liveCompleted ?? 0)
    : countCompletedSteps(turn.plan, turn.tools);
  return (
    <div
      className={cn(
        "rounded-md px-3 py-2 text-xs leading-relaxed border bg-card border-border text-foreground space-y-2",
        live && "border-primary/50",
        turn.cancelled && "border-amber-400/40",
      )}
    >
      {turn.plan.length > 0 && (
        <PlanChecklist plan={turn.plan} completed={completed} />
      )}
      {turn.text && (
        <div className="whitespace-pre-wrap break-words">{turn.text}</div>
      )}
      {turn.tools.length > 0 && (
        <div className="space-y-1">
          {turn.tools.map((t, i) => (
            <ToolCallChip
              key={t.id || i}
              tool={t}
              onFocusEntities={onFocusEntities}
            />
          ))}
        </div>
      )}
      {turn.cancelled && (
        <AICalloutError
          variant="warn"
          summary="Cancelled by user. The model stopped before it could finish."
        />
      )}
      {turn.error && !turn.cancelled && (
        <AICalloutError variant="error" summary={turn.error} />
      )}
    </div>
  );
}

function PlanChecklist({
  plan,
  completed,
}: {
  plan: AITurn["plan"];
  completed: number;
}) {
  return (
    <div
      className="rounded border border-border/60 bg-background/40 p-2 space-y-1"
      data-testid="ai-plan-checklist"
    >
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        Plan · {completed}/{plan.length}
      </div>
      <ol className="space-y-0.5">
        {plan.map((p, i) => {
          const done = i < completed;
          return (
            <li
              key={`${p.step}-${i}`}
              className={cn(
                "flex items-center gap-1.5 text-[11px]",
                done ? "text-foreground/80" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center size-3.5 rounded-sm border",
                  done
                    ? "border-accent bg-accent/20 text-accent"
                    : "border-border",
                )}
              >
                {done ? <Check className="size-2.5" /> : <span className="text-[8px]">{p.step}</span>}
              </span>
              <span className={cn(done && "line-through opacity-70")}>{p.intent}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ToolCallChip({
  tool,
  onFocusEntities,
}: {
  tool: AIToolEvent;
  onFocusEntities: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ok = tool.result?.ok;
  const entityIds = useMemo(() => extractEntityIdsFromTool(tool), [tool]);
  const focusable = entityIds.length > 0;
  return (
    <div
      className={cn(
        "rounded border text-[10.5px] font-mono",
        ok
          ? "border-accent/40 bg-accent/5"
          : "border-destructive/50 bg-destructive/10",
      )}
    >
      <div className="flex items-stretch">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center gap-1.5 px-2 py-1 text-left hover-elevate rounded-l"
          title={expanded ? "Hide details" : "Show input + result"}
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
          <ChevronRight
            className={cn(
              "size-3 text-muted-foreground/60 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        {focusable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFocusEntities(entityIds);
            }}
            className="px-1.5 border-l border-border/40 hover-elevate text-muted-foreground hover:text-primary"
            title={`Focus camera on ${entityIds.length} affected entit${entityIds.length === 1 ? "y" : "ies"}`}
            data-testid="button-ai-tool-focus"
          >
            <span className="text-[9px] uppercase tracking-wider">Focus</span>
          </button>
        )}
      </div>
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
            {ok && extractDiff(tool.result.data) ? (
              <DiffBlock diff={extractDiff(tool.result.data)!} />
            ) : (
              <pre className="whitespace-pre-wrap break-all text-foreground/90">
                {ok ? safeStringify(tool.result.data) : tool.result.error ?? "(no detail)"}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function extractDiff(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.diff === "string" && d.diff.includes("@@")) return d.diff;
  if (typeof d.before === "string" && typeof d.after === "string") {
    return synthesizeDiff(d.before, d.after);
  }
  return null;
}

function synthesizeDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (a[i] !== undefined) out.push(`  ${a[i]}`);
    } else {
      if (a[i] !== undefined) out.push(`- ${a[i]}`);
      if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    }
  }
  return out.join("\n");
}

function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="whitespace-pre overflow-x-auto text-[10px] leading-snug rounded border border-border/40 bg-background/40 p-1.5">
      {lines.map((line, i) => {
        const isMeta =
          line.startsWith("@@") ||
          line.startsWith("---") ||
          line.startsWith("+++") ||
          line.startsWith("===");
        const isAdd = !isMeta && line.startsWith("+");
        const isDel = !isMeta && line.startsWith("-");
        return (
          <div
            key={i}
            className={cn(
              "px-1",
              isMeta && "text-muted-foreground/70",
              isAdd && "bg-emerald-500/10 text-emerald-400",
              isDel && "bg-rose-500/10 text-rose-400",
            )}
          >
            {line || "\u00a0"}
          </div>
        );
      })}
    </pre>
  );
}

function AICalloutError({
  variant,
  summary,
}: {
  variant: "error" | "warn";
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const firstLine = summary.split("\n")[0].trim();
  const rest = summary.slice(firstLine.length).trim();
  const styles =
    variant === "error"
      ? "border-destructive/50 bg-destructive/10 text-destructive"
      : "border-amber-400/40 bg-amber-400/10 text-amber-300";
  return (
    <div
      className={cn(
        "rounded border px-2 py-1.5 text-[11px] flex items-start gap-1.5",
        styles,
      )}
      data-testid="ai-callout-error"
    >
      <AlertTriangle className="size-3 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="break-words">{firstLine || "Something went wrong."}</div>
        {rest && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] underline opacity-80 hover:opacity-100 mt-0.5"
          >
            {open ? "Hide details" : "Show details"}
          </button>
        )}
        {open && rest && (
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] opacity-90">
            {rest}
          </pre>
        )}
      </div>
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
