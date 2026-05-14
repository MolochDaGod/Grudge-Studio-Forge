/**
 * In-memory audit log of every AI tool call this session.
 *
 * Populated by `aiClient.runConversation` after each tool finishes; consumed
 * by the `get_last_ai_changes` introspection tool so the model can ask "what
 * did I just touch?" — useful when it loses track across many turns or when
 * the user follows up with "undo the last thing you did".
 *
 * Capped at MAX_ENTRIES (FIFO) — the goal is recent-context, not durable
 * audit. Persists for the page lifetime only.
 */

export interface AiAuditEntry {
  /** Wall-clock ms when the call resolved. */
  ts: number;
  /** Tool name as registered in `aiTools.ts`. */
  name: string;
  /** Input args sent by the model (JSON-serializable). */
  input: unknown;
  /** Result returned by the local executor (JSON-serializable). */
  result: unknown;
  /** True iff the executor returned `{ ok: false }` (or threw). */
  error: boolean;
  /** Best-effort entity ids the call touched, lifted from input/result. */
  affectedEntityIds: string[];
}

const MAX_ENTRIES = 100;
const log: AiAuditEntry[] = [];

/** Mutating ops we consider "scene changes" worth surfacing in the
 *  default `changesOnly` view of `get_last_ai_changes`. Read-only and
 *  introspection tools are filtered out. */
export const MUTATING_TOOLS = new Set<string>([
  "add_entity",
  "add_box_entity",
  "add_sphere_entity",
  "add_cylinder_entity",
  "add_plane_entity",
  "add_light_entity",
  "add_model_entity",
  "update_entity",
  "delete_entity",
  "duplicate_entity",
  "move_entity",
  "rename_entity",
  "set_entity_parent",
  "set_environment",
  "clear_scene",
  "generate_map",
  "spawn_vfx_prefab",
  "create_script",
  "attach_script",
  "set_player",
  "set_tunable_param",
  "save_scene_snapshot",
  "import_asset_from_url",
  // Design tools (apply_* / arrange_* / polish_*) mutate scene entities or
  // environment, so they must participate in AI-turn snapshotting.
  "arrange_entities",
  "apply_palette",
  "apply_lighting_preset",
  "polish_scene",
  // Scripting mutators — anything that writes a script body, attaches a
  // behavior, or rewires entity script lists changes the scene's runtime
  // behavior and must be undoable as part of the AI turn.
  "update_script",
  "patch_script",
  "delete_script",
  "attach_script_to_entity",
  "detach_script_from_entity",
  "reorder_entity_scripts",
  "attach_behavior",
  "detach_behavior",
  "create_script_from_template",
  // 2D UI Editor mutators (per-project HUD screens). All write to the
  // useUIScreens store, surface in the AI audit log so the user can see
  // the screen-edit history alongside scene edits.
  "ui_create_screen",
  "ui_rename_screen",
  "ui_delete_screen",
  "ui_add_widget",
  "ui_update_widget",
  "ui_remove_widget",
  // Layer mutators
  "set_layer",
  "set_layer_matrix",
]);

/** Keys we'll harvest as entity ids. Strict allow-list — the heuristic
 *  used to walk every `*Id` / `*Ids` key (including projectId, scriptId,
 *  prefabId), which polluted `affectedEntityIds` with non-entity values
 *  and made the field untrustworthy for "undo last AI change" reasoning. */
const ENTITY_ID_KEYS = new Set<string>([
  "entityId",
  "entityIds",
  "rootId",
  "id", // only inside entity-shaped objects (gated by ENTITY_OBJECT_KEYS below)
]);

/** Top-level keys whose nested objects/arrays are known to contain entity
 *  records (not script / prefab / asset records). Used to scope where
 *  bare `id` is harvested from. */
const ENTITY_OBJECT_CONTAINERS = new Set<string>(["entities", "entity"]);

function pickIds(
  value: unknown,
  into: Set<string>,
  inEntityScope = false,
): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) pickIds(v, into, inEntityScope);
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "entityId" || k === "rootId") {
      if (typeof v === "string") into.add(v);
    } else if (k === "entityIds") {
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string") into.add(x);
    } else if (k === "id" && inEntityScope) {
      if (typeof v === "string") into.add(v);
    }
    const childInScope =
      inEntityScope || ENTITY_OBJECT_CONTAINERS.has(k) || k === "added" || k === "deleted";
    pickIds(v, into, childInScope);
  }
  // Reference the allow-list so it isn't accidentally tree-shaken away if
  // imported elsewhere; harmless at runtime.
  void ENTITY_ID_KEYS;
}

export function recordAiToolCall(call: {
  name: string;
  input: unknown;
  result: unknown;
}): void {
  const r = call.result as { ok?: boolean } | null | undefined;
  const error = !(r && r.ok);
  const ids = new Set<string>();
  pickIds(call.input, ids);
  pickIds(call.result, ids);
  const entry: AiAuditEntry = {
    ts: Date.now(),
    name: call.name,
    input: call.input,
    result: call.result,
    error,
    affectedEntityIds: Array.from(ids),
  };
  log.push(entry);
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
}

export interface RecentEntriesOpts {
  /** Max entries to return (newest first). Default 20, capped at MAX_ENTRIES. */
  limit?: number;
  /** When true (default), exclude read-only/introspection tools. */
  changesOnly?: boolean;
  /** Optional name filter — only entries whose name starts with one of these. */
  namePrefixes?: string[];
}

export function getRecentAiCalls(opts: RecentEntriesOpts = {}): AiAuditEntry[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 20), MAX_ENTRIES);
  const changesOnly = opts.changesOnly !== false;
  const out: AiAuditEntry[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = log[i];
    if (changesOnly && !MUTATING_TOOLS.has(e.name)) continue;
    if (opts.namePrefixes && opts.namePrefixes.length > 0) {
      if (!opts.namePrefixes.some((p) => e.name.startsWith(p))) continue;
    }
    out.push(e);
  }
  return out;
}

export function clearAiAuditLog(): void {
  log.length = 0;
}

/** Total entries currently held — useful for tests. */
export function _auditLogSize(): number {
  return log.length;
}
