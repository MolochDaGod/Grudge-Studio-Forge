/**
 * AI tools for the StatsComponent system.
 *
 * Exposes `set_entity_stats`, `get_entity_stats`, and `remove_entity_stats`
 * so the AI assistant can configure per-entity RPG stats (8 attributes +
 * level + xp) and inspect the derived stat block (computed by the
 * `resolveStats` resolver from `scene-schema`).
 */

import { useEditor } from "@/store/editor";
import {
  ATTRIBUTES,
  ATTRIBUTE_LABELS,
  DERIVED_STATS,
  DEFAULT_STATS,
  resolveStats,
  type Attribute,
  type StatsComponent,
} from "@workspace/scene-schema";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

// ── set_entity_stats ────────────────────────────────────────────────────
const SET_ENTITY_STATS: ToolDef = {
  name: "set_entity_stats",
  description:
    "Set or update the RPG stats component on an entity. Provide any subset of the 8 base attributes (STR, DEX, INT, VIT, WIS, LCK, CHA, END — 0–100 each), plus optional level and xp. Missing attributes default to 10. Call get_entity_stats afterwards to see the resolved derived stats. If the entity already has stats, the provided fields are merged on top.",
  input_schema: {
    type: "object",
    required: ["entityId"],
    properties: {
      entityId: { type: "string" },
      base: {
        type: "object",
        description:
          "Partial map of attribute → value (0–100). E.g. {\"STR\":25,\"VIT\":30}. Attributes not listed keep their current value (or default 10 on first set).",
        properties: Object.fromEntries(
          ATTRIBUTES.map((a) => [
            a,
            { type: "number", description: ATTRIBUTE_LABELS[a] },
          ]),
        ),
      },
      level: { type: "number", description: "Entity level (≥ 1)." },
      xp: { type: "number", description: "Accumulated XP (≥ 0)." },
    },
  },
};

const setEntityStatsHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const s = useEditor.getState();
  const ent = s.sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };

  const existing: StatsComponent = ent.stats
    ? JSON.parse(JSON.stringify(ent.stats))
    : { ...DEFAULT_STATS, base: { ...DEFAULT_STATS.base } };

  // Merge base attributes
  if (input.base && typeof input.base === "object") {
    const b = input.base as Record<string, unknown>;
    for (const a of ATTRIBUTES) {
      if (typeof b[a] === "number") {
        existing.base[a] = Math.max(0, Math.min(100, Math.round(b[a] as number)));
      }
    }
  }
  if (typeof input.level === "number") {
    existing.level = Math.max(1, Math.round(input.level as number));
  }
  if (typeof input.xp === "number") {
    existing.xp = Math.max(0, Math.round(input.xp as number));
  }

  s.cmdSetEntityStats(id, existing);

  const resolved = resolveStats(existing);
  return {
    ok: true,
    data: {
      entityId: id,
      stats: existing,
      derived: resolved.derived,
    },
  };
};

// ── get_entity_stats ────────────────────────────────────────────────────
const GET_ENTITY_STATS: ToolDef = {
  name: "get_entity_stats",
  description:
    "Read the full stats block for an entity: base attributes, level, xp, and the computed derived stats (maxHealth, armor, critChance, moveSpeed, etc.). Returns null when the entity has no stats component.",
  input_schema: {
    type: "object",
    required: ["entityId"],
    properties: {
      entityId: { type: "string" },
    },
  },
};

const getEntityStatsHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const ent = useEditor
    .getState()
    .sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };
  if (!ent.stats) {
    return { ok: true, data: { entityId: id, stats: null, derived: null } };
  }
  const resolved = resolveStats(ent.stats);
  return {
    ok: true,
    data: {
      entityId: id,
      stats: ent.stats,
      derived: resolved.derived,
      attributes: resolved.attributes,
      level: resolved.level,
      xp: resolved.xp,
    },
  };
};

// ── remove_entity_stats ─────────────────────────────────────────────────
const REMOVE_ENTITY_STATS: ToolDef = {
  name: "remove_entity_stats",
  description:
    "Remove the stats component from an entity, reverting it to a stat-less entity.",
  input_schema: {
    type: "object",
    required: ["entityId"],
    properties: {
      entityId: { type: "string" },
    },
  },
};

const removeEntityStatsHandler: ToolHandler = async (input) => {
  const id = String(input.entityId ?? "");
  const s = useEditor.getState();
  const ent = s.sceneData.entities.find((e) => e.id === id);
  if (!ent) return { ok: false, error: `No entity with id "${id}".` };
  if (!ent.stats) return { ok: true, data: { entityId: id, removed: false } };
  s.cmdSetEntityStats(id, null);
  return { ok: true, data: { entityId: id, removed: true } };
};

// ── Exports ─────────────────────────────────────────────────────────────

export const defs: ToolDef[] = [
  SET_ENTITY_STATS,
  GET_ENTITY_STATS,
  REMOVE_ENTITY_STATS,
];

export const handlers: Record<string, ToolHandler> = {
  set_entity_stats: setEntityStatsHandler,
  get_entity_stats: getEntityStatsHandler,
  remove_entity_stats: removeEntityStatsHandler,
};

/** `set_entity_stats` mutates the scene — flag it destructive so the
 *  AI client asks the user to confirm before running. `get` and
 *  `remove` are safe enough to not need confirmation. */
export const destructiveToolNames: string[] = ["set_entity_stats"];
