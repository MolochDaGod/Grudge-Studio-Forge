/**
 * AIInlinePrompt — a thin contextual AI input bar embedded inside each
 * bottom-panel tab. Adapts its system prompt and suggestions based on
 * which tab it's in (Scripts, Console, Assets, Prefabs, Nodes, Layers).
 *
 * Shares the same runConversation + provider infrastructure as the
 * full AI Worker panel — this is a lightweight focused entry point,
 * not a duplicate system.
 */
import { useRef, useState, useMemo, useEffect } from "react";
import { Send, Loader2, ChevronUp, ChevronDown, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditor } from "@/store/editor";
import { runConversation, type ChatMessage } from "@/lib/aiClient";
import { TOOL_DEFS, buildSystemPrompt } from "@/lib/aiTools";
import {
  DEFAULT_MODEL_ID,
  findModel,
} from "@/lib/ai/providers";
import { AIIcon3D } from "@/editor/AIIcon3D";

// ── Tab-specific AI context ──────────────────────────────────────────

export type AITabContext =
  | "console"
  | "assets"
  | "scripts"
  | "prefabs"
  | "nodes"
  | "layers";

interface TabConfig {
  label: string;
  placeholder: string;
  suggestions: string[];
  /** Extra context appended to the system prompt so the AI knows what
   *  tab it's operating in and what data is available. */
  buildContext: () => string;
}

function getConsoleContext(): string {
  const msgs = useEditor.getState().consoleMessages.slice(-20);
  if (msgs.length === 0) return "Console is empty.";
  const lines = msgs.map((m) => `[${m.level}] ${m.text}`).join("\n");
  return `Recent console output (last ${msgs.length} lines):\n${lines}`;
}

function getSceneContext(): string {
  const { sceneData, selectedId, sceneName } = useEditor.getState();
  const count = sceneData.entities.length;
  const selected = selectedId
    ? sceneData.entities.find((e) => e.id === selectedId)
    : null;
  return [
    `Scene: "${sceneName}" (${count} entities)`,
    selected ? `Selected: "${selected.name}" (${selected.type}, id=${selected.id})` : "No entity selected",
    `Environment: ambient=${sceneData.environment.ambientIntensity ?? "?"}, sun=${sceneData.environment.sunIntensity ?? "?"}`,
  ].join("\n");
}

const TAB_CONFIGS: Record<AITabContext, TabConfig> = {
  console: {
    label: "Debug",
    placeholder: "Ask about errors, logs, or performance...",
    suggestions: [
      "What does the last error mean?",
      "Why is my script not running?",
      "Show me all warnings",
    ],
    buildContext: () =>
      `You are helping the user debug their scene via the Console tab.\n${getConsoleContext()}\n${getSceneContext()}`,
  },
  assets: {
    label: "Assets",
    placeholder: "Find, convert, or manage assets...",
    suggestions: [
      "Find a texture for stone walls",
      "List all models in the scene",
      "Upload and convert an FBX to GLB",
    ],
    buildContext: () =>
      `You are helping the user manage assets in the Assets tab. You can search Poly Haven, import models, and manage R2 storage.\n${getSceneContext()}`,
  },
  scripts: {
    label: "Script Bot",
    placeholder: "Describe a script for the active scene...",
    suggestions: [
      "Write a health system for the player",
      "Add a patrol script to all enemies",
      "Create a day/night cycle manager",
      "Debug why my damage script isn't working",
    ],
    buildContext: () => {
      const { sceneData } = useEditor.getState();
      const entities = sceneData.entities
        .map((e) => `  ${e.name} (${e.type}${e.behavior ? `, behavior: ${e.behavior}` : ""}${e.scriptId ? `, script: ${e.scriptId}` : ""})`)
        .join("\n");
      return `You are the Script Bot — an AI code assistant for the Scripts tab.
Your job is to write, debug, and integrate scripts for the active scene.
Scripts use the Forge API: exports.start(entity, ctx) and exports.update(entity, ctx).
Available ctx members: ctx.scene (find/spawn/despawn/send), ctx.events (emit/on), ctx.state, ctx.time (delta/elapsed), ctx.keys, ctx.log.

Current scene entities:
${entities}
${getSceneContext()}

When writing scripts:
1. Use the correct exports.start / exports.update shape
2. Reference entities by name via ctx.scene.find("Name")
3. Use ctx.events for cross-entity communication (damage, death, pickup, quest-complete)
4. Always add ctx.log() calls for debugging`;
    },
  },
  prefabs: {
    label: "Prefabs",
    placeholder: "Create, organize, or modify prefabs...",
    suggestions: [
      "Create a prefab from the selected entity",
      "Organize the scene into prefab groups",
      "Duplicate the player prefab with different stats",
    ],
    buildContext: () =>
      `You are helping the user manage prefabs. Prefabs are reusable entity groups that can be spawned via the hotbar or scripts.\n${getSceneContext()}`,
  },
  nodes: {
    label: "Nodes",
    placeholder: "Describe a node graph or ask for help...",
    suggestions: [
      "Wire a combat damage graph",
      "Create a spawner node setup",
      "Explain how to connect nodes to the scene output",
    ],
    buildContext: () =>
      `You are helping the user with the visual node editor (Nodes tab). Nodes connect meshes, lights, and logic to the Scene Output node.\n${getSceneContext()}`,
  },
  layers: {
    label: "Layers",
    placeholder: "Organize entities into layers...",
    suggestions: [
      "Set all enemies to the Enemy layer",
      "Create a lighting layer for all lights",
      "Show me which entities have no layer assigned",
    ],
    buildContext: () => {
      const { sceneData } = useEditor.getState();
      const layers = new Map<string, number>();
      for (const e of sceneData.entities) {
        const l = e.layer ?? "Default";
        layers.set(l, (layers.get(l) ?? 0) + 1);
      }
      const summary = [...layers.entries()]
        .map(([k, v]) => `  ${k}: ${v} entities`)
        .join("\n");
      return `You are helping the user organize entities into layers for physics, visibility, and collision grouping.\nCurrent layer distribution:\n${summary}\n${getSceneContext()}`;
    },
  },
};

