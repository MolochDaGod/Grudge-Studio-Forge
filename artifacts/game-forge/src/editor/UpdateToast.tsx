import { useEffect, useState } from "react";
import { useDesktopBridge, type UpdateState } from "@workspace/desktop-bridge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { X, Download } from "lucide-react";

export function UpdateToast() {
  const desktop = useDesktopBridge();
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    return desktop.updates.onChange((s) => {
      setDismissed(false);
      setState(s);
    });
  }, [desktop]);

  if (!desktop || !state || dismissed) return null;
  if (state.status === "idle" || state.status === "uptodate" || state.status === "checking") {
    return null;
  }

  const restart = () => void desktop.updates.quitAndInstall();

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[320px] rounded-md border bg-background shadow-lg p-3 space-y-2"
      data-testid="toast-update"
    >
      <div className="flex items-start gap-2">
        <Download className="size-4 mt-0.5 text-primary" />
        <div className="flex-1 text-sm">
          <div className="font-medium">
            {state.status === "downloaded" ? "Update ready" : "Update available"}
            {state.version && (
              <span className="ml-1 text-muted-foreground">
                v{state.version}
              </span>
            )}
          </div>
          {state.message && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {state.message}
            </div>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>
      {state.status === "downloading" && typeof state.progress === "number" && (
        <Progress value={state.progress * 100} />
      )}
      {state.status === "downloaded" && (
        <Button size="sm" onClick={restart} data-testid="button-update-restart" className="w-full">
          Restart and install
        </Button>
      )}
      {state.status === "error" && (
        <div className="text-xs text-destructive">{state.message}</div>
      )}
    </div>
  );
}
