import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Console } from "./Console";
import { AssetBrowser } from "./AssetBrowser";
import { ScriptEditor } from "./ScriptEditor";
import { PrefabsPanel } from "./PrefabsPanel";
import { useEditor } from "@/store/editor";
import { Terminal, Boxes, Code2, Package } from "lucide-react";

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
      </TabsList>
      <div className="flex-1 min-h-0">
        <TabsContent value="console" className="m-0 h-full">
          <Console />
        </TabsContent>
        <TabsContent value="assets" className="m-0 h-full">
          <AssetBrowser />
        </TabsContent>
        <TabsContent value="scripts" className="m-0 h-full">
          <ScriptEditor />
        </TabsContent>
        <TabsContent value="prefabs" className="m-0 h-full">
          <PrefabsPanel />
        </TabsContent>
      </div>
    </Tabs>
  );
}
