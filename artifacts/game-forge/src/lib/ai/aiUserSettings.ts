/**
 * User-tunable Forge AI settings (localStorage only).
 * Orchestrator reads these for allowed providers, custom prompt, Ollama prefs.
 */
import type { ProviderKind } from "@/lib/ai/providers/types";

const STORAGE_KEY = "grudge.ai.userSettings.v1";

/** Providers the user may allow the orchestrator to use. */
export type AllowableProvider = ProviderKind;

export const ALL_ALLOWABLE_PROVIDERS: AllowableProvider[] = [
  "grudge-ai",
  "groq",
  "together",
  "puter",
  "openrouter",
  "gemini",
  "cerebras",
  "deepseek",
  "ollama",
  "server-anthropic",
];

export const PROVIDER_LABELS: Record<AllowableProvider, string> = {
  "grudge-ai": "Grudge AI Legion (auto · recommended)",
  groq: "Groq (fleet / BYOK)",
  together: "Together (fleet / BYOK)",
  puter: "Puter (sign-in free)",
  openrouter: "OpenRouter (BYOK)",
  gemini: "Gemini (BYOK)",
  cerebras: "Cerebras (BYOK)",
  deepseek: "DeepSeek (BYOK)",
  ollama: "Ollama (local)",
  "server-anthropic": "Server Anthropic (optional)",
};

/** High-level usage mode for orchestrator defaults. */
export type AiUsageMode = "auto" | "fleet_free" | "puter_first" | "byok" | "offline";

export type AiUserSettings = {
  /** Extra system prompt appended every turn (user “improve systems”). */
  customSystemPrompt: string;
  /** When empty = all allowed. Otherwise only these providers. */
  allowedProviders: AllowableProvider[];
  /** Prefer offline chain only. */
  forceOffline: boolean;
  /**
   * When true, on panel open / before offline turns: probe Ollama and
   * attempt start (desktop IPC) or surface install/serve instructions.
   */
  autoStartOllama: boolean;
  /** Prefer Ollama when it is reachable (insert at front of chain). */
  preferOllamaWhenAvailable: boolean;
  /** Override Ollama base URL (default http://localhost:11434). */
  ollamaBaseUrl: string;
  /**
   * Usage profile:
   *  auto — Grudge AI → fleet free → Puter → BYOK → Ollama
   *  fleet_free — only grudge-ai + groq/together fleet
   *  puter_first — Puter user-pays first
   *  byok — user keys only (+ grudge-ai if signed in)
   *  offline — Ollama only
   */
  usageMode: AiUsageMode;
  /** Optional forced Legion agent role when using grudge-ai (dev|toolkit|…). */
  grudgeAiRole: string;
};

const DEFAULTS: AiUserSettings = {
  customSystemPrompt: "",
  allowedProviders: [...ALL_ALLOWABLE_PROVIDERS],
  forceOffline: false,
  autoStartOllama: false,
  preferOllamaWhenAvailable: false,
  ollamaBaseUrl: "http://localhost:11434",
  usageMode: "auto",
  grudgeAiRole: "dev",
};

export function loadAiUserSettings(): AiUserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, allowedProviders: [...DEFAULTS.allowedProviders] };
    const parsed = JSON.parse(raw) as Partial<AiUserSettings>;
    const allowed = Array.isArray(parsed.allowedProviders)
      ? (parsed.allowedProviders.filter((p) =>
          ALL_ALLOWABLE_PROVIDERS.includes(p as AllowableProvider),
        ) as AllowableProvider[])
      : [...DEFAULTS.allowedProviders];
    const usageModes: AiUsageMode[] = [
      "auto",
      "fleet_free",
      "puter_first",
      "byok",
      "offline",
    ];
    const usageMode = usageModes.includes(parsed.usageMode as AiUsageMode)
      ? (parsed.usageMode as AiUsageMode)
      : DEFAULTS.usageMode;
    return {
      customSystemPrompt:
        typeof parsed.customSystemPrompt === "string"
          ? parsed.customSystemPrompt.slice(0, 8000)
          : "",
      allowedProviders:
        allowed.length > 0 ? allowed : [...DEFAULTS.allowedProviders],
      forceOffline: !!parsed.forceOffline || usageMode === "offline",
      autoStartOllama: !!parsed.autoStartOllama,
      preferOllamaWhenAvailable: !!parsed.preferOllamaWhenAvailable,
      ollamaBaseUrl:
        typeof parsed.ollamaBaseUrl === "string" &&
        /^https?:\/\/[\w.:+-]+/i.test(parsed.ollamaBaseUrl)
          ? parsed.ollamaBaseUrl.replace(/\/$/, "")
          : DEFAULTS.ollamaBaseUrl,
      usageMode,
      grudgeAiRole:
        typeof parsed.grudgeAiRole === "string" && parsed.grudgeAiRole.trim()
          ? parsed.grudgeAiRole.trim().slice(0, 32)
          : DEFAULTS.grudgeAiRole,
    };
  } catch {
    return {
      ...DEFAULTS,
      allowedProviders: [...DEFAULTS.allowedProviders],
    };
  }
}

export function saveAiUserSettings(partial: Partial<AiUserSettings>): AiUserSettings {
  const next = { ...loadAiUserSettings(), ...partial };
  if (typeof next.customSystemPrompt === "string") {
    next.customSystemPrompt = next.customSystemPrompt.slice(0, 8000);
  }
  if (!next.allowedProviders?.length) {
    next.allowedProviders = [...DEFAULTS.allowedProviders];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

export function isProviderAllowed(
  kind: ProviderKind,
  settings: AiUserSettings = loadAiUserSettings(),
): boolean {
  if (!settings.allowedProviders.length) return true;
  return settings.allowedProviders.includes(kind);
}
