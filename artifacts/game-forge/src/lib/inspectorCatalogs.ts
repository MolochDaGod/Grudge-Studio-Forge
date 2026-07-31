/**
 * Shared catalogs for Inspector dropdowns, Scripts panel, and AI tools.
 *
 * SSOT rule: every BehaviorKind / smart template / game profile shown in the
 * UI must come from here (or re-export deathmatchBehaviors / gameDeployments).
 * Do not hardcode parallel option lists in Inspector.tsx.
 */

import type { BehaviorKind, LayerName } from "@/scene/types";
import {
  BEHAVIOR_DEFAULT_LAYERS,
  BUILTIN_BEHAVIORS,
  FACTION_RULESETS,
} from "@/lib/deathmatchBehaviors";
import { SCRIPT_TEMPLATES } from "@/ai/tools/scripting/templates";
import {
  FLEET_GAME_DEFS,
  type FleetGameDef,
} from "@/lib/gameDeployments";

export type BehaviorGroup =
  | "match"
  | "player"
  | "combat"
  | "rts"
  | "world"
  | "other";

export interface BehaviorCatalogEntry {
  key: BehaviorKind;
  label: string;
  group: BehaviorGroup;
  description: string;
  recommendedLayer: LayerName | null;
}

const GROUP_ORDER: BehaviorGroup[] = [
  "match",
  "player",
  "combat",
  "rts",
  "world",
  "other",
];

const GROUP_LABELS: Record<BehaviorGroup, string> = {
  match: "Match / GameManager",
  player: "Player",
  combat: "Combat AI",
  rts: "RTS (Wargus)",
  world: "World / Interact",
  other: "Other",
};

/** Human docs for every built-in behavior (Inspector + AI list_builtin). */
export const BEHAVIOR_DOCS: Record<
  BehaviorKind,
  { description: string; group: BehaviorGroup; label?: string }
> = {
  "gamemode-deathmatch": {
    label: "GameManager — Deathmatch",
    group: "match",
    description:
      "Score tracker for player vs enemy kills; win/lose at scoreLimit. Attach to empty named GameManager.",
  },
  "gamemode-rts": {
    label: "GameManager — RTS",
    group: "match",
    description:
      "RTS match: selection, orders, gold/wood/food, production, enemy AI, win/lose. Attach to GameManager empty.",
  },
  "player-deathmatch": {
    label: "Player — Deathmatch",
    group: "player",
    description:
      "LMB shoot, health, damage, respawn. Pair with controller third/first person.",
  },
  "player-rpg": {
    label: "Player — RPG",
    group: "player",
    description:
      "Melee + E interact, permanent death. Pair with enemy-rpg / vendor / npc-dialog.",
  },
  "rts-peon": {
    label: "RTS — Peon / Worker",
    group: "rts",
    description: "Gather gold/wood, deposit at Town Hall. Select + right-click resources.",
  },
  "rts-footman": {
    label: "RTS — Footman",
    group: "rts",
    description: "Melee unit: move/attack orders, auto-engage hostiles.",
  },
  "rts-archer": {
    label: "RTS — Archer",
    group: "rts",
    description: "Ranged unit: keep distance, attack under orders or auto-engage.",
  },
  "rts-creep": {
    label: "RTS — Creep",
    group: "rts",
    description: "Neutral camp guard; aggro + gold bounty on death.",
  },
  "rts-building": {
    label: "RTS — Building",
    group: "rts",
    description: "Town Hall / Barracks / Farm / Mill production + rally.",
  },
  "rts-tower": {
    label: "RTS — Tower",
    group: "rts",
    description: "Defensive tower auto-attacks hostiles.",
  },
  "enemy-deathmatch": {
    label: "Enemy — Deathmatch",
    group: "combat",
    description: "Yuka AI patrol/chase/attack/flee with LOS and group alerts.",
  },
  "enemy-rpg": {
    label: "Enemy — RPG",
    group: "combat",
    description: "Wander until provoked; chase + melee; permanent death.",
  },
  ally: {
    label: "Ally",
    group: "combat",
    description: "Fights hostiles; soft-follows player when idle.",
  },
  boss: {
    label: "Boss",
    group: "combat",
    description: "High HP, heavy melee, enrage under 30%. Emits boss* events.",
  },
  neutral: {
    label: "Neutral civilian",
    group: "world",
    description: "Wanders until damaged, then retaliates.",
  },
  vendor: {
    label: "Vendor",
    group: "world",
    description: "On interact: dialog + vendorOpen stock.",
  },
  "npc-dialog": {
    label: "NPC Dialog",
    group: "world",
    description: "Speech bubble on player-rpg E interact (npcLine).",
  },
  spawnpoint: {
    label: "Spawn Point",
    group: "world",
    description: "Marker for player/enemy respawn and map gen.",
  },
  "pickup-trigger": {
    label: "Pickup Trigger",
    group: "world",
    description: "Despawn on Player-layer overlap. Use Trigger layer (sensor).",
  },
};

