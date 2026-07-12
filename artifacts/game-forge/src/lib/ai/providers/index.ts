/**
 * Provider registry. The picker reads `MODELS` from `./types` and asks
 * `getProvider(modelOption.provider)` here to dispatch the turn.
 */
import type { AIProvider } from "./types";
import { serverAnthropicProvider } from "./serverAnthropicProvider";
import { puterProvider } from "./puterProvider";
import { ollamaProvider } from "./ollamaProvider";

const providers: Record<string, AIProvider> = {
  "server-anthropic": serverAnthropicProvider,
  puter: puterProvider,
  ollama: ollamaProvider,
};

/** Default to Puter (free) — server Anthropic key is optional / often missing. */
export function getProvider(id: string): AIProvider {
  return providers[id] ?? puterProvider;
}

export { MODELS, DEFAULT_MODEL_ID, findModel } from "./types";
export type { AIProvider, ModelOption, ProviderEvent, ProviderRequest } from "./types";
