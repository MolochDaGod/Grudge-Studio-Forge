/**
 * Game deployment definitions — typed SSOT for Forge + fleet API systems.
 *
 * Docs: docs/GAME_DEPLOYMENT_DEFINITIONS.md
 * Skills: grudge-fleet · grudge-live-servers · grudge-game-onboarding
 *
 * Use this module (not ad-hoc strings) when assigning publish channels,
 * AI advice, or UI labels. Purged channels are kept as `status: "purged"`
 * so agents can detect and refuse them.
 */

/** What kind of product surface is being deployed. */
export type SurfaceClass =
  | "editor"
  | "launcher"
  | "play_client"
  | "create_foundry"
  | "hub_pvp"
  | "api_game_data"
  | "api_forge"
  | "api_identity"
  | "api_ai"
  | "cdn_assets"
  | "objectstore"
  | "room_ws"
  | "player_embed"
  | "desktop"
  | "archive";

/** How content leaves the editor / gets live. */
export type PublishChannel =
  | "forge_api_save"
  | "r2_user_assets"
  | "github_pack"
  | "puter_host"
  | "player_embed"
  | "fleet_satellite"
  | "open_library"
  /** @deprecated Never use — replaced by r2_user_assets + CDN */
  | "bundle_in_spa";

/** Live-server pattern IDs (grudge-live-servers L0–L9). */
export type DeployPatternId =
  | "L0"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "L6"
  | "L7"
  | "L8"
  | "L9";

export type DefStatus = "active" | "deprecated" | "purged";

export interface SurfaceDef {
  id: SurfaceClass;
  label: string;
  /** Canonical production URL when known */
  url?: string;
  /** Host/path when not a public browser URL */
  endpoint?: string;
  status: DefStatus;
  notes: string;
}

export interface PublishChannelDef {
  id: PublishChannel;
  label: string;
  status: DefStatus;
  durable: boolean;
  /** Which surface classes typically use this channel */
  surfaces: SurfaceClass[];
  /** Preferred live-server patterns */
  patterns: DeployPatternId[];
  /** API systems touched (logical names) */
  apiSystems: string[];
  notes: string;
  /** If purged/deprecated, what to use instead */
  replaceWith?: PublishChannel;
}

export interface ApiSystemDef {
  id: string;
  label: string;
  /** Host or path pattern */
  endpoint: string;
  layer: "player" | "defs" | "binaries" | "index" | "editor" | "auth" | "ai" | "realtime";
  status: DefStatus;
  notes: string;
}

export interface DeployPatternDef {
  id: DeployPatternId;
  label: string;
  status: DefStatus;
  notes: string;
}

// ── Surfaces ─────────────────────────────────────────────────────────

