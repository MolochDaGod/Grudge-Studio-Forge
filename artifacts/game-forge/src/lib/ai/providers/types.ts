/**
 * Provider abstraction for the AI Worker.
 *
 * `runConversation()` in `lib/aiClient.ts` is the editor's stable
 * surface — it owns destructive-tool confirmation, multimodal image
 * extraction, the tool-loop, the audit log, and the per-tool snapshot
 * machinery. A "provider" is the part that turns a structured request
 * (messages + tools + system + model) into a stream of normalized
 * events the loop already consumes:
 *
 *   text_delta   — token-level streaming for the UI
 *   text_block   — final text block (for transcript bookkeeping)
 *   tool_use     — assistant requested a tool call
 *   stop         — turn ended (with stop_reason)
 *   error        — fatal error mid-stream
 *
 * Two providers ship in this repo:
 *   - serverAnthropicProvider  — POST /api/ai/chat (default; Grudge API server)
 *   - puterProvider            — POST /api/ai/chat?provider=puter (uses
 *                                puter.ai.chat server-side via the user's
 *                                forwarded `X-Puter-Token`)
 *
 * The Puter route also accepts the same shape because the server
 * translates `tools` / `messages` into Puter's wire format and emits
 * the same SSE events back. Tools are provider-agnostic by construction.
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

/** Request shape passed to a provider's `streamTurn()`. The shape is
 *  Anthropic-message-flavored because that's what the editor already
 *  uses for its transcript; providers translate as needed. */
export interface ProviderRequest {
  /** Anthropic-style content blocks. Tools / images may be present. */
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  /** Tool definitions in Anthropic JSON-schema shape. Providers translate. */
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  system: string;
  /** Optional explicit model id. The provider chooses a sensible default
   *  when omitted. */
  model?: string;
  /** Max tokens for the response. */
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  /** Stable id for the picker / logs. */
  id: string;
  /** Friendly label for the model picker header. */
  label: string;
  /** Stream a single conversation turn — yields normalized events. */
  streamTurn(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

/** Curated catalog used by the model picker. The first entry is the
 *  default for new projects. Providers / models added here must already
 *  be supported by their backing route. */
export interface ModelOption {
  /** localStorage value & wire id. */
  id: string;
  /** Picker label. */
  label: string;
  /** Short hint shown under the picker option. */
  hint?: string;
  provider: "server-anthropic" | "puter" | "ollama";
  /** Model id passed through to the provider. */
  modelId: string;
  /** True iff Puter sign-in is required (not just guest). */
  requiresPuterAuth?: boolean;
}

export const MODELS: ModelOption[] = [
  {
    id: "server:claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    hint: "Default · Grudge Studio AI",
    provider: "server-anthropic",
    modelId: "claude-sonnet-4-6",
  },
  {
    id: "server:claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "Faster · Grudge Studio AI",
    provider: "server-anthropic",
    modelId: "claude-haiku-4-5",
  },
  {
    id: "puter:claude-3-5-sonnet",
    label: "Claude 3.5 Sonnet (Puter)",
    hint: "Free via Puter — sign in required",
    provider: "puter",
    modelId: "claude-3-5-sonnet",
    requiresPuterAuth: true,
  },
  {
    id: "puter:claude-3-7-sonnet",
    label: "Claude 3.7 Sonnet (Puter)",
    hint: "Free via Puter — sign in required",
    provider: "puter",
    modelId: "claude-3-7-sonnet",
    requiresPuterAuth: true,
  },
  {
    id: "puter:gpt-4o",
    label: "GPT-4o (Puter)",
    hint: "Free via Puter — sign in required",
    provider: "puter",
    modelId: "gpt-4o",
    requiresPuterAuth: true,
  },
  {
    id: "puter:gpt-4o-mini",
    label: "GPT-4o mini (Puter)",
    hint: "Free via Puter — sign in required",
    provider: "puter",
    modelId: "gpt-4o-mini",
    requiresPuterAuth: true,
  },
  {
    id: "puter:gemini-2.0-flash",
    label: "Gemini 2.0 Flash (Puter)",
    hint: "Free via Puter — sign in required",
    provider: "puter",
    modelId: "gemini-2.0-flash",
    requiresPuterAuth: true,
  },
  {
    id: "puter:llama-3.3-70b",
    label: "Llama 3.3 70B (Puter)",
    hint: "Free via Puter — sign in required",
    provider: "puter",
    modelId: "llama-3.3-70b",
    requiresPuterAuth: true,
  },
  {
    id: "puter:deepseek-chat",
    label: "DeepSeek Chat (Puter)",
    hint: "Free via Puter — sign in required",
    provider: "puter",
    modelId: "deepseek-chat",
    requiresPuterAuth: true,
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

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function findModel(id: string | null | undefined): ModelOption {
  if (!id) return MODELS[0];
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
