/**
 * Scripting tools for the AI Worker.
 *
 * Closes the script-authoring loop:
 *   - read existing source (`get_script`, `list_script_attachments`)
 *   - write source (`update_script`, `patch_script` with unified diff)
 *   - compile-check before saving (`validate_script`, also called
 *     internally by every write tool — the AI cannot persist a broken
 *     script through these handlers)
 *   - attach / detach / inspect on entities
 *   - attach / detach BUILT-IN behaviors (`attach_behavior`,
 *     `detach_behavior` — wires the BehaviorKind tag without touching
 *     the user's scriptId)
 *   - scaffold from built-in behavior templates (including the
 *     `pickup-trigger` and `trigger-zone` templates that demonstrate
 *     the trigger-event surface)
 *   - read script-emitted runtime logs to close the feedback loop
 *
 * Trigger / pickup ScriptContext surface (see `scene/csTranspile.ts`):
 *   - `ctx.scene.onEnterTrigger((other) => …)` — fires when another
 *     body starts overlapping a sensor on this entity. `other` is a
 *     `TriggerEvent` with `otherId`, `otherName`, `otherLayer`.
 *   - `ctx.scene.onExitTrigger((other) => …)` — inverse of enter.
 *   - `ctx.scene.despawn(id)` — remove an entity from the scene
 *     mid-play (returns true if it existed). Useful for pickups.
 *   The matching built-in behavior is `pickup-trigger`; attach it via
 *   `attach_behavior` for the canonical "touch a Trigger-layer entity
 *   to consume it" flow.
 *
 * Mutations to the editor's scene-graph go through the existing Zustand
 * store actions so undo continues to work the same as a user edit.
 *
 * Server writes (`PATCH /api/scripts/:id`, etc.) are made directly with
 * `fetch` — there's no React-Query mutation available off the React
 * tree, but the ScriptEditor / panel queries auto-refetch the next time
 * they're focused, so the UI stays consistent.
 */

import { applyPatch, createTwoFilesPatch } from "diff";
import { useEditor } from "@/store/editor";
import { BUILTIN_BEHAVIORS } from "@/lib/deathmatchBehaviors";
import {
  SCRIPT_TEMPLATES,
  getTemplate,
} from "./templates";
import {
  validateScript,
  type ScriptLanguage,
} from "./validate";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

interface ScriptRecord {
  id: number;
  name: string;
  language: ScriptLanguage;
  code: string;
  projectId: number;
  updatedAt?: string;
}

async function listProjectScripts(projectId: number): Promise<ScriptRecord[]> {
  const res = await fetch(apiUrl(`projects/${projectId}/scripts`));
  if (!res.ok) throw new Error(`List scripts failed (${res.status})`);
  return (await res.json()) as ScriptRecord[];
}

async function getScriptById(id: number): Promise<ScriptRecord> {
  const res = await fetch(apiUrl(`scripts/${id}`));
  if (!res.ok) throw new Error(`Get script ${id} failed (${res.status})`);
  return (await res.json()) as ScriptRecord;
}

