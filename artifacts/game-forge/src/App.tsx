import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { Toolbar } from "@/editor/Toolbar";
import { Hierarchy } from "@/editor/Hierarchy";
import { Inspector } from "@/editor/Inspector";
import { Viewport } from "@/editor/Viewport";
import { BottomPanel } from "@/editor/BottomPanel";
import { ProjectPicker } from "@/editor/ProjectPicker";
import { useEditor } from "@/store/editor";
import { useListProjects } from "@workspace/api-client-react";
import { Sparkles } from "lucide-react";

function EditorShell() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const projectId = useEditor((s) => s.projectId);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const pushLog = useEditor((s) => s.pushLog);
  const isPlaying = useEditor((s) => s.isPlaying);
  const togglePlay = useEditor((s) => s.togglePlay);

  const { data: projects } = useListProjects();

  // Auto-open picker if no project loaded
  useEffect(() => {
    if (!projectId && projects && projects.length === 0) {
      setPickerOpen(true);
    }
  }, [projectId, projects]);

  // Welcome log
  useEffect(() => {
    pushLog("info", "GameForge ready · Three.js · Rapier · R3F · Blazor C# transpiler loaded");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hotkeys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if (e.key === "w") setTransformMode("translate");
      if (e.key === "e") setTransformMode("rotate");
      if (e.key === "r") setTransformMode("scale");
      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTransformMode, togglePlay]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden text-foreground">
      <Toolbar onOpenProjects={() => setPickerOpen(true)} />

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={70} minSize={30}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={18} minSize={12} maxSize={30}>
                <Hierarchy />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={62}>
                <Viewport />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={20} minSize={14} maxSize={32}>
                <Inspector />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={30} minSize={12}>
            <BottomPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ProjectPicker open={pickerOpen} onOpenChange={setPickerOpen} />

      {!projectId && !pickerOpen && (
        <button
          onClick={() => setPickerOpen(true)}
          className="absolute inset-0 m-auto h-fit w-fit px-6 py-4 rounded-lg bg-primary/15 text-primary border border-primary/40 backdrop-blur flex items-center gap-2 shadow-2xl hover-elevate"
        >
          <Sparkles className="size-5" />
          Open or create a project to begin
        </button>
      )}

      {isPlaying && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-accent/20 border border-accent text-accent text-xs font-mono pointer-events-none shadow-lg">
          PLAY MODE · Space to stop
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EditorShell />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
