/**
 * Advanced AI settings: custom system prompt, allowed APIs, Ollama auto-start.
 * Stored in localStorage via aiUserSettings.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { FreeApiKeysPanel } from "@/editor/FreeApiKeysPanel";
import {
  ALL_ALLOWABLE_PROVIDERS,
  PROVIDER_LABELS,
  loadAiUserSettings,
  saveAiUserSettings,
  type AiUserSettings,
  type AllowableProvider,
  type AiUsageMode,
} from "@/lib/ai/aiUserSettings";
import { ensureOllamaRunning } from "@/lib/ai/ollamaLifecycle";
import { clearOllamaAvailabilityCache } from "@/lib/ai/providers/ollamaProvider";
import { cn } from "@/lib/utils";
import { isGrudgeIdSignedIn } from "@/lib/grudgeAuthBridge";
import { FORGE_ENV } from "@/lib/forgeEnv";

const USAGE_MODES: { id: AiUsageMode; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Auto (recommended)",
    hint: "Grudge AI Legion → fleet Groq/Together → Puter → BYOK → Ollama",
  },
  {
    id: "fleet_free",
    label: "Fleet free only",
    hint: "Legion + edge Groq/Together only",
  },
  {
    id: "puter_first",
    label: "Puter first",
    hint: "User-pays Puter AI, then auto failover",
  },
  {
    id: "byok",
    label: "BYOK keys",
    hint: "Your pasted keys + Legion if signed in",
  },
  {
    id: "offline",
    label: "Offline (Ollama)",
    hint: "Local models only",
  },
];

const LEGION_ROLES = [
  "dev",
  "general",
  "toolkit",
  "puter",
  "fleet",
  "warlords",
  "convert",
  "grudge6",
  "ui",
  "ux",
];

export function AiRoutingSettings({
  onChange,
}: {
  /** Called after settings save so parent can re-probe. */
  onChange?: (s: AiUserSettings) => void;
}) {
  const [s, setS] = useState<AiUserSettings>(() => loadAiUserSettings());
  const [ollamaMsg, setOllamaMsg] = useState<string | null>(null);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const grudgeOn = isGrudgeIdSignedIn();

  useEffect(() => {
    setS(loadAiUserSettings());
  }, []);

  const persist = useCallback(
    (partial: Partial<AiUserSettings>) => {
      const next = saveAiUserSettings(partial);
      setS(next);
      onChange?.(next);
    },
    [onChange],
  );

  const toggleProvider = (id: AllowableProvider) => {
    const set = new Set(s.allowedProviders);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const next = [...set];
    if (next.length === 0) return; // keep at least one
    persist({ allowedProviders: next });
  };

  const startOllama = async () => {
    setOllamaBusy(true);
    setOllamaMsg(null);
    clearOllamaAvailabilityCache();
    const r = await ensureOllamaRunning({ forceAttempt: true, timeoutMs: 12_000 });
    clearOllamaAvailabilityCache();
    setOllamaMsg(
      r.ok
        ? r.message
        : `${r.message}${r.command ? ` → ${r.command}` : ""}`,
    );
    setOllamaBusy(false);
    onChange?.(loadAiUserSettings());
  };

  return (
    <div className="rounded-md border border-border bg-card/50 p-2 space-y-3 text-[11px]">
      <p className="text-muted-foreground leading-snug">
        <strong className="text-foreground">Auto</strong> uses the best available AI
        (Grudge Legion → fleet free → Puter → your keys → Ollama). Sign in with{" "}
        <strong className="text-foreground">Puter</strong> for cloud FS/KV and{" "}
        <strong className="text-foreground">Grudge ID</strong> for Legion JWT.
      </p>

      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 border",
            grudgeOn
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border text-muted-foreground",
          )}
        >
          Grudge ID {grudgeOn ? "on" : "off"}
        </span>
        <a
          className="rounded px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground"
          href={`${FORGE_ENV.aiGateway}/v1/skills`}
          target="_blank"
          rel="noreferrer"
        >
          Legion skills
        </a>
        <a
          className="rounded px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground"
          href={`${FORGE_ENV.grudgeId}/login`}
          target="_blank"
          rel="noreferrer"
        >
          Sign in ID
        </a>
      </div>

      {/* Usage mode */}
      <div className="space-y-1.5">
        <div className="font-medium text-foreground">Usage mode</div>
        <div className="grid gap-1">
          {USAGE_MODES.map((m) => (
            <label
              key={m.id}
              className={cn(
                "flex flex-col gap-0.5 cursor-pointer rounded px-1.5 py-1 border",
                s.usageMode === m.id
                  ? "border-primary/40 bg-primary/5"
                  : "border-transparent hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="ai-usage-mode"
                  checked={s.usageMode === m.id}
                  onChange={() =>
                    persist({
                      usageMode: m.id,
                      forceOffline: m.id === "offline",
                    })
                  }
                  data-testid={`ai-usage-${m.id}`}
                />
                <span className="font-medium">{m.label}</span>
              </span>
              <span className="text-[10px] text-muted-foreground pl-5">{m.hint}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <label className="font-medium text-foreground" htmlFor="ai-legion-role">
          Legion agent role (sub-agent skill)
        </label>
        <select
          id="ai-legion-role"
          className="w-full h-8 rounded border border-border bg-background px-2 text-[11px]"
          value={s.grudgeAiRole}
          onChange={(e) => persist({ grudgeAiRole: e.target.value })}
          data-testid="ai-legion-role"
        >
          {LEGION_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-muted-foreground">
          Maps to <code className="text-foreground">/v1/agents/:role/chat</code> on
          ai.grudge-studio.com (dev, toolkit, warlords, convert, …).
        </p>
      </div>

      {/* Custom system prompt */}
      <div className="space-y-1">
        <label className="font-medium text-foreground" htmlFor="ai-user-prompt">
          System prompt (optional)
        </label>
        <Textarea
          id="ai-user-prompt"
          rows={3}
          className="text-[11px] resize-none min-h-[60px]"
          placeholder="e.g. Prefer grudge6 race kits. Always diagnose before auto_fix. Keep entity names PascalCase…"
          value={s.customSystemPrompt}
          onChange={(e) => setS((prev) => ({ ...prev, customSystemPrompt: e.target.value }))}
          onBlur={(e) => persist({ customSystemPrompt: e.target.value })}
          data-testid="ai-custom-prompt"
        />
        <p className="text-[10px] text-muted-foreground">
          Appended every turn (max 8k). Cannot override SI units or CDN asset policy.
        </p>
      </div>

      {/* Allowed APIs */}
      <div className="space-y-1.5">
        <div className="font-medium text-foreground">Allowed APIs</div>
        <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto pr-0.5">
          {ALL_ALLOWABLE_PROVIDERS.map((id) => {
            const on = s.allowedProviders.includes(id);
            return (
              <label
                key={id}
                className={cn(
                  "flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 border",
                  on ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleProvider(id)}
                  className="rounded border-border"
                  data-testid={`ai-allow-${id}`}
                />
                <span className="text-[11px]">{PROVIDER_LABELS[id]}</span>
              </label>
            );
          })}
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-2"
            onClick={() =>
              persist({ allowedProviders: [...ALL_ALLOWABLE_PROVIDERS] })
            }
          >
            Allow all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-2"
            onClick={() => persist({ allowedProviders: ["ollama"] })}
          >
            Ollama only
          </Button>
        </div>
      </div>

      {/* Mode toggles */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={s.forceOffline}
            onChange={(e) => persist({ forceOffline: e.target.checked })}
            className="rounded border-border"
            data-testid="ai-force-offline"
          />
          Offline only (Ollama chain)
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={s.preferOllamaWhenAvailable}
            onChange={(e) =>
              persist({ preferOllamaWhenAvailable: e.target.checked })
            }
            className="rounded border-border"
            data-testid="ai-prefer-ollama"
          />
          Prefer Ollama when running (even online)
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={s.autoStartOllama}
            onChange={(e) => persist({ autoStartOllama: e.target.checked })}
            className="rounded border-border"
            data-testid="ai-auto-ollama"
          />
          Auto-start Ollama when opening AI / offline mode
        </label>
        <p className="text-[10px] text-muted-foreground leading-snug pl-5">
          Browser cannot spawn processes. Desktop can start Ollama when the
          bridge supports it; otherwise you&apos;ll get{" "}
          <code className="text-[10px]">ollama serve</code> instructions.
        </p>
      </div>

      <div className="space-y-1">
        <label className="font-medium text-foreground" htmlFor="ollama-base">
          Ollama URL
        </label>
        <div className="flex gap-1">
          <Input
            id="ollama-base"
            className="h-7 text-[11px]"
            value={s.ollamaBaseUrl}
            onChange={(e) =>
              setS((prev) => ({ ...prev, ollamaBaseUrl: e.target.value }))
            }
            onBlur={(e) => persist({ ollamaBaseUrl: e.target.value.trim() })}
            data-testid="ai-ollama-url"
          />
          <Button
            size="sm"
            className="h-7 text-[10px] shrink-0"
            disabled={ollamaBusy}
            onClick={() => void startOllama()}
            data-testid="ai-start-ollama"
          >
            {ollamaBusy ? "…" : "Start / check"}
          </Button>
        </div>
        {ollamaMsg && (
          <p
            className={cn(
              "text-[10px] leading-snug",
              ollamaMsg.includes("ready") || ollamaMsg.includes("started")
                ? "text-emerald-400"
                : "text-amber-300",
            )}
            data-testid="ai-ollama-msg"
          >
            {ollamaMsg}
          </p>
        )}
      </div>

      <FreeApiKeysPanel compact />
    </div>
  );
}
