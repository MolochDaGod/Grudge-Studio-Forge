/**
 * Professional game UI tools — powered by https://ui.grudge-studio.com
 *
 * Gives the AI Worker a first-class way to:
 *   - List kits (fantasy / cyberpunk / fps / rpg)
 *   - Compose HUD layer stacks
 *   - Apply themes to Environment.uiKit (PlayHUD consumes)
 *   - Browse the remote UI kit site for design guidance
 *   - List local /ui/rpg-mmo texture roots
 */
import { useEditor } from "@/store/editor";
import {
  UI_KIT_SITE,
  UI_KITS,
  UI_LAYERS,
  getUiKit,
  getUiLayer,
  type UiKitTheme,
  type UiLayerId,
} from "@/lib/uiKitCatalog";
import { UI } from "@/lib/uiAssets";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const THEMES: UiKitTheme[] = ["fantasy", "cyberpunk", "fps", "rpg"];

// ── list_ui_kits ─────────────────────────────────────────────────────

const LIST_UI_KITS: ToolDef = {
  name: "list_ui_kits",
  description:
    "List professional game UI kits from Grudge Studio UI " +
    `(${UI_KIT_SITE}). Themes: fantasy, cyberpunk, fps, rpg. ` +
    "Each kit has default HUD layers and a designUrl to open the visual editor. " +
    "Use apply_ui_kit to stamp a theme onto the scene for Play mode.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const listUiKitsHandler: ToolHandler = async () => ({
  ok: true,
  data: {
    site: UI_KIT_SITE,
    kits: UI_KITS.map((k) => ({
      theme: k.theme,
      label: k.label,
      description: k.description,
      designUrl: k.designUrl,
      defaultLayers: k.defaultLayers,
      accent: k.accent,
      fonts: k.fonts,
    })),
    tip: `Open ${UI_KIT_SITE} to visually design HUDs, then apply_ui_kit({ theme }) in Forge.`,
  },
});

// ── list_ui_layers ───────────────────────────────────────────────────

const LIST_UI_LAYERS: ToolDef = {
  name: "list_ui_layers",
  description:
    "List professional HUD layer ids (unit-frame, action-bar, minimap, chat, inventory, shop, …) " +
    "used to compose production UI stacks. Pair with apply_ui_kit layers array. " +
    "Local textures live under /ui/rpg-mmo/ (craftpix RPG pack).",
  input_schema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Optional single layer id for detail.",
      },
    },
    additionalProperties: false,
  },
};

const listUiLayersHandler: ToolHandler = async (input) => {
  if (typeof input.id === "string" && input.id.trim()) {
    const layer = getUiLayer(input.id.trim());
    if (!layer) {
      return {
        ok: false,
        error: `Unknown layer "${input.id}". Valid: ${UI_LAYERS.map((l) => l.id).join(", ")}`,
      };
    }
    return { ok: true, data: { layer, site: UI_KIT_SITE } };
  }
  return {
    ok: true,
    data: {
      site: UI_KIT_SITE,
      layers: UI_LAYERS,
      localRoot: "/ui/rpg-mmo/",
    },
  };
};

// ── list_ui_assets ───────────────────────────────────────────────────

const LIST_UI_ASSETS: ToolDef = {
  name: "list_ui_assets",
  description:
    "List local professional UI texture groups bundled in Forge (unitFrame, actionBar, minimap, chat, windows, …). " +
    "Paths are under /ui/rpg-mmo/. For full theme editing open ui.grudge-studio.com.",
  input_schema: {
    type: "object",
    properties: {
      group: {
        type: "string",
        description:
          "Optional group key: general, unitFrame, actionBar, minimap, chat, windows, lobby, …",
      },
    },
    additionalProperties: false,
  },
};

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object") {
    return typeof obj === "string" ? [prefix] : [];
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(`${p} → ${v}`);
    else out.push(...flattenKeys(v, p));
  }
  return out;
}

