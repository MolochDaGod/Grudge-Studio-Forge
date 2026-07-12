/**
 * Free / freemium OpenAI-compatible API catalogs.
 *
 * Keys are never hardcoded. Resolution order per request:
 *   1. User key from localStorage (BYOK) — `grudge.ai.key.<provider>`
 *   2. Server env key via same-origin proxy `/api/free-ai/chat`
 *
 * The browser always talks same-origin so CORS never blocks Groq/etc.
 */

export type FreeProviderId =
  | "groq"
  | "openrouter"
  | "gemini"
  | "cerebras"
  | "deepseek"
  | "together";

export interface FreeProviderConfig {
  id: FreeProviderId;
  label: string;
  /** OpenAI-compatible chat completions base (no trailing /chat/completions). */
  baseUrl: string;
  /** Env var name the free-ai proxy reads. */
  envKey: string;
  /** localStorage key for BYOK. */
  storageKey: string;
  /** Signup URL for free key. */
  signupUrl: string;
  hint: string;
}

export const FREE_PROVIDERS: Record<FreeProviderId, FreeProviderConfig> = {
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    storageKey: "grudge.ai.key.groq",
    signupUrl: "https://console.groq.com/keys",
    hint: "Free tier · ultra-fast Llama / Gemma",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    storageKey: "grudge.ai.key.openrouter",
    signupUrl: "https://openrouter.ai/keys",
    hint: "Free models with :free suffix",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    storageKey: "grudge.ai.key.gemini",
    signupUrl: "https://aistudio.google.com/apikey",
    hint: "Free AI Studio key · Flash models",
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    storageKey: "grudge.ai.key.cerebras",
    signupUrl: "https://cloud.cerebras.ai",
    hint: "Free tier · very fast Llama",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    envKey: "DEEPSEEK_API_KEY",
    storageKey: "grudge.ai.key.deepseek",
    signupUrl: "https://platform.deepseek.com/api_keys",
    hint: "Cheap / free trial · strong code",
  },
  together: {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
    storageKey: "grudge.ai.key.together",
    signupUrl: "https://api.together.xyz/settings/api-keys",
    hint: "Free credits · open models",
  },
};

export function getStoredApiKey(provider: FreeProviderId): string | null {
  try {
    const v = localStorage.getItem(FREE_PROVIDERS[provider].storageKey);
    return v && v.trim().length > 8 ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredApiKey(
  provider: FreeProviderId,
  key: string | null,
): void {
  try {
    const sk = FREE_PROVIDERS[provider].storageKey;
    if (!key || !key.trim()) localStorage.removeItem(sk);
    else localStorage.setItem(sk, key.trim());
  } catch {
    /* private mode */
  }
}

export function listStoredKeys(): Partial<Record<FreeProviderId, boolean>> {
  const out: Partial<Record<FreeProviderId, boolean>> = {};
  for (const id of Object.keys(FREE_PROVIDERS) as FreeProviderId[]) {
    out[id] = Boolean(getStoredApiKey(id));
  }
  return out;
}
