/**
 * Template loading dialog with a real, determinate progress bar.
 *
 * UX contract:
 *   1. First 150ms after open → an indeterminate pulsing strip is
 *      shown (the bar is always present once the dialog opens, but it
 *      does NOT display a determinate percentage yet). This avoids a
 *      jarring "pop in" at e.g. 73% on cached/instant responses where
 *      `headers` arrives in <5ms.
 *   2. After 150ms AND once we have a determinate value → switches to
 *      Radix Progress in determinate mode, clamped to 99% until the
 *      stream completes. (If 150ms elapses before any determinate
 *      value is known, the indeterminate strip continues to animate.)
 *   3. On `complete` event → bar jumps to 100% and we hold for 250ms
 *      so the user sees the full bar before the dialog dismisses.
 *      Without that hold the modal can vanish before the eye registers
 *      the jump from ~95% to done.
 *   4. Cancel button → calls the parent's `onCancel`, which aborts the
 *      AbortController upstream. The fetch promise rejects with
 *      AbortError; the parent then closes the dialog without showing a
 *      "load failed" toast.
 */
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { TemplateLoadProgress } from "@/lib/loadTemplate";

const INDETERMINATE_FLASH_MS = 150;

export interface TemplateLoadingDialogProps {
  open: boolean;
  label: string;
  progress: TemplateLoadProgress | null;
  onCancel: () => void;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function TemplateLoadingDialog({
  open,
  label,
  progress,
  onCancel,
}: TemplateLoadingDialogProps) {
  // `flashElapsed` flips true after INDETERMINATE_FLASH_MS, gating the
  // determinate bar's appearance. We deliberately key the timer off
  // `open` so reopening the dialog gives a fresh anti-flash window.
  const [flashElapsed, setFlashElapsed] = useState(false);
  const openedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setFlashElapsed(false);
      openedAt.current = null;
      return;
    }
    openedAt.current = Date.now();
    const t = window.setTimeout(() => setFlashElapsed(true), INDETERMINATE_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  // Compute the displayed percentage. Three cases:
  //   • headers/no-total → indeterminate (return null, render nothing)
  //   • progress with total → received/total clamped to [0, 99]
  //   • complete → 100
  let pct: number | null = null;
  if (progress) {
    if (progress.phase === "complete") {
      pct = 100;
    } else if (
      (progress.phase === "progress" || progress.phase === "headers") &&
      progress.total &&
      progress.total > 0
    ) {
      const raw = (progress.received / progress.total) * 100;
      pct = Math.min(99, Math.max(0, raw));
    }
  }

  // Strict anti-flash contract: for the FIRST 150ms the bar is always
  // indeterminate, even if `headers` / `progress` events have already
  // produced a determinate value (a fast localhost or cached response
  // can emit headers in <5ms). After 150ms we switch to determinate if
  // we have a value, else stay indeterminate until the stream resolves.
  // Without the strict gate, the determinate bar can "pop in" at e.g.
  // 0% or 73% before the user's eye has even seen the dialog.
  const showBar = true;
  const renderDeterminate = flashElapsed && pct != null;

  const received = progress?.received ?? 0;
  const total = progress?.total ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="template-loading-dialog"
        // Radix closes on Esc by default — route through onCancel so we
        // also abort the in-flight fetch.
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
      >
        <DialogHeader>
          <DialogTitle>Loading template</DialogTitle>
          <DialogDescription>
            Streaming{" "}
            <span className="text-foreground font-medium">{label}</span> from the
            cloud — this is downloaded once then cached locally.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-2">
          <div className="h-2">
            {showBar &&
              (renderDeterminate ? (
                <Progress
                  value={pct ?? 0}
                  data-testid="template-loading-progress"
                />
              ) : (
                // Indeterminate: a subtle pulsing strip. Radix Progress
                // doesn't ship an indeterminate visual out of the box,
                // so we use a Tailwind animate-pulse bar.
                <div
                  className="h-full w-full overflow-hidden rounded-full bg-secondary"
                  data-testid="template-loading-progress-indeterminate"
                >
                  <div className="h-full w-1/3 bg-primary/60 animate-pulse" />
                </div>
              ))}
          </div>

          <div
            className="text-xs text-muted-foreground font-mono tabular-nums flex justify-between"
            data-testid="template-loading-bytes"
          >
            <span>
              {total != null ? `${formatKb(received)} / ${formatKb(total)}` : formatKb(received)}
            </span>
            <span>{renderDeterminate && pct != null ? `${pct.toFixed(0)}%` : "starting…"}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            data-testid="template-loading-cancel"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
