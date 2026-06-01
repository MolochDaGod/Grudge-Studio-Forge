/**
 * Shipped example HUD screens.
 *
 * These seed the UI editor's "global" project bucket so a new user has
 * ready-made, editable 2D overlays that match the three shipped scene
 * templates (deathmatch / RTS / RPG). They use the same flat `Widget[]`
 * schema as user-authored screens, so once seeded they're indistinguishable
 * from hand-built screens — fully editable, exportable, and deletable.
 *
 * Seeding is one-shot, guarded by a localStorage flag, so deleting an
 * example screen sticks across reloads (we don't keep re-adding it). Bump
 * SEED_FLAG when shipping a new batch of examples.
 */
import type { UIScreen, Widget, WidgetType } from "./types";
import { WIDGET_DEFAULTS } from "./defaults";
import { useUIScreens } from "@/store/uiScreens";

/** Examples sort to the bottom of the screen list (user screens are newer). */
const EXAMPLE_TS = 1_000;

/** Compact widget factory — fills `w`/`h` from the type default when
 *  omitted and merges prop overrides over the type's default prop bag. */
function w(
  id: string,
  type: WidgetType,
  name: string,
  rect: { x: number; y: number; w?: number; h?: number },
  props: Record<string, unknown> = {},
): Widget {
  const def = WIDGET_DEFAULTS[type];
  return {
    id,
    type,
    name,
    x: rect.x,
    y: rect.y,
    w: rect.w ?? def.w,
    h: rect.h ?? def.h,
    props: { ...def.props, ...props },
  };
}

function screen(
  id: string,
  name: string,
  widgets: Widget[],
): UIScreen {
  return {
    id,
    name,
    width: 1920,
    height: 1080,
    theme: "grudge",
    widgets,
    updatedAt: EXAMPLE_TS,
  };
}

const DEATHMATCH_HUD = screen("example-dm-hud", "Deathmatch HUD", [
  w("dm-score", "text", "Score", { x: 820, y: 36, w: 280, h: 40 }, {
    content: "SCORE  0 / 10",
    size: "lg",
    align: "center",
    weight: 700,
    color: "#ffd34d",
  }),
  w("dm-reticle", "circle-button", "Reticle", { x: 944, y: 516, w: 32, h: 32 }, {
    glyph: "+",
    active: true,
  }),
  w("dm-vitals-panel", "panel", "Vitals", { x: 40, y: 920, w: 360, h: 120 }, {
    variant: "stone",
    rivets: true,
    padding: 14,
  }),
  w("dm-hp-label", "text", "Health Label", { x: 60, y: 938, w: 120, h: 24 }, {
    content: "HEALTH",
    size: "sm",
    weight: 600,
  }),
  w("dm-hp", "bar", "Health", { x: 60, y: 970, w: 320, h: 22 }, {
    kind: "hp",
    value: 100,
    showLabel: true,
    label: "HP",
  }),
  w("dm-ammo", "text", "Ammo", { x: 1620, y: 990, w: 260, h: 40 }, {
    content: "AMMO  30 / 120",
    size: "lg",
    align: "right",
    weight: 700,
    color: "#ffb43a",
  }),
  w("dm-hotbar", "hotbar", "Weapons", { x: 800, y: 992 }, {
    slots: 6,
    gap: 4,
    showKeys: true,
  }),
]);