export const SURFACE_DEFS: SurfaceDef[] = [
  {
    id: "editor",
    label: "Forge editor",
    url: "https://forge.grudge-studio.com",
    status: "active",
    notes: "R3F + Rapier authoring SPA. Control plane only.",
  },
  {
    id: "launcher",
    label: "Open launcher",
    url: "https://open.grudge-studio.com",
    status: "active",
    notes: "Steam-style library + SSO hub (L1).",
  },
  {
    id: "play_client",
    label: "Warlords / live client",
    url: "https://client.grudge-studio.com",
    status: "active",
    notes: "Live play destinations (home / zone / lobby / tutorial / world).",
  },
  {
    id: "create_foundry",
    label: "Character Foundry",
    url: "https://character.grudge-studio.com",
    status: "active",
    notes: "Create + 4-slot select only; handoff to play_client.",
  },
  {
    id: "hub_pvp",
    label: "GRUDOX / Carrier hub",
    url: "https://grudox.grudge-studio.com",
    status: "active",
    notes: "CF edge WS + Railway rooms (L3+L4).",
  },
  {
    id: "api_game_data",
    label: "Railway game-data SSOT",
    endpoint: "grudge-api-production-0d46.up.railway.app",
    status: "active",
    notes: "Characters, account, island, wallet — L-PLAYER.",
  },
  {
    id: "api_forge",
    label: "Forge control-plane API",
    url: "https://forge.grudge-studio.com/api",
    status: "active",
    notes: "Projects, scenes, scripts, assets registry — not player bag.",
  },
  {
    id: "api_identity",
    label: "Grudge ID",
    url: "https://id.grudge-studio.com",
    status: "active",
    notes: "Auth gateway /login?redirect_uri=",
  },
  {
    id: "api_ai",
    label: "AI Gateway",
    url: "https://ai.grudge-studio.com",
    status: "active",
    notes: "Optional agents / chat.",
  },
  {
    id: "cdn_assets",
    label: "Assets CDN",
    url: "https://assets.grudge-studio.com",
    status: "active",
    notes: "L-BIN binaries (GLB, PNG, audio).",
  },
  {
    id: "objectstore",
    label: "ObjectStore catalogs",
    url: "https://objectstore.grudge-studio.com",
    status: "active",
    notes: "L-DEFS JSON catalogs.",
  },
  {
    id: "room_ws",
    label: "Realtime room servers",
    status: "active",
    notes: "Carrier / Colyseus / pvp-server — L2–L4.",
  },
  {
    id: "player_embed",
    label: "Scene player embed",
    status: "active",
    notes: "player.html + scene.json (Forge public / Puter).",
  },
  {
    id: "desktop",
    label: "Forge desktop",
    status: "active",
    notes: "Electron + heavy Assimp/KTX2 path.",
  },
  {
    id: "archive",
    label: "Archive / do not onboard",
    status: "purged",
    notes: "Babylon legacy, Replit origins, dead api tunnel as player SSOT.",
  },
];

// ── Publish channels ─────────────────────────────────────────────────

export const PUBLISH_CHANNEL_DEFS: PublishChannelDef[] = [
  {
    id: "forge_api_save",
    label: "Forge API save",
    status: "active",
    durable: true,
    surfaces: ["editor"],
    patterns: ["L8"],
    apiSystems: ["forge_projects", "forge_scenes", "forge_scripts"],
    notes: "Primary durable editor save to Forge Postgres.",
  },
  {
    id: "r2_user_assets",
    label: "R2 user assets",
    status: "active",
    durable: true,
    surfaces: ["editor", "cdn_assets"],
    patterns: ["L0", "L8"],
    apiSystems: ["forge_storage", "forge_assets", "r2"],
    notes: "GLB/textures via presigned upload; scene URLs must point here or builtin:.",
  },
  {
    id: "github_pack",
    label: "GitHub project pack",
    status: "active",
    durable: true,
    surfaces: ["editor"],
    patterns: ["L8"],
    apiSystems: ["github"],
    notes: "forge.project.json + scenes/*.gfscene.json + scripts.",
  },
  {
    id: "puter_host",
    label: "Puter free host",
    status: "active",
    durable: false,
    surfaces: ["player_embed", "editor"],
    patterns: ["L7"],
    apiSystems: ["puter"],
    notes: "Shareable playtest URL. Not Warlords production. User-Pays.",
  },
  {
    id: "player_embed",
    label: "Player embed bootstrap",
    status: "active",
    durable: true,
    surfaces: ["player_embed"],
    patterns: ["L7", "L8"],
    apiSystems: ["forge_static"],
    notes: "player.html + scene.json without editor chrome.",
  },
  {
    id: "fleet_satellite",
    label: "Fleet satellite game",
    status: "active",
    durable: true,
    surfaces: ["play_client", "launcher"],
    patterns: ["L0", "L1", "L2", "L3", "L4"],
    apiSystems: ["grudge_id", "railway_game_data", "objectstore", "cdn"],
    notes: "Vercel/Pages game with fleet rewrites — grudge-game-onboarding.",
  },
  {
    id: "open_library",
    label: "Open library card",
    status: "active",
    durable: true,
    surfaces: ["launcher"],
    patterns: ["L9"],
    apiSystems: ["open_game_library"],
    notes: "Discovery only; does not host the game binary.",
  },
  {
    id: "bundle_in_spa",
    label: "Bundle meshes into SPA dist (PURGED)",
    status: "purged",
    durable: false,
    surfaces: ["archive"],
    patterns: [],
    apiSystems: [],
    notes: "Never ship production GLBs inside Vite dist. Use R2 + CDN.",
    replaceWith: "r2_user_assets",
  },
];