const listUiAssetsHandler: ToolHandler = async (input) => {
  const group = typeof input.group === "string" ? input.group.trim() : "";
  if (group) {
    const g = (UI as Record<string, unknown>)[group];
    if (!g) {
      return {
        ok: false,
        error: `Unknown group "${group}". Keys: ${Object.keys(UI).join(", ")}`,
      };
    }
    return {
      ok: true,
      data: {
        group,
        assets: flattenKeys(g).slice(0, 80),
        site: UI_KIT_SITE,
      },
    };
  }
  return {
    ok: true,
    data: {
      site: UI_KIT_SITE,
      groups: Object.keys(UI),
      sample: {
        unitFrameAvatarBorder: UI.unitFrame.avatar.border,
        actionBarBg: (UI.actionBar as { background?: string }).background,
        generalBg: UI.general.background,
      },
      tip: "Use list_ui_assets({ group: 'unitFrame' }) for paths. Design full kits at ui.grudge-studio.com.",
    },
  };
};

// ── apply_ui_kit ─────────────────────────────────────────────────────

const APPLY_UI_KIT: ToolDef = {
  name: "apply_ui_kit",
  description:
    "Apply a professional UI kit theme + HUD layer stack to the scene (Environment.uiKit). " +
    "Themes from ui.grudge-studio.com: fantasy | cyberpunk | fps | rpg. " +
    "Optional layers[] override the default stack; accent/fontScale/designUrl supported. " +
    "PlayHUD reads this for theming. Also opens design guidance URL in the result. Undoable via environment command.",
  input_schema: {
    type: "object",
    properties: {
      theme: {
        type: "string",
        enum: THEMES,
        description: "UI kit theme. Default rpg.",
      },
      layers: {
        type: "array",
        items: { type: "string" },
        description: "HUD layer ids to enable (see list_ui_layers).",
      },
      fontScale: { type: "number", description: "Font scale, default 1." },
      accent: { type: "string", description: "Hex accent color." },
      designUrl: {
        type: "string",
        description: "Optional link to a saved design on ui.grudge-studio.com.",
      },
      applySkyAccent: {
        type: "boolean",
        description:
          "If true, lightly tint environment.skyColor toward the kit mood. Default false.",
      },
    },
    additionalProperties: false,
  },
};

const applyUiKitHandler: ToolHandler = async (input) => {
  const themeRaw =
    typeof input.theme === "string" && THEMES.includes(input.theme as UiKitTheme)
      ? (input.theme as UiKitTheme)
      : "rpg";
  const kit = getUiKit(themeRaw);

  let layers: UiLayerId[] = kit.defaultLayers;
  if (Array.isArray(input.layers) && input.layers.length > 0) {
    const valid = new Set(UI_LAYERS.map((l) => l.id));
    const picked = input.layers.filter(
      (l): l is UiLayerId => typeof l === "string" && valid.has(l as UiLayerId),
    );
    if (picked.length) layers = picked;
  }

  const fontScale =
    typeof input.fontScale === "number" && Number.isFinite(input.fontScale)
      ? Math.max(0.5, Math.min(2, input.fontScale))
      : 1;
  const accent =
    typeof input.accent === "string" && input.accent.trim()
      ? input.accent.trim()
      : kit.accent;
  const designUrl =
    typeof input.designUrl === "string" && input.designUrl.trim()
      ? input.designUrl.trim()
      : kit.designUrl;

  const patch: Record<string, unknown> = {
    uiKit: {
      theme: kit.theme,
      layers,
      fontScale,
      accent,
      designUrl,
    },
  };
  if (input.applySkyAccent === true && kit.skyHint) {
    patch.skyColor = kit.skyHint;
  }

  useEditor.getState().cmdSetEnvironment(patch, `UI kit: ${kit.label}`);
  useEditor.getState().pushLog(
    "info",
    `UI kit applied: ${kit.label} (${layers.length} layers). Design: ${designUrl}`,
  );

  return {
    ok: true,
    data: {
      theme: kit.theme,
      label: kit.label,
      layers,
      accent,
      fontScale,
      designUrl,
      site: UI_KIT_SITE,
      localAssetsRoot: "/ui/rpg-mmo/",
      next: [
        `Open ${designUrl} to refine the HUD visually`,
        "Press Play to see themed PlayHUD",
        "list_ui_assets({ group: 'unitFrame' }) for texture paths",
      ],
    },
  };
};