const RTS_HUD = screen("example-rts-hud", "RTS HUD", [
  w("rts-res-panel", "panel", "Resources", { x: 600, y: 24, w: 720, h: 64 }, {
    variant: "dark",
    rivets: false,
    padding: 10,
  }),
  w("rts-gold", "text", "Gold", { x: 624, y: 40, w: 200, h: 32 }, {
    content: "⛁  Gold  0",
    size: "md",
    weight: 700,
    color: "#ffd34d",
  }),
  w("rts-wood", "text", "Wood", { x: 844, y: 40, w: 200, h: 32 }, {
    content: "🪵  Wood  0",
    size: "md",
    weight: 700,
    color: "#c8e6a0",
  }),
  w("rts-food", "text", "Food", { x: 1064, y: 40, w: 220, h: 32 }, {
    content: "🥖  Food  3 / 10",
    size: "md",
    weight: 700,
    color: "#f5e2c1",
  }),
  w("rts-minimap", "panel", "Minimap", { x: 1660, y: 760, w: 240, h: 240 }, {
    variant: "stone",
    rivets: true,
    padding: 8,
  }),
  w("rts-command-panel", "panel", "Command Card", { x: 760, y: 900, w: 400, h: 150 }, {
    variant: "stone",
    rivets: true,
    padding: 12,
  }),
  w("rts-cmd-build", "circle-button", "Build", { x: 790, y: 930, w: 44, h: 44 }, {
    glyph: "🔨",
    active: false,
    keyHint: "B",
  }),
  w("rts-cmd-attack", "circle-button", "Attack", { x: 850, y: 930, w: 44, h: 44 }, {
    glyph: "⚔",
    active: false,
    keyHint: "A",
  }),
  w("rts-cmd-gather", "circle-button", "Gather", { x: 910, y: 930, w: 44, h: 44 }, {
    glyph: "⛏",
    active: false,
    keyHint: "G",
  }),
]);

const RPG_HUD = screen("example-rpg-hud", "RPG HUD", [
  w("rpg-vitals-panel", "panel", "Vitals", { x: 40, y: 900, w: 380, h: 140 }, {
    variant: "stone",
    rivets: true,
    padding: 14,
  }),
  w("rpg-hp", "bar", "Health", { x: 60, y: 922, w: 340, h: 22 }, {
    kind: "hp",
    value: 100,
    showLabel: true,
    label: "HP",
  }),
  w("rpg-mp", "bar", "Mana", { x: 60, y: 958, w: 340, h: 22 }, {
    kind: "mp",
    value: 60,
    showLabel: true,
    label: "MP",
  }),
  w("rpg-xp", "bar", "Experience", { x: 560, y: 1040, w: 800, h: 14 }, {
    kind: "xp",
    value: 35,
    showLabel: false,
  }),
  w("rpg-quest-panel", "panel", "Quest", { x: 1500, y: 40, w: 380, h: 120 }, {
    variant: "ghost",
    rivets: false,
    padding: 14,
  }),
  w("rpg-quest-title", "text", "Quest Title", { x: 1520, y: 58, w: 340, h: 26 }, {
    content: "QUEST",
    size: "sm",
    weight: 700,
    color: "#ffd34d",
  }),
  w("rpg-quest-body", "text", "Quest Body", { x: 1520, y: 90, w: 340, h: 56 }, {
    content: "Explore the village and speak with the elders.",
    size: "md",
    weight: 400,
  }),
  w("rpg-hotbar", "hotbar", "Abilities", { x: 760, y: 992 }, {
    slots: 8,
    gap: 4,
    showKeys: true,
  }),
]);

export const EXAMPLE_SCREENS: readonly UIScreen[] = [
  DEATHMATCH_HUD,
  RTS_HUD,
  RPG_HUD,
];

const SEED_FLAG = "grudge.ui.examples.seeded.v1";

/** Seed the example HUD screens into the "global" project bucket once.
 *  Idempotent + one-shot: guarded by a localStorage flag so a user who
 *  deletes an example doesn't see it reappear on the next reload. The
 *  zustand persist store rehydrates synchronously before this runs, so
 *  reading `byProject` here sees any previously-persisted screens. */
export function seedExampleScreens(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(SEED_FLAG)) return;
  } catch {
    // localStorage blocked (private mode) — skip seeding silently.
    return;
  }

  const key = "global";
  useUIScreens.setState((s) => {
    const existing = s.byProject[key] ?? [];
    const existingIds = new Set(existing.map((sc) => sc.id));
    const missing = EXAMPLE_SCREENS.filter((sc) => !existingIds.has(sc.id)).map(
      (sc) => ({ ...sc, widgets: sc.widgets.map((wg) => ({ ...wg })) }),
    );
    if (missing.length === 0) return s;
    return {
      byProject: { ...s.byProject, [key]: [...existing, ...missing] },
    };
  });

  try {
    window.localStorage.setItem(SEED_FLAG, "1");
  } catch {
    // ignore — worst case we re-seed missing screens next load.
  }
}