// ── API systems ──────────────────────────────────────────────────────

export const API_SYSTEM_DEFS: ApiSystemDef[] = [
  {
    id: "railway_game_data",
    label: "Railway characters / account SSOT",
    endpoint: "https://grudge-api-production-0d46.up.railway.app/api/*",
    layer: "player",
    status: "active",
    notes: "/api/characters|account|inventory|island|wallet — fleet player state.",
  },
  {
    id: "grudge_id",
    label: "Grudge ID auth",
    endpoint: "https://id.grudge-studio.com",
    layer: "auth",
    status: "active",
    notes: "/login?redirect_uri= + token exchange.",
  },
  {
    id: "forge_projects",
    label: "Forge projects API",
    endpoint: "/api/projects",
    layer: "editor",
    status: "active",
    notes: "Editor project CRUD (Postgres forge_*).",
  },
  {
    id: "forge_scenes",
    label: "Forge scenes API",
    endpoint: "/api/scenes",
    layer: "editor",
    status: "active",
    notes: "Scene graph JSON persistence.",
  },
  {
    id: "forge_scripts",
    label: "Forge scripts API",
    endpoint: "/api/scripts",
    layer: "editor",
    status: "active",
    notes: "Entity script bodies.",
  },
  {
    id: "forge_assets",
    label: "Forge assets registry",
    endpoint: "/api/assets",
    layer: "editor",
    status: "active",
    notes: "DB rows pointing at R2 keys.",
  },
  {
    id: "forge_storage",
    label: "Forge R2 storage",
    endpoint: "/api/storage",
    layer: "binaries",
    status: "active",
    notes: "Presigned upload; objects on R2.",
  },
  {
    id: "forge_templates",
    label: "Scene templates",
    endpoint: "/api/templates",
    layer: "editor",
    status: "active",
    notes: "Seeded templates + R2.",
  },
  {
    id: "forge_ai",
    label: "Forge AI proxies",
    endpoint: "/api/ai|/api/cf-ai|/api/free-ai",
    layer: "ai",
    status: "active",
    notes: "Editor AI Worker backends — not fleet game sim.",
  },
  {
    id: "objectstore",
    label: "ObjectStore catalogs",
    endpoint: "https://objectstore.grudge-studio.com/api/v1",
    layer: "defs",
    status: "active",
    notes: "weapons/classes/races JSON.",
  },
  {
    id: "cdn",
    label: "Assets CDN",
    endpoint: "https://assets.grudge-studio.com",
    layer: "binaries",
    status: "active",
    notes: "L-BIN.",
  },
  {
    id: "ai_gateway",
    label: "Fleet AI gateway",
    endpoint: "https://ai.grudge-studio.com",
    layer: "ai",
    status: "active",
    notes: "Optional for games.",
  },
  {
    id: "dead_api_tunnel",
    label: "api.grudge-studio.com (old tunnel)",
    endpoint: "https://api.grudge-studio.com",
    layer: "player",
    status: "purged",
    notes: "Do not use as player SSOT. Prefer Railway same-origin /api/*.",
  },
  {
    id: "replit_storage",
    label: "Replit object storage",
    endpoint: "replit.app/api/storage",
    layer: "binaries",
    status: "purged",
    notes: "Broken. Re-upload via Forge R2.",
  },
];

// ── Patterns ─────────────────────────────────────────────────────────

