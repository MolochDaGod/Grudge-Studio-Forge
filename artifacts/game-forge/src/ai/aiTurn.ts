/**
 * AI Worker turn model.
 *
 * One "turn" = the entire AI response to a single user message, even when
 * the model loops through multiple tool-use rounds internally. We capture
 * the plan, every tool call, the final user-visible text, suggested
 * follow-ups, and the per-tool scene snapshots that power atomic undo.
 *
 * Atomic undo strategy: we snapshot `sceneData` BEFORE every mutating tool
 * call and AFTER it, then build one composite `Command` (`makeAITurnCommand`)
 * containing those step pairs and push it onto the editor's existing
 * `CommandStack`. `do()` re-applies each step in order; `undo()` walks them
 * in reverse — so a single press of "Undo last AI turn" unwinds the whole
 * batch through the same undo system human edits use. Redo just re-runs
 * the per-step `do()` chain.
 *
 * Snapshot scope: `sceneData` only (entities + environment + scriptId
 * bindings). Server-side resources the AI can also create — script source
 * rows, R2 assets — are NOT deleted on undo; the bindings unwind via the
 * scene snapshot, but orphan rows persist (they're cheap to leave behind
 * and the user can delete them through the regular panels). This keeps
 * undo synchronous and race-free.
 */
import type { SceneData } from "@/scene/types";
import type { Command } from "@/lib/commands";

export interface AITurnPlanStep {
  step: number;
  intent: string;
}

export interface AIToolEvent {
  id: string;
  name: string;
  input: unknown;
  result: { ok: boolean; data?: unknown; error?: string };
}

/** One mutating tool call's before/after scene state. The composite
 *  AI-turn command replays these in order on do(), and walks them in
 *  reverse on undo(), so each tool call's effect is reversed using the
 *  state immediately before that specific tool ran. */
export interface AITurnStep {
  /** Tool name (e.g. "add_entity", "generate_map") — used only for the
   *  history label so users can read what the AI did. */
  name: string;
  prev: SceneData;
  next: SceneData;
}

export interface AITurn {
  /** Stable id for React keys + history operations. */
  id: string;
  /** Final user-visible assistant text (with <plan>/<next_actions> stripped). */
  text: string;
  /** Parsed plan steps the model declared up front. Empty for single-step turns. */
  plan: AITurnPlanStep[];
  /** Suggested follow-up prompts harvested from <next_actions>. */
  nextActions: string[];
  /** Every tool call the model made this turn, in execution order. */
  tools: AIToolEvent[];
  /** True iff this turn pushed an undoable composite command onto the
   *  editor's command stack. The "Undo last AI turn" button uses this
   *  flag to know whether the in-session undo is still available
   *  (commands don't persist across reload). */
  hasUndoCommand?: boolean;
  /** True iff the user pressed the interrupt button. */
  cancelled?: boolean;
  /** Error string if the stream failed. */
  error?: string;
}

const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/i;
const NEXT_RE = /<next_actions>([\s\S]*?)<\/next_actions>/i;

/** Pull the JSON `[{step, intent}]` array out of the first <plan> tag.
 *  Returns [] when no tag, malformed JSON, or wrong shape. */
export function parsePlan(text: string): AITurnPlanStep[] {
  if (!text) return [];
  const m = text.match(PLAN_RE);
  if (!m) return [];
  try {
    const raw = JSON.parse(m[1].trim());
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.plan) ? raw.plan : [];
    const out: AITurnPlanStep[] = [];
    for (let i = 0; i < arr.length && out.length < 12; i++) {
      const item = arr[i] as { step?: unknown; intent?: unknown } | null;
      if (!item || typeof item !== "object") continue;
      const intent = typeof item.intent === "string" ? item.intent.trim() : "";
      if (!intent) continue;
      const step =
        typeof item.step === "number" && Number.isFinite(item.step)
          ? Math.trunc(item.step)
          : out.length + 1;
      out.push({ step, intent });
    }
    return out;
  } catch {
    return [];
  }
}

/** Pull the JSON string array from the first <next_actions> tag. Returns
 *  at most 3 short suggestions; longer / non-string entries are dropped. */
export function parseNextActions(text: string): string[] {
  if (!text) return [];
  const m = text.match(NEXT_RE);
  if (!m) return [];
  try {
    const raw = JSON.parse(m[1].trim());
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 80)
      .slice(0, 3);
  } catch {
    return [];
  }
}

/** Strip the protocol tags from assistant text so the bubble shows only
 *  natural prose. Also collapses the resulting whitespace. */
export function stripProtocolTags(text: string): string {
  return text.replace(PLAN_RE, "").replace(NEXT_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Best-effort harvest of entity ids the model touched. Used by the panel
 *  to make tool chips clickable ("focus on these entities"). Mirrors the
 *  shape used by aiAuditLog#pickIds but lives here so the panel doesn't
 *  have to import audit-log internals. */
export function extractEntityIdsFromTool(call: AIToolEvent): string[] {
  const ids = new Set<string>();
  visit(call.input, false);
  visit(call.result, false);
  return Array.from(ids);

  function visit(value: unknown, inEntityScope: boolean): void {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, inEntityScope);
      return;
    }
    if (typeof value !== "object") return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "entityId" || k === "rootId") {
        if (typeof v === "string") ids.add(v);
      } else if (k === "entityIds") {
        if (Array.isArray(v)) for (const x of v) if (typeof x === "string") ids.add(x);
      } else if (k === "id" && inEntityScope) {
        if (typeof v === "string") ids.add(v);
      }
      const child =
        inEntityScope ||
        k === "entities" ||
        k === "entity" ||
        k === "added" ||
        k === "deleted";
      visit(v, child);
    }
  }
}

/** Build the composite Command that represents one AI turn on the editor's
 *  undo stack. `apply` writes a SceneData into the live store (typically
 *  `useEditor.getState().setSceneData`).
 *
 *  Each step deep-clones the snapshots before writing so neither side
 *  shares structure with the live store — subsequent edits can't bleed
 *  back into a stored snapshot.
 *
 *  do(): replay each step's `next` in order — final state == last step.
 *  undo(): walk steps in reverse and write each `prev`, so the editor
 *  passes back through every intermediate state the AI created (this
 *  matches what the existing per-action commands do for human edits). */
export function makeAITurnCommand(opts: {
  label: string;
  steps: AITurnStep[];
  apply: (data: SceneData) => void;
}): Command {
  const { label, steps, apply } = opts;
  const clone = (d: SceneData): SceneData => JSON.parse(JSON.stringify(d));
  return {
    kind: "ai_turn",
    label,
    do: () => {
      for (const s of steps) apply(clone(s.next));
    },
    undo: () => {
      for (let i = steps.length - 1; i >= 0; i--) apply(clone(steps[i].prev));
    },
  };
}

/** Return how many planned steps appear "complete" given the tool calls
 *  that have run so far. We use a simple monotonic counter — match the
 *  number of successful, mutating tool calls against plan length. The
 *  model's plan steps don't carry tool-name hints, so name-matching
 *  would be unreliable. */
export function countCompletedSteps(
  plan: AITurnPlanStep[],
  tools: AIToolEvent[],
): number {
  if (plan.length === 0) return 0;
  let done = 0;
  for (const t of tools) {
    if (t.result?.ok) done += 1;
    if (done >= plan.length) break;
  }
  return Math.min(done, plan.length);
}
