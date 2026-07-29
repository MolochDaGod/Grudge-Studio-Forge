/**
 * Best free + Grudge fleet services wired into the free Three.js editor (Forge).
 *
 * SSOT for Help → Best Services, landing page, and AI Worker knowledge.
 * Prefer fleet domains for production; free externals stay optional BYOK.
 */

export type ServiceTier = "fleet" | "free" | "byok" | "local";
export type ServiceCategory =
  | "editor"
  | "auth"
  | "assets"
  | "ai"
  | "data"
  | "publish"
  | "docs"
  | "tools";

export interface BestService {
  id: string;
  name: string;
  category: ServiceCategory;
  tier: ServiceTier;
  /** Short one-liner for UI chips */
  blurb: string;
  /** Public URL (open in tab) or same-origin path */
  url: string;
  /** Optional in-editor action id for CustomEvent routing */
  editorAction?:
    | "open-assets-fast"
    | "open-assets-polyhaven-models"
    | "open-assets-polyhaven-textures"
    | "open-assets-polyhaven-hdris"
    | "open-ai-worker"
    | "open-free-api-keys"
    | "open-projects";
  /** True when already integrated in this SPA (not just a link) */
  wired: boolean;
}

/** Ordered catalog — featured first. */
export const BEST_SERVICES: BestService[] = [
  // ── Editor (this product) ──────────────────────────────────────────
  {
    id: "forge",
    name: "Grudge Forge",
    category: "editor",
    tier: "fleet",
    blurb: "Free customized Three.js editor · R3F · Rapier · AI Worker",
    url: "https://forge.grudge-studio.com/editor",
    wired: true,
  },
  {
    id: "threejs-docs",
    name: "three.js docs",
    category: "docs",
    tier: "free",
    blurb: "Official manual · editor DNA we mirror (commands, hierarchy, loaders)",
    url: "https://threejs.org/docs/",
    wired: true,
  },
  {
    id: "threejs-editor",
    name: "three.js Editor (reference)",
    category: "docs",
    tier: "free",
    blurb: "mrdoob official editor — Forge parity target, not a second product",
    url: "https://threejs.org/editor/",
    wired: false,
  },

  // ── Auth / identity ────────────────────────────────────────────────
  {
    id: "grudge-id",
    name: "Grudge ID",
    category: "auth",
    tier: "fleet",
    blurb: "Studio SSO · login?redirect_uri= for fleet apps",
    url: "https://id.grudge-studio.com",
    wired: true,
  },
  {
    id: "puter",
    name: "Puter (User-Pays)",
    category: "auth",
    tier: "free",
    blurb: "Free cloud FS / AI / publish · default guest-friendly path",
    url: "https://puter.com",
    wired: true,
  },

  // ── Assets ─────────────────────────────────────────────────────────
  {
    id: "fast-assets",
    name: "Fast options",
    category: "assets",
    tier: "fleet",
    blurb: "One-click races · maps · VFX · RTS · weapons (Asset Browser → Fast)",
    url: "https://forge.grudge-studio.com/editor",
    editorAction: "open-assets-fast",
    wired: true,
  },
  {
    id: "cdn",
    name: "Grudge Assets CDN",
    category: "assets",
    tier: "fleet",
    blurb: "R2 binaries · models / icons / warlords packs",
    url: "https://assets.grudge-studio.com",
    wired: true,
  },
  {
    id: "objectstore",
    name: "ObjectStore",
    category: "assets",
    tier: "fleet",
    blurb: "JSON catalogs · search · upload index",
    url: "https://objectstore.grudge-studio.com",
    wired: true,
  },
  {
    id: "polyhaven",
    name: "Poly Haven (CC0)",
    category: "assets",
    tier: "free",
    blurb: "Models · textures · HDRIs · in Asset Browser",
    url: "https://polyhaven.com",
    editorAction: "open-assets-polyhaven-models",
    wired: true,
  },
  {
    id: "kenney",
    name: "Kenney.nl",
    category: "assets",
    tier: "free",
    blurb: "CC0 game kits · roads · UI · prototypes (external)",
    url: "https://kenney.nl/assets",
    wired: false,
  },
  {
    id: "khronos-samples",
    name: "Khronos glTF Sample Models",
    category: "assets",
    tier: "free",
    blurb: "Canonical GLB test suite for import QA",
    url: "https://github.com/KhronosGroup/glTF-Sample-Models",
    wired: false,
  },

  // ── AI ─────────────────────────────────────────────────────────────
  {
    id: "ai-hub",
    name: "Grudge AI Gateway",
    category: "ai",
    tier: "fleet",
    blurb: "Studio AI hub · agent routes for fleet games",
    url: "https://ai.grudge-studio.com",
    wired: true,
  },
  {
    id: "puter-ai",
    name: "Puter AI",
    category: "ai",
    tier: "free",
    blurb: "Default free models in AI Worker (sign-in)",
    url: "https://puter.com",
    editorAction: "open-ai-worker",
    wired: true,
  },
  {
    id: "groq",
    name: "Groq",
    category: "ai",
    tier: "byok",
    blurb: "Free tier · ultra-fast Llama / Gemma",
    url: "https://console.groq.com/keys",
    editorAction: "open-free-api-keys",
    wired: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    category: "ai",
    tier: "byok",
    blurb: "Free models with :free suffix",
    url: "https://openrouter.ai/keys",
    editorAction: "open-free-api-keys",
    wired: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    category: "ai",
    tier: "byok",
    blurb: "AI Studio free key · Flash",
    url: "https://aistudio.google.com/apikey",
    editorAction: "open-free-api-keys",
    wired: true,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    category: "ai",
    tier: "byok",
    blurb: "Free tier · very fast Llama",
    url: "https://cloud.cerebras.ai",
    editorAction: "open-free-api-keys",
    wired: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    category: "ai",
    tier: "byok",
    blurb: "Cheap / free trial · strong code",
    url: "https://platform.deepseek.com/api_keys",
    editorAction: "open-free-api-keys",
    wired: true,
  },
  {
    id: "together",
    name: "Together AI",
    category: "ai",
    tier: "byok",
    blurb: "Free credits · open models",
    url: "https://api.together.xyz/settings/api-keys",
    editorAction: "open-free-api-keys",
    wired: true,
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    category: "ai",
    tier: "local",
    blurb: "Offline · full privacy · setup-offline.ps1",
    url: "https://ollama.com",
    editorAction: "open-ai-worker",
    wired: true,
  },

  // ── Data / games ───────────────────────────────────────────────────
  {
    id: "railway-api",
    name: "Game state (Railway)",
    category: "data",
    tier: "fleet",
    blurb: "Characters · island · wallet · inventory SSOT",
    url: "https://grudge-api-production-0d46.up.railway.app/api/health",
    wired: true,
  },
  {
    id: "foundry",
    name: "Character Foundry",
    category: "tools",
    tier: "fleet",
    blurb: "Create heroes · airship cinema · 4-slot roster",
    url: "https://character.grudge-studio.com",
    wired: true,
  },
  {
    id: "grudge-pipeline",
    name: "Grudge Pipeline",
    category: "tools",
    tier: "fleet",
    blurb: "Ingest · bake · R2 · Open-in-Forge scene packs",
    url: "https://grudge-pipeline.vercel.app/",
    wired: true,
  },
  {
    id: "ui-editor",
    name: "UI Editor (HYDRA)",
    category: "tools",
    tier: "fleet",
    blurb: "HUD packs · hotkeys · themes · WCS professions",
    url: "https://ui.grudge-studio.com",
    wired: true,
  },
  {
    id: "open-launcher",
    name: "Open launcher",
    category: "publish",
    tier: "fleet",
    blurb: "Fleet game shell · playtest handoff",
    url: "https://open.grudge-studio.com",
    wired: true,
  },
  {
    id: "client",
    name: "Warlords client",
    category: "publish",
    tier: "fleet",
    blurb: "Live play · home island · zones",
    url: "https://client.grudge-studio.com",
    wired: true,
  },
  {
    id: "portal",
    name: "Grudge Studio portal",
    category: "tools",
    tier: "fleet",
    blurb: "Studio home · fleet map entry",
    url: "https://grudge-studio.com",
    wired: true,
  },

  // ── Docs / community free ──────────────────────────────────────────
  {
    id: "r3f",
    name: "React Three Fiber",
    category: "docs",
    tier: "free",
    blurb: "Forge viewport stack docs",
    url: "https://docs.pmnd.rs/react-three-fiber",
    wired: true,
  },
  {
    id: "rapier",
    name: "Rapier 3D",
    category: "docs",
    tier: "free",
    blurb: "Physics engine used in editor + play",
    url: "https://rapier.rs/docs/",
    wired: true,
  },
  {
    id: "gltf-transform",
    name: "glTF-Transform",
    category: "docs",
    tier: "free",
    blurb: "Meshopt / Draco / texture optimize pipeline",
    url: "https://gltf-transform.dev/",
    wired: true,
  },
];

