/**
 * Compact BYOK panel for free API providers (Groq, OpenRouter, Gemini, …).
 * Keys live only in localStorage — never uploaded except as X-Api-Key on
 * the same-origin free-ai proxy.
 */
import { useMemo, useState } from "react";
import { KeyRound, ExternalLink, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FREE_PROVIDERS,
  getStoredApiKey,
  setStoredApiKey,
  type FreeProviderId,
} from "@/lib/ai/providers";

const ORDER: FreeProviderId[] = [
  "groq",
  "openrouter",
  "gemini",
  "cerebras",
  "deepseek",
  "together",
];

export function FreeApiKeysPanel({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<FreeProviderId, string>>>(
    {},
  );
  const [tick, setTick] = useState(0);

  const status = useMemo(() => {
    const s: Partial<Record<FreeProviderId, boolean>> = {};
    for (const id of ORDER) s[id] = Boolean(getStoredApiKey(id));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, open]);

  const savedCount = ORDER.filter((id) => status[id]).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground px-1 py-0.5 rounded"
        data-testid="button-free-api-keys"
        title="Paste free API keys (Groq, OpenRouter, Gemini…)"
      >
        <KeyRound className="size-3" />
        Free API keys{savedCount > 0 ? ` · ${savedCount}` : ""}
      </button>
    );
  }

  return (
    <div
      className={
        compact
          ? "rounded-md border border-border bg-background/80 p-2 space-y-2 text-[11px]"
          : "rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2 text-[11px]"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-foreground flex items-center gap-1.5">
          <KeyRound className="size-3.5" />
          Free API keys (stored in this browser)
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px]"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
      <p className="text-muted-foreground leading-snug">
        Keys never go to our Anthropic account. The free-ai proxy forwards them
        only to the provider you pick. Puter works without any key.
      </p>
      <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
        {ORDER.map((id) => {
          const cfg = FREE_PROVIDERS[id];
          const has = status[id];
          return (
            <div key={id} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {cfg.label}
                  {has ? (
                    <Check className="inline size-3 ml-1 text-emerald-400" />
                  ) : null}
                </span>
                <a
                  href={cfg.signupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-primary inline-flex items-center gap-0.5 hover:underline"
                >
                  Get free key
                  <ExternalLink className="size-2.5" />
                </a>
              </div>
              <div className="flex gap-1">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={has ? "•••••••• (saved — paste to replace)" : cfg.hint}
                  className="h-7 text-[11px]"
                  value={drafts[id] ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [id]: e.target.value }))
                  }
                  data-testid={`input-free-key-${id}`}
                />
                <Button
                  size="sm"
                  className="h-7 px-2 text-[10px] shrink-0"
                  onClick={() => {
                    const v = drafts[id]?.trim();
                    if (v) {
                      setStoredApiKey(id, v);
                      setDrafts((d) => ({ ...d, [id]: "" }));
                      setTick((t) => t + 1);
                    }
                  }}
                  disabled={!drafts[id]?.trim()}
                >
                  Save
                </Button>
                {has ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5 shrink-0"
                    title="Remove saved key"
                    onClick={() => {
                      setStoredApiKey(id, null);
                      setTick((t) => t + 1);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
