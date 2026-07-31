/**
 * Provider abstraction for the AI Worker.
 *
 * `runConversation()` in `lib/aiClient.ts` is the editor's stable
 * surface — it owns destructive-tool confirmation, multimodal image
 * extraction, the tool-loop, the audit log, and the per-tool snapshot
 * machinery. A "provider" is the part that turns a structured request
 * (messages + tools + system + model) into a stream of normalized
 * events the loop already consumes.
 */

export interface ProviderTextDelta {
  type: "text_delta";
  text: string;
}
export interface ProviderTextBlock {
  type: "text_block";
  text: string;
}
export interface ProviderToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ProviderStop {
  type: "stop";
  stop_reason: string;
}
export interface ProviderError {
  type: "error";
  error: string;
}
export type ProviderEvent =
  | ProviderTextDelta
  | ProviderTextBlock
  | ProviderToolUse
  | ProviderStop
  | ProviderError;

export interface ProviderRequest {
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  system: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  id: string;
  label: string;
  streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

export type ProviderKind =
  | "server-anthropic"
  | "puter"
  | "ollama"
  | "groq"
  | "openrouter"
  | "gemini"
  | "cerebras"
  | "deepseek"
  | "together";

export interface ModelOption {
  id: string;
  label: string;
  hint?: string;
  provider: ProviderKind;
  modelId: string;
  requiresPuterAuth?: boolean;
  /** True when this free provider needs a BYOK or server key. */
  requiresFreeApiKey?: boolean;
}

export const MODELS: ModelOption[] = [
  // ── Puter (free, no key — sign-in) ───────────────────────────────
  {
    id: "puter:claude-3-7-sonnet",
    label: "Claude 3.7 Sonnet (Puter)",
    hint: "Default · Free via Puter sign-in",
    provider: "puter",
    modelId: "claude-3-7-sonnet",
    requiresPuterAuth: true,
  },
  {
    id: "puter:claude-3-5-sonnet",
    label: "Claude 3.5 Sonnet (Puter)",
    hint: "Free via Puter",
    provider: "puter",
    modelId: "claude-3-5-sonnet",
    requiresPuterAuth: true,
  },
  {
    id: "puter:gpt-4o-mini",
    label: "GPT-4o mini (Puter)",
    hint: "Free via Puter",
    provider: "puter",
    modelId: "gpt-4o-mini",
    requiresPuterAuth: true,
  },
  {
    id: "puter:gemini-2.0-flash",
    label: "Gemini 2.0 Flash (Puter)",
    hint: "Free via Puter",
    provider: "puter",
    modelId: "gemini-2.0-flash",
    requiresPuterAuth: true,
  },
  {
    id: "puter:llama-3.3-70b",
    label: "Llama 3.3 70B (Puter)",
    hint: "Free via Puter",
    provider: "puter",
    modelId: "llama-3.3-70b",
    requiresPuterAuth: true,
  },

  // ── Groq (fleet edge key + BYOK — ultra fast) ────────────────────
  {
    id: "groq:llama-3.3-70b-versatile",
    label: "Llama 3.3 70B (Groq)",
    hint: "Fleet · ultra-fast · agentic default",
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    requiresFreeApiKey: true,
  },
  {
    id: "groq:llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant (Groq)",
    hint: "Fleet · fastest · tools",
    provider: "groq",
    modelId: "llama-3.1-8b-instant",
    requiresFreeApiKey: true,
  },
  {
    id: "groq:gemma2-9b-it",
    label: "Gemma 2 9B (Groq)",
    hint: "Fleet · compact",
    provider: "groq",
    modelId: "gemma2-9b-it",
    requiresFreeApiKey: true,
  },
  {
    id: "groq:qwen-qwq-32b",
    label: "Qwen QwQ 32B (Groq)",
    hint: "Fleet · reasoning",
    provider: "groq",
    modelId: "qwen-qwq-32b",
    requiresFreeApiKey: true,
  },

  // ── OpenRouter free models ───────────────────────────────────────
  {
    id: "openrouter:meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B (OpenRouter free)",
    hint: "Free · needs OpenRouter key",
    provider: "openrouter",
    modelId: "meta-llama/llama-3.3-70b-instruct:free",
    requiresFreeApiKey: true,
  },
  {
    id: "openrouter:google/gemma-2-9b-it:free",
    label: "Gemma 2 9B (OpenRouter free)",
    hint: "Free · needs OpenRouter key",
    provider: "openrouter",
    modelId: "google/gemma-2-9b-it:free",
    requiresFreeApiKey: true,
  },
  {
    id: "openrouter:qwen/qwen3-4b:free",
    label: "Qwen3 4B (OpenRouter free)",
    hint: "Free · needs OpenRouter key",
    provider: "openrouter",
    modelId: "qwen/qwen3-4b:free",
    requiresFreeApiKey: true,
  },
  {
    id: "openrouter:deepseek/deepseek-r1-0528:free",
    label: "DeepSeek R1 (OpenRouter free)",
    hint: "Free · reasoning · OpenRouter key",
    provider: "openrouter",
    modelId: "deepseek/deepseek-r1-0528:free",
    requiresFreeApiKey: true,
  },

  // ── Google Gemini (AI Studio free key) ───────────────────────────
  {
    id: "gemini:gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    hint: "Free AI Studio key",
    provider: "gemini",
    modelId: "gemini-2.0-flash",
    requiresFreeApiKey: true,
  },
  {
    id: "gemini:gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash Lite",
    hint: "Free · fast · AI Studio key",
    provider: "gemini",
    modelId: "gemini-2.0-flash-lite",
    requiresFreeApiKey: true,
  },
  {
    id: "gemini:gemini-1.5-flash",
    label: "Gemini 1.5 Flash",
    hint: "Free AI Studio key",
    provider: "gemini",
    modelId: "gemini-1.5-flash",
    requiresFreeApiKey: true,
  },

  // ── Cerebras ─────────────────────────────────────────────────────
  {
    id: "cerebras:llama-3.3-70b",
    label: "Llama 3.3 70B (Cerebras)",
    hint: "Free tier · very fast",
    provider: "cerebras",
    modelId: "llama-3.3-70b",
    requiresFreeApiKey: true,
  },
  {
    id: "cerebras:llama3.1-8b",
    label: "Llama 3.1 8B (Cerebras)",
    hint: "Free tier · paste Cerebras key",
    provider: "cerebras",
    modelId: "llama3.1-8b",
    requiresFreeApiKey: true,
  },

  // ── DeepSeek ─────────────────────────────────────────────────────
  {
    id: "deepseek:deepseek-chat",
    label: "DeepSeek Chat",
    hint: "Cheap/free trial · strong code",
    provider: "deepseek",
    modelId: "deepseek-chat",
    requiresFreeApiKey: true,
  },
  {
    id: "deepseek:deepseek-reasoner",
    label: "DeepSeek Reasoner",
    hint: "Reasoning · DeepSeek key",
    provider: "deepseek",
    modelId: "deepseek-reasoner",
    requiresFreeApiKey: true,
  },

  // ── Together ─────────────────────────────────────────────────────
  {
    id: "together:meta-llama/Llama-3.3-70B-Instruct-Turbo",
    label: "Llama 3.3 70B Turbo (Together)",
    hint: "Fleet edge key · open models",
    provider: "together",
    modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    requiresFreeApiKey: true,
  },
  {
    id: "together:Qwen/Qwen2.5-7B-Instruct-Turbo",
    label: "Qwen 2.5 7B Turbo (Together)",
    hint: "Fleet · fast code/chat",
    provider: "together",
    modelId: "Qwen/Qwen2.5-7B-Instruct-Turbo",
    requiresFreeApiKey: true,
  },

  // ── Ollama (local, offline) ──────────────────────────────────────
  {
    id: "ollama:qwen2.5-coder:7b",
    label: "Qwen 2.5 Coder 7B",
    hint: "Local · Best for Three.js + code gen",
    provider: "ollama",
    modelId: "qwen2.5-coder:7b",
  },
  {
    id: "ollama:llama3.2",
    label: "Llama 3.2 3B",
    hint: "Local · Fast general-purpose",
    provider: "ollama",
    modelId: "llama3.2",
  },
  {
    id: "ollama:deepseek-coder-v2:16b",
    label: "DeepSeek Coder v2 16B",
    hint: "Local · Strong code generation",
    provider: "ollama",
    modelId: "deepseek-coder-v2:16b",
  },
  {
    id: "ollama:codellama:13b",
    label: "Code Llama 13B",
    hint: "Local · Code-focused",
    provider: "ollama",
    modelId: "codellama:13b",
  },
];

/**
 * Agentic default — fleet Groq (edge key, no Puter gate).
 * MODELS[0] remains Puter Claude for the free sign-in picker; findModel(null)
 * always resolves DEFAULT_MODEL_ID so AI tools start on fleet Groq.
 */
export const DEFAULT_MODEL_ID = "groq:llama-3.3-70b-versatile";

const LEGACY_SERVER_IDS = new Set([
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "server:claude-sonnet-4-6",
  "server:claude-sonnet-4-5",
  "anthropic:claude-sonnet-4-6",
]);

function defaultModelOption(): ModelOption {
  return MODELS.find((m) => m.id === DEFAULT_MODEL_ID) ?? MODELS[0];
}

export function findModel(id: string | null | undefined): ModelOption {
  if (
    !id ||
    LEGACY_SERVER_IDS.has(id) ||
    id.startsWith("server:") ||
    id.startsWith("anthropic:")
  ) {
    return defaultModelOption();
  }
  return MODELS.find((m) => m.id === id) ?? defaultModelOption();
}
