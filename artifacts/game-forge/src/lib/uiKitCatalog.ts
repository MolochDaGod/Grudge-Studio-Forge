/**
 * Professional game UI kits — mirrors https://ui.grudge-studio.com
 *
 * The external UI kit is the visual editor for Fantasy / Cyberpunk / FPS / RPG
 * HUDs. Forge consumes its themes as `Environment.uiKit` and local textures
 * from `/ui/rpg-mmo/` (see uiAssets.ts).
 */

export const UI_KIT_SITE = "https://ui.grudge-studio.com";

export type UiKitTheme = "fantasy" | "cyberpunk" | "fps" | "rpg";

export type UiLayerId =
  | "hud-root"
  | "unit-frame"
  | "action-bar"
  | "minimap"
  | "chat"
  | "quest-tracker"
  | "inventory"
  | "shop"
  | "skill-tree"
  | "notifications"
  | "crosshair"
  | "scoreboard"
  | "cast-bar"
  | "nameplate"
  | "lobby";

export interface UiLayerDef {
  id: UiLayerId;
  label: string;
  description: string;
  /** Typical z-order (lower = behind). */
  z: number;
  /** Local texture roots under /ui/rpg-mmo when available. */
  localAssets?: string[];
}

export interface UiKitDef {
  theme: UiKitTheme;
  label: string;
  description: string;
  /** Open this on ui.grudge-studio.com for full visual design. */
  designUrl: string;
  /** Default layer stack for this kit. */
  defaultLayers: UiLayerId[];
  /** Suggested CSS/theme accents for PlayHUD. */
  accent: string;
  skyHint?: string;
  fonts: string[];
}

/** All professional HUD layers the agent can compose. */
export const UI_LAYERS: UiLayerDef[] = [
  {
    id: "hud-root",
    label: "HUD Root",
    description: "Full-screen overlay shell — frames, vignette, safe-area.",
    z: 0,
    localAssets: ["General/General_Background.png"],
  },
  {
    id: "unit-frame",
    label: "Unit Frame",
    description: "Player / party HP+MP frames, level badge, role icons.",
    z: 10,
    localAssets: ["Unit Frames/"],
  },
  {
    id: "action-bar",
    label: "Action Bar",
    description: "Hotbar slots, cooldowns, consumable buttons.",
    z: 20,
    localAssets: ["Action Bar/", "Action Buttons/"],
  },
  {
    id: "cast-bar",
    label: "Cast Bar",
    description: "Spell cast progress under the player.",
    z: 25,
    localAssets: ["Cast Bar/"],
  },
  {
    id: "minimap",
    label: "Minimap",
    description: "Corner radar / map with markers.",
    z: 15,
    localAssets: ["Minimap/"],
  },
  {
    id: "chat",
    label: "Chat",
    description: "Combat log / party chat panel.",
    z: 30,
    localAssets: ["Chat/"],
  },
  {
    id: "quest-tracker",
    label: "Quest Tracker",
    description: "Right-side objective list with checkboxes.",
    z: 18,
    localAssets: ["Quest Tracker/"],
  },
  {
    id: "inventory",
    label: "Inventory",
    description: "Bags, equipment slots, item tooltips.",
    z: 40,
    localAssets: ["Windows/", "Icon slots/"],
  },
  {
    id: "shop",
    label: "Shop / Vendor",
    description: "Merchant buy/sell UI — pair with vendor behavior.",
    z: 45,
    localAssets: ["Windows/"],
  },
  {
    id: "skill-tree",
    label: "Skill Tree",
    description: "Talent / ability unlock graph panel.",
    z: 42,
    localAssets: ["Windows/"],
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Toasts, loot, achievement popups.",
    z: 50,
    localAssets: ["Notifications/"],
  },
  {
    id: "crosshair",
    label: "Crosshair",
    description: "FPS/TPS reticle center screen.",
    z: 60,
  },
  {
    id: "scoreboard",
    label: "Scoreboard",
    description: "Deathmatch / PvP score strip.",
    z: 55,
  },
  {
    id: "nameplate",
    label: "Nameplates",
    description: "World-space or screen-space name + HP plates.",
    z: 12,
    localAssets: ["Nameplate/"],
  },
  {
    id: "lobby",
    label: "Lobby / Character Select",
    description: "Pre-game lobby chrome (character create, hero select).",
    z: 5,
    localAssets: ["Lobby/"],
  },
];

export const UI_KITS: UiKitDef[] = [
  {
    theme: "fantasy",
    label: "Fantasy HUD",
    description:
      "Ornate RPG frames, cast bars, quest tracker — classic MMO look. Design on the UI kit site under Fantasy.",
    designUrl: `${UI_KIT_SITE}/?theme=fantasy`,
    defaultLayers: [
      "hud-root",
      "unit-frame",
      "action-bar",
      "cast-bar",
      "minimap",
      "quest-tracker",
      "chat",
      "notifications",
      "crosshair",
    ],
    accent: "#d4af37",
    skyHint: "#1a1320",
    fonts: ["Cinzel", "EB Garamond", "Rajdhani"],
  },
  {
    theme: "rpg",
    label: "RPG / MMO Kit",
    description:
      "Full craftpix RPG pack already bundled in Forge (/ui/rpg-mmo). Unit frames, action bar, inventory, shop.",
    designUrl: `${UI_KIT_SITE}/?theme=rpg`,
    defaultLayers: [
      "hud-root",
      "unit-frame",
      "action-bar",
      "minimap",
      "inventory",
      "shop",
      "quest-tracker",
      "notifications",
      "nameplate",
    ],
    accent: "#c9a227",
    skyHint: "#0c0a1a",
    fonts: ["Rajdhani", "Cinzel"],
  },
  {
    theme: "cyberpunk",
    label: "Cyberpunk HUD",
    description:
      "Neon edges, angular panels, tactical minimap — matches deathmatch cyber maps. Theme on UI kit site.",
    designUrl: `${UI_KIT_SITE}/?theme=cyberpunk`,
    defaultLayers: [
      "hud-root",
      "unit-frame",
      "action-bar",
      "minimap",
      "scoreboard",
      "crosshair",
      "notifications",
    ],
    accent: "#00e5ff",
    skyHint: "#0a0a14",
    fonts: ["Oxanium", "Rajdhani", "Space Grotesk"],
  },
  {
    theme: "fps",
    label: "FPS / Tactical HUD",
    description:
      "Minimal reticle, ammo strip, hit markers, scoreboard — for deathmatch / arena.",
    designUrl: `${UI_KIT_SITE}/?theme=fps`,
    defaultLayers: ["crosshair", "unit-frame", "scoreboard", "notifications"],
    accent: "#ef4444",
    skyHint: "#0d0d10",
    fonts: ["Rajdhani", "Space Grotesk"],
  },
];

export function getUiKit(theme: string | undefined | null): UiKitDef {
  return UI_KITS.find((k) => k.theme === theme) ?? UI_KITS[1]!;
}

export function getUiLayer(id: string): UiLayerDef | undefined {
  return UI_LAYERS.find((l) => l.id === id);
}
