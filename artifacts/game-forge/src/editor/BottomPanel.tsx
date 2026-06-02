import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Console } from "./Console";
import { AssetBrowser } from "./AssetBrowser";
import { PrefabsPanel } from "./PrefabsPanel";
import { LayersPanel } from "./LayersPanel";
import { useEditor } from "@/store/editor";
import {
  Terminal,
  Boxes,
  Code2,
  Package,
  Loader2,
  Network,
  FlaskConical,
  Shield,
} from "lucide-react";
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

type LibrarySubTab = "assets" | "prefabs";

interface LibrarySubNavProps {
  tab: string;
  setTab: (t: LibrarySubTab) => void;
}

function LibrarySubNav({ tab, setTab }: LibrarySubNavProps) {
  const activeAssets = tab !== "prefabs";
  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50 shrink-0 bg-background/30">
      <button
        type="button"
        onClick={() => setTab("assets")}
        data-testid="library-sub-assets"
        title="Project assets (Ctrl+Shift+A)"
        className={
          "flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium transition-colors " +
          (activeAssets
            ? "bg-accent/20 text-accent"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/10")
        }
      >
        <Boxes className="size-3" /> Files
      </button>
      <button
        type="button"
        onClick={() => setTab("prefabs")}
        data-testid="library-sub-prefabs"
        title="Prefab templates (Ctrl+Shift+B)"
        className={
          "flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium transition-colors " +
          (!activeAssets
            ? "bg-accent/20 text-accent"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/10")
        }
      >
        <Package className="size-3" /> Prefabs
      </button>
    </div>
  );
}

export function BottomPanel() {
  const tab = useEditor((s) => s.bottomTab);
  const setTab = useEditor((s) => s.setBottomTab);

  // "prefabs" is a sub-view of the "assets" Radix tab so the tab strip stays
  // at 5 entries. When the store says "prefabs", the Library tab is active and
  // the inner sub-nav switches to the Prefabs panel.
  const radixTab = tab === "prefabs" ? "assets" : tab;

  return (
    <Tabs
      value={radixTab}
      onValueChange={(v) => setTab(v as typeof tab)}
      className="flex flex-col h-full"
    >
      <TabsList className="rounded-none w-fit mx-2 mt-1.5 shrink-0">
        <TabsTrigger value="console" className="text-xs gap-1.5" data-testid="tab-console" title="Console — runtime output (Ctrl+`)">
          <Terminal className="size-3" /> Console
        </TabsTrigger>
        <TabsTrigger value="scripts" className="text-xs gap-1.5" data-testid="tab-scripts" title="Scripts — Monaco editor (Ctrl+Shift+S)">
          <Code2 className="size-3" /> Scripts
        </TabsTrigger>
        <TabsTrigger value="nodes" className="text-xs gap-1.5" data-testid="tab-nodes" title="Nodes — visual scripting (Ctrl+Shift+N)">
          <Network className="size-3" /> Nodes
        </TabsTrigger>
        <div className="w-px h-4 bg-border/60 mx-1 self-center" aria-hidden />
        <TabsTrigger value="assets" className="text-xs gap-1.5" data-testid="tab-assets" title="Library — assets & prefabs (Ctrl+Shift+A)">
          <FlaskConical className="size-3" /> Library
        </TabsTrigger>
        <TabsTrigger value="layers" className="text-xs gap-1.5" data-testid="tab-layers" title="Physics — collision matrix & navmesh (Ctrl+Shift+L)">
          <Shield className="size-3" /> Physics
        </TabsTrigger>
      </TabsList>
      <div className="flex-1 min-h-0">
        <TabsContent value="console" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0"><Console /></div>
          <AIInlinePrompt tabContext="console" />
        </TabsContent>
        <TabsContent value="scripts" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0">
            <Suspense fallback={<ScriptEditorFallback />}>
              <ScriptEditor />
            </Suspense>
          </div>
          <AIInlinePrompt tabContext="scripts" />
        </TabsContent>
        <TabsContent value="nodes" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0">
            <Suspense fallback={<ScriptEditorFallback />}>
              <NodesPanel />
            </Suspense>
          </div>
          <AIInlinePrompt tabContext="nodes" />
        </TabsContent>
        <TabsContent value="assets" className="m-0 h-full flex flex-col">
          <LibrarySubNav tab={tab} setTab={(t) => setTab(t)} />
          <div className="flex-1 min-h-0">
            {tab === "prefabs" ? <PrefabsPanel /> : <AssetBrowser />}
          </div>
          <AIInlinePrompt tabContext={tab === "prefabs" ? "prefabs" : "assets"} />
        </TabsContent>
        <TabsContent value="layers" className="m-0 h-full flex flex-col">
          <div className="flex-1 min-h-0"><LayersPanel /></div>
          <AIInlinePrompt tabContext="layers" />
        </TabsContent>
      </div>
    </Tabs>
  );
}