export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  editor: "Editor",
  auth: "Auth & identity",
  assets: "Assets & CDN",
  ai: "AI (free + BYOK + local)",
  data: "Game data",
  publish: "Play & publish",
  docs: "Docs & open tools",
  tools: "Studio tools",
};

export const SERVICE_TIER_LABEL: Record<ServiceTier, string> = {
  fleet: "Fleet",
  free: "Free",
  byok: "Free key",
  local: "Local",
};

export function servicesByCategory(): Array<{
  category: ServiceCategory;
  label: string;
  items: BestService[];
}> {
  const order: ServiceCategory[] = [
    "editor",
    "ai",
    "assets",
    "auth",
    "data",
    "publish",
    "tools",
    "docs",
  ];
  return order.map((category) => ({
    category,
    label: SERVICE_CATEGORY_LABEL[category],
    items: BEST_SERVICES.filter((s) => s.category === category),
  }));
}

/** Landing / marketing chips — short list of free differentiators. */
export const LANDING_SERVICE_HIGHLIGHTS = [
  {
    name: "Free Three.js editor",
    hint: "Customized Forge · hierarchy · gizmos · GLB pipeline",
    color: "#f6c945",
  },
  {
    name: "Puter + free AI keys",
    hint: "Groq · OpenRouter · Gemini · Cerebras · Ollama",
    color: "#a78bfa",
  },
  {
    name: "Poly Haven CC0",
    hint: "Models · textures · HDRIs in Asset Browser",
    color: "#6aa9ff",
  },
  {
    name: "Grudge fleet",
    hint: "ID · CDN · ObjectStore · Foundry · Open",
    color: "#6bdc8b",
  },
] as const;