// ── browse_ui_kit ────────────────────────────────────────────────────

const BROWSE_UI_KIT: ToolDef = {
  name: "browse_ui_kit",
  description:
    "Fetch guidance / page text from https://ui.grudge-studio.com for professional UI design. " +
    "Use when building HUDs, inventories, shops, skill trees. Returns design tips + kit metadata. " +
    "Does not replace apply_ui_kit — browse for research, apply to stamp the scene.",
  input_schema: {
    type: "object",
    properties: {
      theme: {
        type: "string",
        enum: THEMES,
        description: "Optional theme focus.",
      },
      path: {
        type: "string",
        description: "Optional path on the UI site (default /).",
      },
    },
    additionalProperties: false,
  },
};

const browseUiKitHandler: ToolHandler = async (input) => {
  const theme =
    typeof input.theme === "string" && THEMES.includes(input.theme as UiKitTheme)
      ? (input.theme as UiKitTheme)
      : null;
  const kit = theme ? getUiKit(theme) : null;
  const path =
    typeof input.path === "string" && input.path.startsWith("/")
      ? input.path
      : "/";
  const url = `${UI_KIT_SITE}${path}${theme ? (path.includes("?") ? "&" : "?") + `theme=${theme}` : ""}`;

  let pageText: string | null = null;
  try {
    const r = await fetch(url, {
      headers: {
        Accept: "text/html,text/plain,*/*",
        "User-Agent": "Grudge-Studio-Forge-AI-Worker",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) {
      const raw = await r.text();
      pageText = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000);
    }
  } catch {
    pageText = null;
  }

  return {
    ok: true,
    data: {
      url,
      site: UI_KIT_SITE,
      kit: kit
        ? {
            theme: kit.theme,
            label: kit.label,
            description: kit.description,
            defaultLayers: kit.defaultLayers,
            designUrl: kit.designUrl,
          }
        : null,
      pageExcerpt: pageText,
      guidance: [
        "ui.grudge-studio.com is the visual Game UI Kit (Fantasy / Cyberpunk / FPS / RPG).",
        "Design HUDs there, then apply_ui_kit({ theme }) in Forge so PlayHUD uses the stack.",
        "Local production textures: /ui/rpg-mmo/ via list_ui_assets.",
        "Puter sign-in on the UI site enables cloud save of UI designs.",
      ],
    },
  };
};

// ── get_ui_kit_status ────────────────────────────────────────────────

const GET_UI_KIT_STATUS: ToolDef = {
  name: "get_ui_kit_status",
  description:
    "Read the scene's current Environment.uiKit (theme, layers, accent) and whether local UI textures are available.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const getUiKitStatusHandler: ToolHandler = async () => {
  const env = useEditor.getState().sceneData.environment;
  const uiKit = env.uiKit ?? null;
  const kit = uiKit?.theme ? getUiKit(uiKit.theme) : null;
  return {
    ok: true,
    data: {
      current: uiKit,
      kit,
      site: UI_KIT_SITE,
      localRoot: "/ui/rpg-mmo/",
      groups: Object.keys(UI),
    },
  };
};

// ── exports ──────────────────────────────────────────────────────────

export const defs: ToolDef[] = [
  LIST_UI_KITS,
  LIST_UI_LAYERS,
  LIST_UI_ASSETS,
  APPLY_UI_KIT,
  BROWSE_UI_KIT,
  GET_UI_KIT_STATUS,
];

export const handlers: Record<string, ToolHandler> = {
  list_ui_kits: listUiKitsHandler,
  list_ui_layers: listUiLayersHandler,
  list_ui_assets: listUiAssetsHandler,
  apply_ui_kit: applyUiKitHandler,
  browse_ui_kit: browseUiKitHandler,
  get_ui_kit_status: getUiKitStatusHandler,
};

export const destructiveToolNames: string[] = ["apply_ui_kit"];
