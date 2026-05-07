import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useBakeProgress, type BakeProgressEntry } from "@/store/bakeProgress";

/**
 * Floating per-entity progress indicators for in-flight collider bakes.
 *
 * Sits next to the shadcn `<Toaster/>` at the App root so it survives
 * editor-shell crashes. Each entry tracks one `bakeEntityConvexHulls`
 * call: while running, shows a spinner + entity name + live elapsed
 * time + any worker warnings (V-HACD load failure, quickhull fallback);
 * on completion, shows a brief success/error summary then auto-dismisses.
 */
const AUTO_DISMISS_MS = 5000;

export function BakeProgressToasts() {
  const entries = useBakeProgress((s) => s.entries);
  const remove = useBakeProgress((s) => s.remove);

  // Auto-dismiss completed entries after the grace window.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const e of entries) {
      if (e.status === "running" || !e.completedAt) continue;
      const remaining = e.completedAt + AUTO_DISMISS_MS - Date.now();
      timers.push(
        setTimeout(() => remove(e.entityId), Math.max(0, remaining)),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [entries, remove]);

  if (entries.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
      data-testid="bake-progress-toasts"
    >
      {entries.map((e) => (
        <BakeProgressToast key={e.entityId} entry={e} onDismiss={remove} />
      ))}
    </div>
  );
}

function BakeProgressToast({
  entry,
  onDismiss,
}: {
  entry: BakeProgressEntry;
  onDismiss: (entityId: string) => void;
}) {
  // Tick once per second so elapsed time updates while running.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (entry.status !== "running") return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [entry.status]);

  const endedAt = entry.completedAt ?? Date.now();
  const elapsedSec = Math.max(0, Math.round((endedAt - entry.startedAt) / 100) / 10);

  const icon =
    entry.status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    ) : entry.status === "ok" ? (
      <Check className="h-3.5 w-3.5 text-emerald-500" />
    ) : (
      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
    );

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`bake-progress-toast-${entry.entityId}`}
      data-status={entry.status}
      className="pointer-events-auto w-80 rounded-md border border-border bg-popover/95 backdrop-blur shadow-lg p-2.5 text-xs"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">
              {entry.status === "running"
                ? "Baking colliders"
                : entry.status === "ok"
                  ? "Baked colliders"
                  : "Bake failed"}
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
              {elapsedSec.toFixed(1)}s
            </span>
          </div>
          <div className="text-muted-foreground truncate" title={entry.entityName}>
            {entry.entityName}
          </div>
          {entry.summary && (
            <div
              className={
                "mt-1 " +
                (entry.status === "error" ? "text-destructive" : "text-foreground/80")
              }
            >
              {entry.summary}
            </div>
          )}
          {entry.warnings.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {entry.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex gap-1 text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span>{w.message}</span>
                    {w.detail && (
                      <span className="block text-[10px] opacity-80 truncate">
                        {w.detail}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {entry.status !== "running" && (
          <button
            type="button"
            onClick={() => onDismiss(entry.entityId)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            data-testid={`bake-progress-dismiss-${entry.entityId}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