async function patchScriptOnServer(
  id: number,
  patch: Partial<Pick<ScriptRecord, "name" | "code" | "language">>,
): Promise<ScriptRecord> {
  const res = await fetch(apiUrl(`scripts/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Update script ${id} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()) as ScriptRecord;
}

async function deleteScriptOnServer(id: number): Promise<void> {
  const res = await fetch(apiUrl(`scripts/${id}`), { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`Delete script ${id} failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

/** Resolve a script by id OR by name (within the active project). */
async function resolveScript(input: {
  scriptId?: unknown;
  name?: unknown;
  projectId: number;
}): Promise<ScriptRecord> {
  if (typeof input.scriptId === "number") {
    return getScriptById(input.scriptId);
  }
  if (typeof input.name === "string" && input.name.length > 0) {
    const all = await listProjectScripts(input.projectId);
    const match = all.find((s) => s.name === input.name);
    if (!match) {
      const exact = all.find((s) => s.name.toLowerCase() === (input.name as string).toLowerCase());
      if (!exact) {
        throw new Error(`No script named "${input.name}" in this project.`);
      }
      return exact;
    }
    return match;
  }
  throw new Error("Provide scriptId or name.");
}

/** Project-id guard used by every handler that talks to the server. */
function activeProjectId(): number {
  const pid = useEditor.getState().projectId;
  if (!pid) throw new Error("No project open.");
  return pid;
}

/** Find every entity attached to a given script. */
function entitiesUsingScript(scriptId: number) {
  return useEditor
    .getState()
    .sceneData.entities.filter((e) => e.scriptId === scriptId)
    .map((e) => ({ id: e.id, name: e.name, type: e.type }));
}

// ── get_script ─────────────────────────────────────────────────────────
const GET_SCRIPT: ToolDef = {
  name: "get_script",
  description:
    "Read a script's full source by id OR by name (within the active project). Returns id, name, language, code, and the entities currently attached. Always call this before patch_script / update_script so you're patching the latest version.",
  input_schema: {
    type: "object",
    properties: {
      scriptId: { type: "number", description: "Script id (preferred)." },
      name: { type: "string", description: "Exact script name as a fallback." },
    },
  },
};
const getScriptHandler: ToolHandler = async (input) => {
  try {
    const projectId = activeProjectId();
    const script = await resolveScript({ ...input, projectId });
    return {
      ok: true,
      data: {
        id: script.id,
        name: script.name,
        language: script.language,
        code: script.code,
        attachedEntities: entitiesUsingScript(script.id),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── list_script_attachments ────────────────────────────────────────────
const LIST_SCRIPT_ATTACHMENTS: ToolDef = {
  name: "list_script_attachments",
  description:
    "List every script-like attachment on an entity: its built-in behavior tag (if any) and the user script bound via scriptId. Use this to figure out what's already wired before adding more, and to find the script id you want to patch when the user says 'fix the script on this enemy'.",
  input_schema: {
    type: "object",
    required: ["entityId"],
    properties: { entityId: { type: "string" } },
  },
};
const listScriptAttachmentsHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const ent = useEditor.getState().sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };
  let scriptName: string | null = null;
  let scriptLanguage: string | null = null;
  if (ent.scriptId != null) {
    try {
      const projectId = activeProjectId();
      const all = await listProjectScripts(projectId);
      const found = all.find((s) => s.id === ent.scriptId);
      if (found) {
        scriptName = found.name;
        scriptLanguage = found.language;
      }
    } catch {
      // tolerate API failure — still return the structural attachment data
    }
  }
  return {
    ok: true,
    data: {
      entityId: id,
      entityName: ent.name,
      behavior: ent.behavior ?? null,
      scriptId: ent.scriptId ?? null,
      scriptName,
      scriptLanguage,
    },
  };
};

// ── validate_script ────────────────────────────────────────────────────
const VALIDATE_SCRIPT: ToolDef = {
  name: "validate_script",
  description:
    "Compile-check a JS or C# script source WITHOUT saving it. Returns { ok, errors, exports:{ start, update } }. Always call this before update_script / patch_script so you can self-correct syntax errors first; the write tools also call validate internally and refuse the write on failure.",
  input_schema: {
    type: "object",
    required: ["language", "code"],
    properties: {
      language: { type: "string", enum: ["js", "cs"] },
      code: { type: "string" },
    },
  },
};
const validateScriptHandler: ToolHandler = async (input) => {
  const language = String(input.language ?? "js") as ScriptLanguage;
  const code = String(input.code ?? "");
  const result = validateScript(language, code);
  return { ok: true, data: result };
};

// ── update_script ──────────────────────────────────────────────────────
const UPDATE_SCRIPT: ToolDef = {
  name: "update_script",
  description:
    "Replace a script's full body. Validates the new source first; refuses to write if validation fails (returns { ok:false, error, validation }). Use patch_script for small edits — replacing the whole body discards the user's existing formatting unnecessarily.",
  input_schema: {
    type: "object",
    required: ["code"],
    properties: {
      scriptId: { type: "number" },
      name: { type: "string", description: "Resolve by name when scriptId is not known." },
      code: { type: "string", description: "New full body." },
      newName: { type: "string", description: "Optional rename." },
    },
  },
};
const updateScriptHandler: ToolHandler = async (input) => {
  try {
    const projectId = activeProjectId();
    const current = await resolveScript({ ...input, projectId });
    const code = String(input.code ?? "");
    const v = validateScript(current.language, code);
    if (!v.ok) {
      return {
        ok: false,
        error: `Validation failed: ${v.errors.map((e) => e.message).join("; ")}`,
        data: { validation: v },
      };
    }
    const patch: Partial<Pick<ScriptRecord, "name" | "code">> = { code };
    if (typeof input.newName === "string" && input.newName.length > 0) {
      patch.name = input.newName;
    }
    const updated = await patchScriptOnServer(current.id, patch);
    const diff = createTwoFilesPatch(
      current.name,
      updated.name,
      current.code,
      updated.code,
      "before",
      "after",
    );
    return {
      ok: true,
      data: {
        id: updated.id,
        name: updated.name,
        language: updated.language,
        bytes: updated.code.length,
        validation: v,
        diff,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── patch_script ───────────────────────────────────────────────────────
const PATCH_SCRIPT: ToolDef = {
  name: "patch_script",
  description:
    "Apply a unified-diff patch to a script's source. Preferred over update_script for small edits — preserves untouched lines and produces a tighter audit trail. The patch must be a standard unified-diff hunk (e.g. produced by `diff -u`). Validates the resulting source; refuses to write on failure.",
  input_schema: {
    type: "object",
    required: ["patch"],
    properties: {
      scriptId: { type: "number" },
      name: { type: "string" },
      patch: {
        type: "string",
        description:
          "Unified diff string. Headers (---/+++) optional — the file's current code is used as the source.",
      },
    },
  },
};
const patchScriptHandler: ToolHandler = async (input) => {
  try {
    const projectId = activeProjectId();
    const current = await resolveScript({ ...input, projectId });
    const patchText = String(input.patch ?? "");
    if (!patchText.trim()) return { ok: false, error: "Empty patch." };
    const next = applyPatch(current.code, patchText);
    if (next === false || typeof next !== "string") {
      return {
        ok: false,
        error:
          "Patch did not apply cleanly. The script may have changed since you read it — call get_script and rebuild the diff.",
      };
    }
    const v = validateScript(current.language, next);
    if (!v.ok) {
      return {
        ok: false,
        error: `Patched source failed validation: ${v.errors.map((e) => e.message).join("; ")}`,
        data: { validation: v, after: next },
      };
    }
    const updated = await patchScriptOnServer(current.id, { code: next });
    const diff = createTwoFilesPatch(
      current.name,
      updated.name,
      current.code,
      updated.code,
      "before",
      "after",
    );
    return {
      ok: true,
      data: {
        id: updated.id,
        name: updated.name,
        bytes: updated.code.length,
        validation: v,
        before: current.code,
        after: updated.code,
        diff,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── delete_script ──────────────────────────────────────────────────────
const DELETE_SCRIPT: ToolDef = {
  name: "delete_script",
  description:
    "Delete a script from the project. Detaches it from any entities first (so the scene doesn't keep a dangling scriptId pointing at nothing). Destructive — the AI client will confirm with the user before running.",
  input_schema: {
    type: "object",
    properties: {
      scriptId: { type: "number" },
      name: { type: "string" },
    },
  },
};
const deleteScriptHandler: ToolHandler = async (input) => {
  try {
    const projectId = activeProjectId();
    const current = await resolveScript({ ...input, projectId });
    const detached = entitiesUsingScript(current.id);
    if (detached.length > 0) {
      const cmdSetEntityScript = useEditor.getState().cmdSetEntityScript;
      for (const e of detached) cmdSetEntityScript(e.id, null);
    }
    await deleteScriptOnServer(current.id);
    return {
      ok: true,
      data: {
        id: current.id,
        name: current.name,
        detachedFrom: detached.map((e) => e.id),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── attach_script_to_entity ────────────────────────────────────────────
const ATTACH_SCRIPT_TO_ENTITY: ToolDef = {
  name: "attach_script_to_entity",
  description:
    "Bind a script (by id or name) to an entity. Replaces any previously attached script — the data model holds at most one user script per entity (a built-in behavior tag can run alongside it).",
  input_schema: {
    type: "object",
    required: ["entityId"],
    properties: {
      entityId: { type: "string" },
      scriptId: { type: "number" },
      name: { type: "string", description: "Script name fallback when scriptId is unknown." },
    },
  },
};
const attachScriptToEntityHandler: ToolHandler = async (input) => {
  try {
    const id = String(input.entityId ?? "");
    const s = useEditor.getState();
    const ent = s.sceneData.entities.find((e) => e.id === id);
    if (!ent) return { ok: false, error: `No entity with id "${id}".` };
    const projectId = activeProjectId();
    const script = await resolveScript({ ...input, projectId });
    s.cmdSetEntityScript(id, script.id);
    return {
      ok: true,
      data: { entityId: id, scriptId: script.id, scriptName: script.name },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── detach_script_from_entity ──────────────────────────────────────────
const DETACH_SCRIPT_FROM_ENTITY: ToolDef = {
  name: "detach_script_from_entity",
  description:
    "Remove the user script attachment from an entity (built-in behavior tag is preserved). Pass-through to the same store action that the inspector uses, so undo works.",
  input_schema: {
    type: "object",
    required: ["entityId"],
    properties: { entityId: { type: "string" } },
  },
};
const detachScriptFromEntityHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const s = useEditor.getState();
  const ent = s.sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };
  const prev = ent.scriptId ?? null;
  s.cmdSetEntityScript(id, null);
  return { ok: true, data: { entityId: id, detachedScriptId: prev } };
};

// ── reorder_entity_scripts ─────────────────────────────────────────────
const REORDER_ENTITY_SCRIPTS: ToolDef = {
  name: "reorder_entity_scripts",
  description:
    "Persist the script attachment order for an entity. The current data model supports a single user script per entity (built-in behavior runs first, user script second), so reorder collapses to selecting which scriptId from the input list should be the active one — usually the first. Returns the resulting attachment.",
  input_schema: {
    type: "object",
    required: ["entityId", "scriptIds"],
    properties: {
      entityId: { type: "string" },
      scriptIds: {
        type: "array",
        items: { type: "number" },
        description: "New ordering. The FIRST id becomes the active scriptId.",
      },
    },
  },
};
const reorderEntityScriptsHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const ids = Array.isArray(input.scriptIds) ? (input.scriptIds as unknown[]) : [];
  const s = useEditor.getState();
  const ent = s.sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };
  const next = typeof ids[0] === "number" ? (ids[0] as number) : null;
  s.cmdSetEntityScript(id, next);
  return {
    ok: true,
    data: {
      entityId: id,
      activeScriptId: next,
      ignoredScriptIds: ids.slice(1),
      note:
        ids.length > 1
          ? "Only one user script is supported per entity in the current model; remaining ids were ignored."
          : undefined,
    },
  };
};

// ── attach_behavior ────────────────────────────────────────────────────
const ATTACH_BEHAVIOR: ToolDef = {
  name: "attach_behavior",
  description:
    "Tag an entity with a built-in BehaviorKind. Built-in behaviors run alongside any user script (behavior first, user script second), so this is the right tool for 'turn this into a pickup', 'mark this as the player', 'add an enemy AI'. For trigger-style behaviors (`pickup-trigger`) make sure the entity's layer is `Trigger` so Rapier spawns it as a sensor — the AI can do that with `set_layer` from the layers tools. Use list_builtin_behaviors to see valid keys.",
  input_schema: {
    type: "object",
    required: ["entityId", "behavior"],
    properties: {
      entityId: { type: "string" },
      behavior: {
        type: "string",
        enum: Object.keys(BUILTIN_BEHAVIORS),
        description:
          "BehaviorKind tag. `pickup-trigger` despawns the entity when a Player-layer body overlaps its sensor — pair with set_layer({ layer: 'Trigger' }).",
      },
    },
  },
};
const attachBehaviorHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const behaviorRaw = String(input.behavior ?? "");
  if (!Object.hasOwn(BUILTIN_BEHAVIORS, behaviorRaw)) {
    return {
      ok: false,
      error: `Unknown behavior "${behaviorRaw}". Valid: ${Object.keys(BUILTIN_BEHAVIORS).join(", ")}.`,
    };
  }
  const s = useEditor.getState();
  const ent = s.sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };
  const previous = ent.behavior ?? null;
  const behavior = behaviorRaw as keyof typeof BUILTIN_BEHAVIORS;
  s.cmdUpdateEntity(id, (e) => {
    e.behavior = behavior;
  });
  const layerHint =
    behavior === "pickup-trigger" && (ent.layer ?? "Default") !== "Trigger"
      ? "Entity's layer is not 'Trigger' — pickup-trigger relies on a sensor body. Call set_layer to put it on the Trigger layer."
      : undefined;
  return {
    ok: true,
    data: {
      entityId: id,
      entityName: ent.name,
      behavior,
      previousBehavior: previous,
      layer: ent.layer ?? "Default",
      hint: layerHint,
    },
  };
};

// ── detach_behavior ────────────────────────────────────────────────────
const DETACH_BEHAVIOR: ToolDef = {
  name: "detach_behavior",
  description:
    "Remove the built-in behavior tag from an entity (the user script attachment, if any, is preserved). Pass-through to the same store update path the inspector uses, so undo works.",
  input_schema: {
    type: "object",
    required: ["entityId"],
    properties: { entityId: { type: "string" } },
  },
};
const detachBehaviorHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const s = useEditor.getState();
  const ent = s.sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };
  const previous = ent.behavior ?? null;
  s.cmdUpdateEntity(id, (e) => {
    e.behavior = undefined;
  });
  return { ok: true, data: { entityId: id, previousBehavior: previous } };
};

// ── list_builtin_behaviors ─────────────────────────────────────────────
const LIST_BUILTIN_BEHAVIORS: ToolDef = {
  name: "list_builtin_behaviors",
  description:
    "List the built-in BehaviorKind tags an entity can be wired with via attach_behavior. Each entry includes a short description plus the recommended physics layer (e.g. `pickup-trigger` → `Trigger` so it spawns as a Rapier sensor).",
  input_schema: { type: "object", properties: {} },
};
const BEHAVIOR_DOCS: Record<
  keyof typeof BUILTIN_BEHAVIORS,
  { description: string; recommendedLayer?: string }
> = {
  "player-deathmatch": {
    description:
      "Wire LMB-shoot, health, damage, respawn for the player entity. Pair with controllerKind=firstPerson|thirdPerson.",
    recommendedLayer: "Player",
  },
  "enemy-deathmatch": {
    description:
      "Yuka-driven AI with patrol/chase/attack/flee FSM, line-of-sight raycasts, group alerts.",
    recommendedLayer: "NPC",
  },
  "gamemode-deathmatch": {
    description:
      "Score tracker for player vs. enemy kills; emits win/lose when scoreLimit is reached. Attach to a hidden empty named 'GameManager'.",
  },
  "rts-peon": {
    description:
      "RTS worker: auto-moves to nearest GoldMine/Forest, gathers, deposits at own TownHall. Emits rtsGold for the match HUD.",
    recommendedLayer: "Player",
  },
  "rts-footman": {
    description:
      "RTS melee unit: auto-engages nearest hostile peon/footman/creep/enemy town hall. Emits rtsBuildingDamage on halls.",
    recommendedLayer: "Player",
  },
  "rts-creep": {
    description:
      "Neutral camp guard: idles near spawn, aggroes on nearby player RTS units.",
    recommendedLayer: "NPC",
  },
  "gamemode-rts": {
    description:
      "RTS match controller: tracks gold + town-hall HP, emits rtsHud and win/lose. Attach to a hidden empty named GameManager.",
  },
  spawnpoint: {
    description:
      "Pure marker — lets player/enemy behaviors find spawn points by behavior tag.",
    recommendedLayer: "Trigger",
  },
  "pickup-trigger": {
    description:
      "Despawns this entity when a Player-named or Player-layer body overlaps. Demonstrates the onEnterTrigger / despawn ScriptContext API.",
    recommendedLayer: "Trigger",
  },
  "player-rpg": {
    description:
      "RPG-flavored player: LMB melee swing, E-key 'interact' event, health + damage HUD wiring. No respawn (death is permanent) and no kill-feed scoring — pair with enemy-rpg for adventure-style scenes.",
    recommendedLayer: "Player",
  },
  "enemy-rpg": {
    description:
      "RPG-flavored enemy: peaceful Yuka wander until provoked by damage or proximity, then chases + melee attacks. Permanent death (no respawn) and emits no kill events so the deathmatch scoreboard stays silent.",
    recommendedLayer: "NPC",
  },
  "npc-dialog": {
    description:
      "Friendly NPC: listens for the player-rpg E-key 'interact' event and pops a one-line speech bubble in the HUD. Configure the line via SceneEntity.npcLine; falls back to '...' if unset.",
    recommendedLayer: "NPC",
  },
  ally: {
    description:
      "Combat ally brain: seeks nearest hostile (enemy-deathmatch / enemy-rpg / boss), melee-fights them, soft-follows the player when idle. Ignores friendly fire from player.",
    recommendedLayer: "NPC",
  },
  neutral: {
    description:
      "Civilian ruleset: wanders peacefully until damaged, then retaliates against the attacker. No deathmatch scoring side-effects required.",
    recommendedLayer: "NPC",
  },
  vendor: {
    description:
      "Merchant: on player-rpg interact, emits npcDialog + vendorOpen with stock (default potions/ammo, or JSON array in npcLine).",
    recommendedLayer: "NPC",
  },
  boss: {
    description:
      "Boss strategy: 500 HP, heavy melee, never flees, enrages under 30% HP (speed+damage). Emits bossHealth / bossEnrage / bossDefeated.",
    recommendedLayer: "NPC",
  },
};
const listBuiltinBehaviorsHandler: ToolHandler = async () => {
  return {
    ok: true,
    data: {
      behaviors: (Object.keys(BUILTIN_BEHAVIORS) as Array<keyof typeof BUILTIN_BEHAVIORS>).map(
        (key) => ({
          key,
          description: BEHAVIOR_DOCS[key]?.description ?? "",
          recommendedLayer: BEHAVIOR_DOCS[key]?.recommendedLayer,
        }),
      ),
    },
  };
};

// ── list_script_templates ──────────────────────────────────────────────
const LIST_SCRIPT_TEMPLATES: ToolDef = {
  name: "list_script_templates",
  description:
    "List the built-in behavior templates the AI can scaffold from. Each template has a key, name, description, and parameter schema. Use create_script_from_template with a key from this list.",
  input_schema: { type: "object", properties: {} },
};
const listScriptTemplatesHandler: ToolHandler = async () => {
  return {
    ok: true,
    data: {
      templates: SCRIPT_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        params: t.params,
      })),
      builtinBehaviors: Object.keys(BUILTIN_BEHAVIORS),
    },
  };
};

// ── create_script_from_template ────────────────────────────────────────
const CREATE_SCRIPT_FROM_TEMPLATE: ToolDef = {
  name: "create_script_from_template",
  description:
    "Create a new project script from one of the built-in templates (see list_script_templates). Renders with the supplied params, validates the result, then POSTs to the server. Returns the new script's id and source — bind it with attach_script_to_entity.",
  input_schema: {
    type: "object",
    required: ["templateKey", "name"],
    properties: {
      templateKey: { type: "string", description: "Key from list_script_templates." },
      name: { type: "string", description: "Display name for the new script." },
      params: {
        type: "object",
        description: "Per-template parameter overrides.",
        additionalProperties: true,
      },
    },
  },
};
const createScriptFromTemplateHandler: ToolHandler = async (input) => {
  try {
    const projectId = activeProjectId();
    const key = String(input.templateKey ?? "");
    const tpl = getTemplate(key);
    if (!tpl) {
      return {
        ok: false,
        error: `Unknown template "${key}". Call list_script_templates for valid keys.`,
      };
    }
    const params = (input.params as Record<string, unknown>) ?? {};
    const code = tpl.render(params);
    const v = validateScript("js", code);
    if (!v.ok) {
      return {
        ok: false,
        error: `Template "${key}" produced invalid code: ${v.errors
          .map((e) => e.message)
          .join("; ")}`,
        data: { code, validation: v },
      };
    }
    const res = await fetch(apiUrl("scripts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: String(input.name ?? tpl.name),
        language: "js",
        code,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Create failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const created = (await res.json()) as { id: number; name: string };
    return {
      ok: true,
      data: {
        id: created.id,
        name: created.name,
        templateKey: key,
        bytes: code.length,
        code,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ── get_script_logs ────────────────────────────────────────────────────
const GET_SCRIPT_LOGS: ToolDef = {
  name: "get_script_logs",
  description:
    "Return the last N script-emitted console lines (newest last). Filter by scriptId or entityId to focus on one source — line metadata is captured at emit time so this is reliable even if the entity has since been renamed. Use this after asking the user to play the scene to verify a script is doing what you expect.",
  input_schema: {
    type: "object",
    properties: {
      scriptId: { type: "number" },
      entityId: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 30." },
      level: {
        type: "string",
        enum: ["error", "warn", "info", "all"],
        description: "Lower bound (error<warn<info<all). Default 'all'.",
      },
    },
  },
};
const getScriptLogsHandler: ToolHandler = async (input) => {
  const limit = Math.min(Math.max(1, Number(input.limit ?? 30)), 200);
  const sid = typeof input.scriptId === "number" ? input.scriptId : null;
  const eid = typeof input.entityId === "string" ? input.entityId : null;
  const level = (typeof input.level === "string" ? input.level : "all") as
    | "error"
    | "warn"
    | "info"
    | "all";
  const allow: Record<string, Set<string>> = {
    error: new Set(["error"]),
    warn: new Set(["error", "warn"]),
    info: new Set(["error", "warn", "info", "log"]),
    all: new Set(["error", "warn", "info", "log"]),
  };
  const allowed = allow[level] ?? allow.all;
  const all = useEditor.getState().consoleMessages;
  // Default behaviour: only return entries that came from a script (have
  // either a scriptId or entityId tag). Without that filter the AI would
  // be drowning in unrelated editor logs.
  const filtered = all.filter((m) => {
    if (!allowed.has(m.level)) return false;
    if (sid != null) return m.scriptId === sid;
    if (eid != null) return m.entityId === eid;
    return m.scriptId != null || m.entityId != null;
  });
  const tail = filtered.slice(-limit);
  return {
    ok: true,
    data: {
      total: filtered.length,
      returned: tail.length,
      messages: tail.map((m) => ({
        id: m.id,
        ts: m.ts,
        level: m.level,
        text: m.text,
        scriptId: m.scriptId ?? null,
        entityId: m.entityId ?? null,
      })),
    },
  };
};

// ── Bundled exports ────────────────────────────────────────────────────
export const defs: ToolDef[] = [
  GET_SCRIPT,
  LIST_SCRIPT_ATTACHMENTS,
  VALIDATE_SCRIPT,
  UPDATE_SCRIPT,
  PATCH_SCRIPT,
  DELETE_SCRIPT,
  ATTACH_SCRIPT_TO_ENTITY,
  DETACH_SCRIPT_FROM_ENTITY,
  REORDER_ENTITY_SCRIPTS,
  ATTACH_BEHAVIOR,
  DETACH_BEHAVIOR,
  LIST_BUILTIN_BEHAVIORS,
  LIST_SCRIPT_TEMPLATES,
  CREATE_SCRIPT_FROM_TEMPLATE,
  GET_SCRIPT_LOGS,
];

export const handlers: Record<string, ToolHandler> = {
  get_script: getScriptHandler,
  list_script_attachments: listScriptAttachmentsHandler,
  validate_script: validateScriptHandler,
  update_script: updateScriptHandler,
  patch_script: patchScriptHandler,
  delete_script: deleteScriptHandler,
  attach_script_to_entity: attachScriptToEntityHandler,
  detach_script_from_entity: detachScriptFromEntityHandler,
  reorder_entity_scripts: reorderEntityScriptsHandler,
  attach_behavior: attachBehaviorHandler,
  detach_behavior: detachBehaviorHandler,
  list_builtin_behaviors: listBuiltinBehaviorsHandler,
  list_script_templates: listScriptTemplatesHandler,
  create_script_from_template: createScriptFromTemplateHandler,
  get_script_logs: getScriptLogsHandler,
};

/** Tool names that mutate state / write to the API. The aiClient confirms
 *  these with the user before running them. */
export const destructiveToolNames: string[] = [
  "update_script",
  "patch_script",
  "delete_script",
  "create_script_from_template",
  "attach_behavior",
  "detach_behavior",
];
