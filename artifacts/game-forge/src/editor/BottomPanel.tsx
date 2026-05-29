import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Console } from "./Console";
import { AssetBrowser } from "./AssetBrowser";
import { PrefabsPanel } from "./PrefabsPanel";
import { LayersPanel } from "./LayersPanel";
import { useEditor } from "@/store/editor";
import { Terminal, Boxes, Code2, Package, Loader2, Network, Layers as LayersIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { AIInlinePrompt } from "./AIInlinePrompt";

/**
 * Monaco's editor is the second-heaviest dependency in the bundle (and the
 * only Tab content most users won't open every session). We mount the panel
 * lazily so its chunk is only fetched when the Scripts tab is selected. The
 * radix Tabs component already gates `TabsContent` rendering on the active
 * value, so the import is naturally deferred to first reveal.
 */
const ScriptEditor = lazy(() =>
  import("./ScriptEditor").then((m) => ({ default: m.ScriptEditor })),
);

/**
 * The Nodes panel pulls in @xyflow/react (~120 KB gzipped) plus the scene-graph
 * compiler. Lazy so it stays out of the initial bundle for users who don't open
 * the visual editor.
 */
const NodesPanel = lazy(() =>
  import("./NodesPanel").then((m) => ({ default: m.NodesPanel })),
);

function ScriptEditorFallback() {
  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground gap-2">
      <Loader2 className="size-3 animate-spin" /> Loading script editor…
    </div>
  );
}

export function BottomPanel() {
  const tab = useEditor((s) => s.bottomTab);
  const setTab = useEditor((s) => s.setBottomTab);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex flex-col h-full">
      <TabsList className="rounded-none w-fit mx-2 mt-1.5 shrink-0">
        <TabsTrigger value="console" className="text-xs gap-1.5" data-testid="tab-console">
          <Terminal className="size-3" /> Console
        </TabsTrigger>
        <TabsTrigger value="assets" className="text-xs gap-1.5" data-testid="tab-assets">
          <Boxes className="size-3" /> Assets
        </TabsTrigger>
        <TabsTrigger value="scripts" className="text-xs gap-1.5" data-testid="tab-scripts">
          <Code2 className="size-3" /> Scripts
        </TabsTrigger>
        <TabsTrigger value="prefabs" className="text-xs gap-1.5" data-testid="tab-prefabs">
          <Package className="size-3" /> Prefabs
        </TabsTrigger>
        <TabsTrigger value="nodes" className="text-xs gap-1.5" data-testid="tab-nodes">
          <Network className="size-3" /> Nodes
        </TabsTrigger>
        <TabsTrigger value="layers" className="text-xs gap-1.5" data-testid="tab-layers">
          <LayersIcon className="size-3" /> Layers
        </TabsTrigger>
      </TabsList>
      <div className="flex-1 min-h-0">
        <TabsContent value="console" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0"><Console /></div>
          <AIInlinePrompt tabContext="console" />
        </TabsContent>
        <TabsContent value="assets" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0"><AssetBrowser /></div>
          <AIInlinePrompt tabContext="assets" />
        </TabsContent>
        <TabsContent value="scripts" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0">
            <Suspense fallback={<ScriptEditorFallback />}>
              <ScriptEditor />
            </Suspense>
          </div>
          <AIInlinePrompt tabContext="scripts" />
        </TabsContent>
        <TabsContent value="prefabs" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0"><PrefabsPanel /></div>
          <AIInlinePrompt tabContext="prefabs" />
        </TabsContent>
        <TabsContent value="nodes" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0">
            <Suspense fallback={<ScriptEditorFallback />}>
              <NodesPanel />
            </Suspense>
          </div>
          <AIInlinePrompt tabContext="nodes" />
        </TabsContent>
        <TabsContent value="layers" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0"><LayersPanel /></div>
          <AIInlinePrompt tabContext="layers" />
        </TabsContent>
      </div>
    </Tabs>
  );
}
