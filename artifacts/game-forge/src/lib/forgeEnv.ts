/**
 * Forge client environment — production origins + storage/AI plane.
 *
 * All browser-visible config. No secrets here (BYOK keys live in localStorage;
 * free-ai worker secrets stay on Cloudflare).
 *
 * Storage planes for Grudge cloud users:
 *   - local  — guest / offline: IndexedDB + localStorage
 *   - puter  — signed-in Puter: user KV + FS under Grudge/forge/
 *   - edge   — free-ai worker: D1 agent jobs + catalog (not project bodies)
 *   - fleet  — R2 CDN + ObjectStore + Railway player bag (not Forge projects)
 */

export type ProjectStorageBackend = "local" | "puter";

const trimSlash = (s: string) => s.replace(/\/+$/, "");

function viteEnv(key: string, fallback: string): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    const v = env?.[key];
    if (typeof v === "string" && v.trim()) return trimSlash(v.trim());
  } catch {
    /* SSR / tests */
  }
  return fallback;
}

/** Canonical production origins (overridable via VITE_*). */
export const FORGE_ENV = {
  forgeOrigin: viteEnv("VITE_FORGE_ORIGIN", "https://forge.grudge-studio.com"),
  assetsCdn: viteEnv("VITE_ASSETS_CDN", "https://assets.grudge-studio.com"),
  objectStore: viteEnv("VITE_OBJECTSTORE_URL", "https://objectstore.grudge-studio.com"),
  grudgeId: viteEnv("VITE_GRUDGE_ID_URL", "https://id.grudge-studio.com"),
  aiGateway: viteEnv("VITE_AI_GATEWAY_URL", "https://ai.grudge-studio.com"),
  /** Engine DB (player bag/characters/wallet) — Railway, never Puter SSOT */
  gameApi: viteEnv(
    "VITE_GAME_API_URL",
    "https://grudge-api-production-0d46.up.railway.app",
  ),
  appsAccount: viteEnv("VITE_APPS_URL", "https://apps.grudge-studio.com"),
  puterToolkit: viteEnv("VITE_PUTER_TOOLKIT_URL", "https://puter.grudge-studio.com"),
  /** Player account User-Pays FS + puter.site deploy — never bag/roster */
  puterSpace: viteEnv("VITE_PUTER_SPACE_URL", "https://ai.grudge-studio.com/puter-space"),
  wargus: viteEnv("VITE_WARGUS_URL", "https://grudge-studio.com/wargus"),
  warlordsClient: viteEnv(
    "VITE_WARLORDS_CLIENT_URL",
    "https://client.grudge-studio.com",
  ),
  openLauncher: viteEnv("VITE_OPEN_LAUNCHER_URL", "https://open.grudge-studio.com"),
  puterSite: viteEnv("VITE_PUTER_SITE_ORIGIN", "https://puter.com"),
  puterSdk: "https://js.puter.com/v2/",
  /**
   * GrudgeOS shell (puter-monitor-ai) — lists Forge projects from the same
   * Puter KV/FS plane. See puter-monitor `forge-cloud-bridge.js`.
   */
  grudgeOs: viteEnv(
    "VITE_GRUDGE_OS_URL",
    "https://puter-monitor-ai.vercel.app",
  ),
  /** Same-origin free-ai / catalog / agent (CF Worker routes). */
  freeAiBase: "/api/free-ai",
  catalogBase: "/api/catalog",
  agentBase: "/api/agent",
  knowledgeBase: "/api/knowledge",
  /** Puter keys shared with GrudgeOS ForgeCloudBridge */
  puter: {
    kvProjectsIndex: "grudge:forge:projects:index",
    kvNextId: "grudge:forge:nextId",
    fsRoot: "Grudge/forge",
    /** Account mirror (Railway snapshot only — never sole bag) */
    kvAccountMirrorPrefix: "grudge:forge:account-mirror:",
  },
} as const;

/** Edge AI + catalog routes used by agentEdge / freeApiProvider. */
export function freeAiStatusUrl(): string {
  return `${FORGE_ENV.freeAiBase}/status`;
}

