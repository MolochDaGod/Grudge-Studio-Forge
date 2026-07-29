/**
 * Help → Best Services — free + fleet services for the customized Three.js editor.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Sparkles, Plug, KeyRound, Activity } from "lucide-react";
import { useEditor } from "@/store/editor";
import {
  servicesByCategory,
  SERVICE_TIER_LABEL,
  type BestService,
} from "@/lib/bestServices";
import {
  fetchCatalogStatus,
  type CatalogStatus,
} from "@/lib/agentEdge";

function fire(name: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function openAssets(
  tab:
    | "fast"
    | "ph-models"
    | "ph-textures"
    | "ph-hdris"
    | "weapons"
    | "items"
    | "project",
) {
  useEditor.getState().setBottomTab("assets");
  setTimeout(() => fire("gameforge:focusAssetTab", tab), 0);
}

function runServiceAction(svc: BestService, onClose: () => void) {
  const a = svc.editorAction;
  if (a === "open-assets-fast") {
    openAssets("fast");
    onClose();
    return;
  }
  if (a === "open-assets-polyhaven-models") {
    openAssets("ph-models");
    onClose();
    return;
  }
  if (a === "open-assets-polyhaven-textures") {
    openAssets("ph-textures");
    onClose();
    return;
  }
  if (a === "open-assets-polyhaven-hdris") {
    openAssets("ph-hdris");
    onClose();
    return;
  }
  if (a === "open-ai-worker") {
    fire("gameforge:toggleAIWorker");
    onClose();
    return;
  }
  if (a === "open-free-api-keys") {
    fire("gameforge:toggleAIWorker");
    // Free keys panel lives inside AI Worker; toast-level nudge via log
    useEditor
      .getState()
      .pushLog("info", "AI Worker open · paste free API keys in the Free API keys panel");
    onClose();
    return;
  }
  if (a === "open-projects") {
    fire("gameforge:openProjects");
    onClose();
    return;
  }
  window.open(svc.url, "_blank", "noopener,noreferrer");
}

const TIER_CLASS: Record<string, string> = {
  fleet: "border-amber-500/40 text-amber-300/90",
  free: "border-emerald-500/40 text-emerald-300/90",
  byok: "border-sky-500/40 text-sky-300/90",
  local: "border-violet-500/40 text-violet-300/90",
};

export function BestServicesPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = servicesByCategory();
  const [stack, setStack] = useState<CatalogStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchCatalogStatus().then((s) => {
      if (!cancelled) setStack(s);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        data-testid="dialog-best-services"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-amber-400" />
            Best services · free Three.js editor
          </DialogTitle>
          <DialogDescription>
            Grudge Forge is a free, customized three.js / R3F editor. These are
            the fleet services and free externals already wired (or one click
            away). BYOK keys stay in your browser.
          </DialogDescription>
        </DialogHeader>

        {stack && (
          <div
            className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs flex flex-wrap items-center gap-2"
            data-testid="best-services-stack-status"
          >
            <Activity className="size-3.5 text-emerald-400 shrink-0" />
            <span className="font-medium text-foreground/90">Agent edge</span>
            <Badge variant="outline" className="text-[10px] h-5">
              {stack.service}
            </Badge>
            <span className="text-muted-foreground">
              Fast catalog · {stack.fastAssetCount}
            </span>
            <span className="text-muted-foreground">
              D1 · {stack.d1 ? "on" : "memory"}
            </span>
            {(stack.stack || []).slice(0, 4).map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="text-[10px] h-5 font-normal"
              >
                {s}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1 space-y-5 text-sm">
          {groups.map((g) => (
            <section key={g.category}>
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
                {g.label}
              </h3>
              <ul className="space-y-1.5">
                {g.items.map((svc) => (
                  <li
                    key={svc.id}
                    className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span className="font-medium text-foreground text-[13px]">
                          {svc.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] h-4 px-1.5 ${TIER_CLASS[svc.tier] ?? ""}`}
                        >
                          {SERVICE_TIER_LABEL[svc.tier]}
                        </Badge>
                        {svc.wired ? (
                          <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-400/90">
                            <Plug className="size-2.5" />
                            wired
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {svc.blurb}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 shrink-0 text-[10px] gap-1"
                      onClick={() => runServiceAction(svc, () => onOpenChange(false))}
                      data-testid={`button-service-${svc.id}`}
                    >
                      {svc.editorAction ? "Open" : "Visit"}
                      <ExternalLink className="size-2.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <KeyRound className="size-3" />
            Free API keys: AI Worker panel · never leave your machine except to the provider
          </p>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Listen for Help menu / deep link `gameforge:openBestServices`. */
export function useBestServicesHotOpen(
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener("gameforge:openBestServices", open);
    return () => window.removeEventListener("gameforge:openBestServices", open);
  }, [setOpen]);
}
