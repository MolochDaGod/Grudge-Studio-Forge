/**
 * Provider registry. The picker reads `MODELS` from `./types` and asks
 * `getProvider(modelOption.provider)` here to dispatch the turn.
 */
import type { AIProvider } from "./types";
import { serverAnthropicProvider } from "./serverAnthropicProvider";
import { puterProvider } from "./puterProvider";

const providers: Record<string, AIProvider> = {
  "server-anthropic": serverAnthropicProvider,
  puter: puterProvider,
};

export function getProvider(id: string): AIProvider {
  return providers[id] ?? serverAnthropicProvider;
}

export { MODELS, DEFAULT_MODEL_ID, findModel } from "./types";
export type { AIProvider, ModelOption, ProviderEvent, ProviderRequest } from "./types";