export function freeAiChatUrl(provider: string): string {
  return `${FORGE_ENV.freeAiBase}/chat?provider=${encodeURIComponent(provider)}`;
}

export function catalogStatusUrl(): string {
  return `${FORGE_ENV.catalogBase}/status`;
}

export function agentJobsUrl(): string {
  return `${FORGE_ENV.agentBase}/jobs`;
}

/**
 * Snapshot for AI tools / Welcome / diagnostics.
 * Safe to send to agents — no secrets.
 */
export function forgeEnvSnapshot(opts?: {
  isPuterSignedIn?: boolean;
  storageBackend?: ProjectStorageBackend;
}) {
  const puter = opts?.isPuterSignedIn ?? false;
  const backend: ProjectStorageBackend =
    opts?.storageBackend ?? (puter ? "puter" : "local");
  return {
    schemaVersion: 1,
    origins: { ...FORGE_ENV },
    storage: {
      active: backend,
      local: {
        index: "localStorage grudge:forge:*:index",
        payloads: "IndexedDB (idb-keyval) + localStorage fallback",
        drafts: "gameforge:draft:* (idbDraft)",
      },
      puter: {
        kv: "grudge:forge:<collection>:index",
        fs: "Grudge/forge/<collection>/<id>.json",
        projectsIndex: FORGE_ENV.puter.kvProjectsIndex,
        fsRoot: FORGE_ENV.puter.fsRoot,
        requires: "Puter sign-in (isPuterSignedIn)",
        grudgeOs: FORGE_ENV.grudgeOs,
      },
      edge: {
        agentJobs: "D1 forge-agent via /api/agent/*",
        catalog: "/api/catalog/* free-ai worker",
        note: "Never stores project scenes or player bag",
      },
      fleet: {
        binaries: FORGE_ENV.assetsCdn,
        defs: FORGE_ENV.objectStore,
        player: "Railway Postgres (not Forge)",
        gameApi: FORGE_ENV.gameApi,
        accountApi: `${FORGE_ENV.gameApi}/api/account`,
        charactersApi: `${FORGE_ENV.gameApi}/api/characters`,
        walletApi: `${FORGE_ENV.gameApi}/api/wallet`,
        accountCloud: FORGE_ENV.puterSpace,
      },
    },
    ai: {
      providers: [
        "grudge-ai",
        "puter",
        "ollama",
        "groq",
        "openrouter",
        "gemini",
        "cerebras",
        "deepseek",
        "together",
        "server-anthropic",
      ],
      freeAiEdge: FORGE_ENV.freeAiBase,
      legion: FORGE_ENV.aiGateway,
      knowledge: FORGE_ENV.knowledgeBase,
      agentJobs: FORGE_ENV.agentBase,
      byok: "localStorage keys via freeApis setStoredApiKey",
      waterfall: [
        "grudge-ai (Legion)",
        "fleet groq/together",
        "puter user-pays",
        "byok",
        "ollama",
      ],
    },
    userPlanes: {
      guest: "local projects only; no Cloud Save / Puter AI account",
      puterCloud: "Grudge cloud user — projects in Puter KV+FS; share L7 puter_host",
      grudgeId:
        "SSO identity + Railway bag; does not replace Puter project FS; enables Legion JWT",
      grudgeOs:
        "puter-monitor-ai.vercel.app lists the same Puter projects; open /editor?project=<id>",
      puterToolkit: FORGE_ENV.puterToolkit,
      appsAccount: FORGE_ENV.appsAccount,
    },
    puterLaw: {
      kvPrefix: "grudge:",
      neverSoleSsot: ["bag", "characters", "wallet", "profession_xp"],
      docs: "docs/ACCOUNT_PUTER_ENGINE_SSOT.md",
    },
    aiBilling: {
      fleet: "GBux / Legion JWT for Grudge AI systems",
      byok: "optional free-ai / provider keys",
      puterUserPays: "puter.ai when Puter signed in",
      local: "Ollama offline",
    },
  };
}