// ── Component ────────────────────────────────────────────────────────

interface AIInlinePromptProps {
  tabContext: AITabContext;
}

export function AIInlinePrompt({ tabContext }: AIInlinePromptProps) {
  const config = TAB_CONFIGS[tabContext];
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedModel = useMemo(() => {
    try {
      const stored = localStorage.getItem("grudge.ai.model") ?? DEFAULT_MODEL_ID;
      return findModel(stored);
    } catch {
      return findModel(null);
    }
  }, []);

  // Clear response when tab changes
  useEffect(() => {
    setResponse("");
    setError(null);
  }, [tabContext]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || !projectId) return;

    setStreaming(true);
    setResponse("");
    setError(null);
    setExpanded(true);
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;

    // Build context-aware system prompt
    const baseSystem = buildSystemPrompt();
    const tabSuffix = config.buildContext();
    const system = `${baseSystem}\n\n--- TAB CONTEXT: ${config.label.toUpperCase()} ---\n${tabSuffix}`;

    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: trimmed }] },
    ];

    let fullText = "";

    try {
      await runConversation(messages, TOOL_DEFS, system, {
        model: selectedModel,
        onTextDelta: (t) => {
          fullText += t;
          setResponse(fullText);
        },
        onTool: (call) => {
          const r = call.result as { ok?: boolean } | undefined;
          if (r?.ok) {
            pushLog("info", `AI · ${call.name} ok`);
          } else {
            pushLog("warn", `AI · ${call.name} failed`);
          }
        },
        onTurnEnd: () => {},
        onError: (err) => {
          setError(err);
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        setError((err as Error).message);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  const interrupt = () => {
    abortRef.current?.abort();
  };

  const dismiss = () => {
    setResponse("");
    setError(null);
    setExpanded(false);
  };

  if (!projectId) return null;

  return (
    <div className="border-t border-border bg-card/30">
      {/* Response area (collapsible) */}
      {(response || error) && (
        <div
          className={`overflow-hidden transition-all duration-200 ${expanded ? "max-h-[200px]" : "max-h-0"}`}
        >
          <div className="px-3 py-2 text-xs overflow-y-auto max-h-[200px]">
            {error ? (
              <div className="text-destructive">{error}</div>
            ) : (
              <div className="text-foreground/80 whitespace-pre-wrap break-words leading-relaxed">
                {response}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <AIIcon3D size={16} active={streaming} />

        {/* Suggestions (when empty) */}
        {!input && !streaming && !response && (
          <div className="flex gap-1 overflow-x-auto flex-1 min-w-0 scrollbar-hide">
            {config.suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors whitespace-nowrap"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input field (shown when user starts typing or has a response) */}
        {(input || streaming || response) && (
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={config.placeholder}
            disabled={streaming}
            className="h-6 text-[11px] flex-1 min-w-0 bg-transparent border-border/40"
          />
        )}

        {/* Expand/collapse response */}
        {(response || error) && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
          </Button>
        )}

        {/* Dismiss */}
        {(response || error) && !streaming && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={dismiss}
          >
            <X className="size-3" />
          </Button>
        )}

        {/* Send / Stop */}
        {streaming ? (
          <Button
            variant="destructive"
            size="icon"
            className="size-6 shrink-0"
            onClick={interrupt}
          >
            <Loader2 className="size-3 animate-spin" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-primary"
            onClick={input ? send : () => inputRef.current?.focus()}
            disabled={!input.trim()}
          >
            <Send className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
