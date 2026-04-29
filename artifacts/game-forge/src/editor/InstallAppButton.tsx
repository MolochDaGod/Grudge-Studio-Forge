import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { onInstallableChange, promptInstall, isStandalone } from "@/lib/pwa";
import { useEditor } from "@/store/editor";

export function InstallAppButton() {
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(() => isStandalone());
  const pushLog = useEditor((s) => s.pushLog);

  useEffect(() => {
    return onInstallableChange((v) => setInstallable(v));
  }, []);

  useEffect(() => {
    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  if (installed) return null;
  if (!installable) return null;

  const onClick = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      pushLog("info", "Grudge GameForge installed as a desktop app.");
    } else if (outcome === "unavailable") {
      pushLog(
        "warn",
        "Install prompt is no longer available — refresh and try again from a top-level user click.",
      );
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClick}
          className="text-accent hover:text-accent"
          data-testid="button-install-pwa"
        >
          <Download className="size-4 mr-1.5" />
          Install
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Install Grudge GameForge as a standalone desktop app.
      </TooltipContent>
    </Tooltip>
  );
}
