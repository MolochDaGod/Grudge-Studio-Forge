/**
 * Best-available model routing with failover chain.
 * MODELS catalog stays the SSOT; UI no longer picks manually.
 */
import {
  MODELS,
  findModel,
  DEFAULT_MODEL_ID,
  type ModelOption,
  type ProviderKind,
} from "@/lib/ai/providers";
import {
  hasProviderAccess,
  refreshFleetServerKeys,
  type FreeProviderId,
} from "@/lib/ai/providers/freeApis";
import { isOllamaAvailable } from "@/lib/ai/providers/ollamaProvider";
import {
  isProviderAllowed,
  loadAiUserSettings,
  type AiUserSettings,
} from "@/lib/ai/aiUserSettings";
import { ensureOllamaRunning, probeOllama } from "@/lib/ai/ollamaLifecycle";
import type { AgentRole } from "./intent";

export type RoutingProbe = {
  puterSignedIn: boolean;
  ollamaOk: boolean;
  fleet: Partial<Record<FreeProviderId, boolean>>;
  forceOffline?: boolean;
  /** Optional forced model id from advanced settings. */
  forceModelId?: string | null;
  /** Snapshot of user allowlist / prefer-ollama. */
  settings?: AiUserSettings;
};

const FREE_PROVIDER_KINDS = new Set<ProviderKind>([
  "groq",
  "openrouter",
  "gemini",
  "cerebras",
  "deepseek",
  "together",
]);

/** Preferred model ids per role (first available wins). */
const ROLE_PREFERENCE: Record<AgentRole, string[]> = {
  orchestrator: [
    "groq:llama-3.3-70b-versatile",
    "together:meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "puter:claude-3-7-sonnet",
    "gemini:gemini-2.0-flash",
    "openrouter:meta-llama/llama-3.3-70b-instruct:free",
    "ollama:llama3.2",
  ],
  scene_builder: [
    "groq:llama-3.3-70b-versatile",
    "puter:claude-3-7-sonnet",
    "together:meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "gemini:gemini-2.0-flash",
    "ollama:qwen2.5-coder:7b",
  ],
  code: [
    "deepseek:deepseek-chat",
    "puter:claude-3-7-sonnet",
    "groq:llama-3.3-70b-versatile",
    "ollama:qwen2.5-coder:7b",
    "ollama:deepseek-coder-v2:16b",
  ],
  design: [
    "puter:gpt-4o-mini",
    "gemini:gemini-2.0-flash",
    "puter:claude-3-7-sonnet",
    "groq:llama-3.3-70b-versatile",
  ],
  diagnose: [
    "groq:llama-3.1-8b-instant",
    "groq:gemma2-9b-it",
    "gemini:gemini-2.0-flash-lite",
    "groq:llama-3.3-70b-versatile",
    "ollama:llama3.2",
  ],
  deploy: [
    "groq:llama-3.1-8b-instant",
    "groq:llama-3.3-70b-versatile",
    "puter:claude-3-5-sonnet",
    "ollama:llama3.2",
  ],
  offline: [
    "ollama:qwen2.5-coder:7b",
    "ollama:llama3.2",
    "ollama:deepseek-coder-v2:16b",
    "ollama:codellama:13b",
  ],
};

function modelAvailable(m: ModelOption, probe: RoutingProbe): boolean {
  const settings = probe.settings ?? loadAiUserSettings();
  if (!isProviderAllowed(m.provider, settings)) return false;

  if (probe.forceOffline || settings.forceOffline) {
    return m.provider === "ollama" && probe.ollamaOk;
  }
  if (m.provider === "ollama") return probe.ollamaOk;
  if (m.provider === "puter") return probe.puterSignedIn;
  if (m.provider === "server-anthropic") return true; // try; fail over on error
  if (FREE_PROVIDER_KINDS.has(m.provider)) {
    const id = m.provider as FreeProviderId;
    if (probe.fleet[id]) return true;
    return hasProviderAccess(id);
  }
  return true;
}

/**
 * Ordered failover chain for a role given current probes.
 */
export function buildFailoverChain(
  role: AgentRole,
  probe: RoutingProbe,
): ModelOption[] {
  if (probe.forceModelId) {
    const forced = findModel(probe.forceModelId);
    if (modelAvailable(forced, probe)) return [forced];
  }

  const settings = probe.settings ?? loadAiUserSettings();
  const preferred =
    probe.forceOffline || settings.forceOffline
      ? ROLE_PREFERENCE.offline
      : ROLE_PREFERENCE[role] ?? ROLE_PREFERENCE.orchestrator;

  const chain: ModelOption[] = [];
  const seen = new Set<string>();

  // Prefer Ollama first when user opted in and it is up.
  if (settings.preferOllamaWhenAvailable && probe.ollamaOk) {
    for (const m of MODELS) {
      if (m.provider !== "ollama" || seen.has(m.id)) continue;
      if (!modelAvailable(m, probe)) continue;
      chain.push(m);
      seen.add(m.id);
    }
  }

  for (const id of preferred) {
    const m = MODELS.find((x) => x.id === id);
    if (!m || seen.has(m.id)) continue;
    if (!modelAvailable(m, probe)) continue;
    chain.push(m);
    seen.add(m.id);
  }

  // Append any other available models as last resort
  for (const m of MODELS) {
    if (seen.has(m.id)) continue;
    if (!modelAvailable(m, probe)) continue;
    chain.push(m);
    seen.add(m.id);
  }

  if (chain.length === 0) {
    // Absolute last resort: default catalog entry (may error → offline UX)
    chain.push(findModel(DEFAULT_MODEL_ID));
  }
  return chain;
}

export function pickBestModel(
  role: AgentRole,
  probe: RoutingProbe,
): ModelOption {
  return buildFailoverChain(role, probe)[0];
}

export async function probeRouting(opts: {
  puterSignedIn: boolean;
  forceOffline?: boolean;
  forceModelId?: string | null;
  /** Attempt Ollama start when settings.autoStartOllama. */
  tryStartOllama?: boolean;
}): Promise<RoutingProbe> {
  const settings = loadAiUserSettings();
  const forceOffline = opts.forceOffline ?? settings.forceOffline;

  if (opts.tryStartOllama !== false && (settings.autoStartOllama || forceOffline)) {
    await ensureOllamaRunning({ forceAttempt: settings.autoStartOllama || forceOffline });
  }

  const [ollamaOkTags, ollamaOkCustom, fleet] = await Promise.all([
    isOllamaAvailable().catch(() => false),
    probeOllama(settings.ollamaBaseUrl).catch(() => false),
    refreshFleetServerKeys(true).catch(
      () => ({}) as Partial<Record<FreeProviderId, boolean>>,
    ),
  ]);

  return {
    puterSignedIn: opts.puterSignedIn,
    ollamaOk: !!(ollamaOkTags || ollamaOkCustom),
    fleet: fleet ?? {},
    forceOffline,
    forceModelId: opts.forceModelId,
    settings,
  };
}

export function statusLabel(model: ModelOption, probe: RoutingProbe): string {
  if (model.provider === "ollama") return `Ollama · ${model.label}`;
  if (model.provider === "puter") return `Puter · ${model.label}`;
  if (FREE_PROVIDER_KINDS.has(model.provider)) {
    const fleet = probe.fleet[model.provider as FreeProviderId];
    return fleet
      ? `Fleet · ${model.label}`
      : `BYOK · ${model.label}`;
  }
  return model.label;
}
