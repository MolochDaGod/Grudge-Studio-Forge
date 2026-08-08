/**
 * Provider registry. The picker reads `MODELS` from `./types` and asks
 * `getProvider(modelOption.provider)` here to dispatch the turn.
 */
import type { AIProvider } from "./types";
import { serverAnthropicProvider } from "./serverAnthropicProvider";
import { puterProvider } from "./puterProvider";
import { ollamaProvider } from "./ollamaProvider";
import {
  groqProvider,
  openrouterProvider,
  geminiFreeProvider,
  cerebrasProvider,
  deepseekProvider,
  togetherProvider,
} from "./freeApiProvider";
import { grudgeAiProvider } from "./grudgeAiProvider";

const providers: Record<string, AIProvider> = {
  "server-anthropic": serverAnthropicProvider,
  puter: puterProvider,
  ollama: ollamaProvider,
  "grudge-ai": grudgeAiProvider,
  groq: groqProvider,
  openrouter: openrouterProvider,
  gemini: geminiFreeProvider,
  cerebras: cerebrasProvider,
  deepseek: deepseekProvider,
  together: togetherProvider,
};

/** Default Grudge AI Legion; puter/groq remain failover. */
export function getProvider(id: string): AIProvider {
  return providers[id] ?? grudgeAiProvider;
}

export { MODELS, DEFAULT_MODEL_ID, findModel } from "./types";
export type {
  AIProvider,
  ModelOption,
  ProviderEvent,
  ProviderRequest,
  ProviderKind,
} from "./types";
export {
  FREE_PROVIDERS,
  getStoredApiKey,
  setStoredApiKey,
  listStoredKeys,
  hasProviderAccess,
  refreshFleetServerKeys,
  getFleetServerKeys,
  type FreeProviderId,
} from "./freeApis";