export const DEPLOY_PATTERN_DEFS: DeployPatternDef[] = [
  { id: "L0", label: "Asset SSOT (CDN)", status: "active", notes: "Always. Magic-byte verify GLBs." },
  { id: "L1", label: "Open launcher SPA", status: "active", notes: "open.grudge-studio.com" },
  { id: "L2", label: "Co-located HTTP+WS", status: "active", notes: "Carrier in same Node process." },
  { id: "L3", label: "CF edge WS proxy", status: "active", notes: "GRUDOX — Vercel cannot upgrade WS." },
  { id: "L4", label: "Dedicated Railway room", status: "active", notes: "Colyseus / pvp-server / grudox-room." },
  { id: "L5", label: "Path-isolated rooms", status: "active", notes: "Multi-room path prefixes." },
  { id: "L6", label: "Durable Object rooms", status: "active", notes: "Edge multi-tenant rooms." },
  { id: "L7", label: "Ephemeral playtest", status: "active", notes: "Forge Puter host / preview TTL." },
  { id: "L8", label: "Editor artifact", status: "active", notes: "Forge / studio / dash." },
  { id: "L9", label: "Open library entry", status: "active", notes: "Catalog card only." },
];

// ── Queries ──────────────────────────────────────────────────────────

export function getPublishChannel(id: PublishChannel): PublishChannelDef | undefined {
  return PUBLISH_CHANNEL_DEFS.find((c) => c.id === id);
}

export function activePublishChannels(): PublishChannelDef[] {
  return PUBLISH_CHANNEL_DEFS.filter((c) => c.status === "active");
}

export function purgedPublishChannels(): PublishChannelDef[] {
  return PUBLISH_CHANNEL_DEFS.filter((c) => c.status === "purged" || c.status === "deprecated");
}

export function getApiSystem(id: string): ApiSystemDef | undefined {
  return API_SYSTEM_DEFS.find((a) => a.id === id);
}

export function activeApiSystems(): ApiSystemDef[] {
  return API_SYSTEM_DEFS.filter((a) => a.status === "active");
}

/** Refuse purged channels; return replacement advice. */
export function assertPublishChannelAllowed(id: string): {
  ok: boolean;
  channel?: PublishChannelDef;
  error?: string;
} {
  const ch = PUBLISH_CHANNEL_DEFS.find((c) => c.id === id);
  if (!ch) return { ok: false, error: `Unknown publish channel: ${id}` };
  if (ch.status === "purged" || ch.status === "deprecated") {
    return {
      ok: false,
      channel: ch,
      error: `${ch.id} is ${ch.status}. Use ${ch.replaceWith ?? "r2_user_assets"} instead. ${ch.notes}`,
    };
  }
  return { ok: true, channel: ch };
}

/** Recommend channels for a user goal string (AI / UI). */
export function recommendChannelsForGoal(
  goal: "save" | "playtest" | "fleet_game" | "share_link" | "backup",
): PublishChannel[] {
  switch (goal) {
    case "save":
      return ["forge_api_save", "r2_user_assets"];
    case "playtest":
      return ["puter_host", "player_embed"];
    case "share_link":
      return ["puter_host"];
    case "fleet_game":
      return ["fleet_satellite", "r2_user_assets", "open_library"];
    case "backup":
      return ["github_pack", "forge_api_save"];
    default:
      return ["forge_api_save"];
  }
}

/** Full snapshot for AI tools / diagnostics. */
export function gameDeploymentSnapshot() {
  return {
    schemaVersion: 1,
    doc: "docs/GAME_DEPLOYMENT_DEFINITIONS.md",
    surfaces: SURFACE_DEFS,
    publishChannels: PUBLISH_CHANNEL_DEFS,
    apiSystems: API_SYSTEM_DEFS,
    patterns: DEPLOY_PATTERN_DEFS,
    purged: {
      channels: purgedPublishChannels().map((c) => c.id),
      apis: API_SYSTEM_DEFS.filter((a) => a.status === "purged").map((a) => a.id),
    },
    defaults: {
      newBrowserGame: ["L0", "L1", "L2"] as DeployPatternId[],
      forgePlaytest: ["L7"] as DeployPatternId[],
      forgeEditor: ["L8"] as DeployPatternId[],
    },
  };
}