function humanizeKey(key: string): string {
  return key
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Flat list for dropdowns / AI — always in group order. */
export function behaviorCatalog(): BehaviorCatalogEntry[] {
  const keys = Object.keys(BUILTIN_BEHAVIORS) as BehaviorKind[];
  const entries = keys.map((key) => {
    const doc = BEHAVIOR_DOCS[key];
    return {
      key,
      label: doc?.label ?? humanizeKey(key),
      group: doc?.group ?? ("other" as BehaviorGroup),
      description: doc?.description ?? "",
      recommendedLayer: BEHAVIOR_DEFAULT_LAYERS[key] ?? null,
    };
  });
  return entries.sort((a, b) => {
    const gi = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (gi !== 0) return gi;
    return a.label.localeCompare(b.label);
  });
}

/** Options for Select, with group headers as disabled items via label prefix. */
export function behaviorSelectGroups(): {
  group: BehaviorGroup;
  label: string;
  items: BehaviorCatalogEntry[];
}[] {
  const all = behaviorCatalog();
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: all.filter((e) => e.group === group),
  })).filter((g) => g.items.length > 0);
}

export type GameProfileId = keyof typeof FACTION_RULESETS | "rts";

export interface GameProfileOption {
  id: string;
  label: string;
  description: string;
  /** Behaviors typically required */
  behaviors: string[];
  /** Suggest empty named GameManager + this behavior */
  gameManagerBehavior?: BehaviorKind;
}

/** Game profiles for Inspector “Game mode” dropdown (from FACTION_RULESETS). */
export function gameProfileOptions(): GameProfileOption[] {
  return Object.values(FACTION_RULESETS).map((r) => {
    const gameManagerBehavior: BehaviorKind | undefined =
      r.id === "deathmatch"
        ? "gamemode-deathmatch"
        : r.id === "rts"
          ? "gamemode-rts"
          : undefined;
    return {
      id: r.id,
      label: r.id === "rts" ? "RTS / Wargus" : humanizeKey(r.id),
      description: r.description,
      behaviors: [
        ...(gameManagerBehavior ? [gameManagerBehavior] : []),
        ...r.player,
        ...r.hostile,
        ...r.friendly,
      ],
      gameManagerBehavior,
    };
  });
}

/** Smart script templates promoted in Scripts + Inspector. */
export const SMART_SCRIPT_TEMPLATE_KEYS = [
  "wasd-character-controller",
  "third-person-camera",
  "network-manager-mirror",
  "remote-player-interpolator",
  "outline-select-highlight",
  "spawn-r2-character",
  "health-system",
  "seek-player",
  "trigger-zone",
  "resource-node",
  "spin",
] as const;

export type ScriptTemplateGroup =
  | "character"
  | "camera"
  | "network"
  | "combat"
  | "rts"
  | "world"
  | "utility";

const TEMPLATE_GROUP: Record<string, ScriptTemplateGroup> = {
  "wasd-character-controller": "character",
  "third-person-camera": "camera",
  "network-manager-mirror": "network",
  "remote-player-interpolator": "network",
  "outline-select-highlight": "combat",
  "spawn-r2-character": "character",
  "health-system": "combat",
  "seek-player": "combat",
  "damage-on-touch": "combat",
  "weapon-equip": "combat",
  "weapon-pickup-swap": "combat",
  "projectile-launcher": "combat",
  "trigger-zone": "world",
  "pickup-trigger": "world",
  "resource-node": "rts",
  "patrol-waypoints": "world",
  "day-night-cycle": "world",
  "quest-objective": "world",
  "inventory-pickup": "world",
  spin: "utility",
  "bob-hover": "utility",
  "orbit-point": "utility",
  "physics-impulse": "utility",
  "ground-follow": "utility",
  "uv-scroll": "utility",
  "camera-shake": "camera",
  wander: "utility",
  "log-on-collision": "utility",
};

export function scriptTemplateCatalog(opts?: { smartOnly?: boolean }) {
  const smart = new Set<string>(SMART_SCRIPT_TEMPLATE_KEYS);
  return SCRIPT_TEMPLATES.filter((t) =>
    opts?.smartOnly ? smart.has(t.key) : true,
  ).map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    group: TEMPLATE_GROUP[t.key] ?? ("utility" as ScriptTemplateGroup),
    smart: smart.has(t.key),
    params: t.params,
  }));
}

export function fleetGameCatalog(): FleetGameDef[] {
  return FLEET_GAME_DEFS.filter((g) => g.status === "active");
}

export function getBehaviorEntry(
  key: string | undefined | null,
): BehaviorCatalogEntry | undefined {
  if (!key) return undefined;
  return behaviorCatalog().find((e) => e.key === key);
}
