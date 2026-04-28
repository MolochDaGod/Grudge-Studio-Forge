import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useGetGrudgeWeapons,
  useGetGrudgeItems,
  useGetGrudgeEnemies,
  useGetGrudgeQuests,
  useListAssets,
  useCreateAsset,
  useDeleteAsset,
  getListAssetsQueryKey,
  getGetProjectSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditor } from "@/store/editor";
import { Sword, Package, Skull, Scroll, Plus, ExternalLink, Loader2, Trash2, Search } from "lucide-react";
import { getTierColor, type GrudgeItem } from "@/lib/grudge";

function GrudgeGrid({
  loading,
  items,
  type,
  EmptyIcon,
}: {
  loading: boolean;
  items: GrudgeItem[];
  type: "weapon" | "item" | "enemy" | "quest";
  EmptyIcon: typeof Sword;
}) {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const addEntity = useEditor((s) => s.addEntity);
  const updateEntity = useEditor((s) => s.updateEntity);
  const qc = useQueryClient();
  const createAsset = useCreateAsset();
  const [query, setQuery] = useState("");

  const filtered = items.filter((it) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return JSON.stringify(it).toLowerCase().includes(q);
  });

  const importAsset = async (it: GrudgeItem) => {
    if (!projectId) {
      pushLog("warn", "Open a project first");
      return;
    }
    const name = String(it.name ?? it.key ?? it.id ?? `Grudge ${type}`);
    const url = String(it.model ?? it.icon ?? "");
    await createAsset.mutateAsync({
      data: {
        projectId,
        name,
        url,
        type: url.match(/\.(glb|gltf)$/i) ? "model" : "image",
        source: "grudge",
      },
    });
    qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    pushLog("info", `Imported "${name}" from Grudge Studio`);
  };

  const spawn = (it: GrudgeItem) => {
    if (!projectId) {
      pushLog("warn", "Open a project first");
      return;
    }
    const name = String(it.name ?? it.key ?? it.id ?? `Grudge ${type}`);
    const url = String(it.model ?? "");
    if (url && /\.(glb|gltf)$/i.test(url)) {
      const e = addEntity("model", name);
      updateEntity(e.id, (d) => {
        d.model = { url };
      });
    } else {
      const e = addEntity("box", name);
      const tierHex = typeof it.tier === "number" ? getTierColor(it.tier).hex : "#9b6dff";
      updateEntity(e.id, (d) => {
        if (!d.material) d.material = {};
        d.material.color = tierHex;
        d.material.emissive = tierHex;
      });
    }
    pushLog("info", `Spawned "${name}" into the scene`);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Fetching from Grudge Studio…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-border flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${type}s…`}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">{filtered.length}/{items.length}</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 p-2">
          {filtered.map((it, idx) => {
            const name = String(it.name ?? it.key ?? it.id ?? `${type} ${idx}`);
            const tier = typeof it.tier === "number" ? it.tier : null;
            const tierColor = tier ? getTierColor(tier) : null;
            const desc = String(it.description ?? it.category ?? it.type ?? "");
            return (
              <div
                key={`${name}-${idx}`}
                className="group relative bg-card border border-card-border rounded-md p-2 hover-elevate"
                data-testid={`grudge-item-${idx}`}
              >
                <div
                  className="aspect-square rounded mb-2 flex items-center justify-center text-2xl border"
                  style={{
                    backgroundColor: tierColor ? `${tierColor.hex}22` : "hsl(var(--muted))",
                    borderColor: tierColor ? `${tierColor.hex}66` : "hsl(var(--border))",
                  }}
                >
                  <EmptyIcon className="size-8" style={{ color: tierColor?.hex ?? "hsl(var(--muted-foreground))" }} />
                </div>
                <div className="text-xs font-medium truncate" title={name}>
                  {name}
                </div>
                {desc && (
                  <div className="text-[10px] text-muted-foreground truncate" title={desc}>
                    {desc}
                  </div>
                )}
                {tier && (
                  <div
                    className="text-[10px] font-mono mt-1"
                    style={{ color: tierColor?.hex }}
                  >
                    Tier {tier} · {tierColor?.name}
                  </div>
                )}
                <div className="absolute inset-x-1 bottom-1 flex gap-1 opacity-0 group-hover:opacity-100">
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-1 h-6 text-[10px]"
                    onClick={() => spawn(it)}
                    data-testid={`button-spawn-${idx}`}
                  >
                    <Plus className="size-3 mr-1" /> Spawn
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2"
                    onClick={() => importAsset(it)}
                    title="Save to project assets"
                  >
                    <ExternalLink className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-full text-xs text-muted-foreground text-center py-8">No matches.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ProjectAssets() {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const addEntity = useEditor((s) => s.addEntity);
  const updateEntity = useEditor((s) => s.updateEntity);
  const qc = useQueryClient();
  const { data: assets = [], isLoading } = useListAssets(projectId ?? 0, {
    query: { queryKey: getListAssetsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const createAsset = useCreateAsset();
  const deleteAsset = useDeleteAsset();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const onAdd = async () => {
    if (!projectId || !name.trim() || !url.trim()) return;
    const isModel = /\.(glb|gltf)$/i.test(url);
    await createAsset.mutateAsync({
      data: {
        projectId,
        name: name.trim(),
        url: url.trim(),
        type: isModel ? "model" : "image",
        source: "url",
      },
    });
    qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    setName("");
    setUrl("");
    pushLog("info", `Added asset "${name}"`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-border flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Asset name"
          className="h-7 text-xs flex-1"
          data-testid="input-asset-name"
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://...glb"
          className="h-7 text-xs flex-[2]"
          data-testid="input-asset-url"
        />
        <Button size="sm" className="h-7" onClick={onAdd} disabled={!projectId || !name || !url}>
          <Plus className="size-3 mr-1" /> Add
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {isLoading && <p className="text-xs text-muted-foreground p-3">Loading…</p>}
        {!isLoading && assets.length === 0 && (
          <p className="text-xs text-muted-foreground p-3 text-center">
            No assets yet. Import from Grudge Studio or paste a URL above.
          </p>
        )}
        <div className="p-2 space-y-1">
          {assets.map((a) => (
            <div
              key={a.id}
              className="group flex items-center gap-2 p-1.5 rounded hover-elevate text-xs"
              data-testid={`asset-row-${a.id}`}
            >
              <span className="font-mono text-[10px] uppercase text-muted-foreground w-12 shrink-0">{a.type}</span>
              <span className="font-medium truncate flex-1">{a.name}</span>
              <span className="text-[10px] text-muted-foreground/70 truncate max-w-[200px]">{a.url}</span>
              {a.type === "model" && a.url && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] opacity-0 group-hover:opacity-100"
                  onClick={() => {
                    const e = addEntity("model", a.name);
                    updateEntity(e.id, (d) => {
                      d.model = { url: a.url };
                    });
                  }}
                >
                  <Plus className="size-3 mr-1" /> Spawn
                </Button>
              )}
              <button
                onClick={async () => {
                  if (!projectId) return;
                  await deleteAsset.mutateAsync({ id: a.id });
                  qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
                  qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export function AssetBrowser() {
  const weapons = useGetGrudgeWeapons();
  const items = useGetGrudgeItems();
  const enemies = useGetGrudgeEnemies();
  const quests = useGetGrudgeQuests();

  return (
    <Tabs defaultValue="weapons" className="flex flex-col h-full">
      <TabsList className="rounded-none w-fit mx-2 mt-1.5">
        <TabsTrigger value="weapons" className="text-xs gap-1.5">
          <Sword className="size-3" /> Weapons
        </TabsTrigger>
        <TabsTrigger value="items" className="text-xs gap-1.5">
          <Package className="size-3" /> Items
        </TabsTrigger>
        <TabsTrigger value="enemies" className="text-xs gap-1.5">
          <Skull className="size-3" /> Enemies
        </TabsTrigger>
        <TabsTrigger value="quests" className="text-xs gap-1.5">
          <Scroll className="size-3" /> Quests
        </TabsTrigger>
        <TabsTrigger value="project" className="text-xs">
          Project Assets
        </TabsTrigger>
      </TabsList>
      <div className="flex-1 min-h-0">
        <TabsContent value="weapons" className="m-0 h-full">
          <GrudgeGrid loading={weapons.isLoading} items={weapons.data?.items ?? []} type="weapon" EmptyIcon={Sword} />
        </TabsContent>
        <TabsContent value="items" className="m-0 h-full">
          <GrudgeGrid loading={items.isLoading} items={items.data?.items ?? []} type="item" EmptyIcon={Package} />
        </TabsContent>
        <TabsContent value="enemies" className="m-0 h-full">
          <GrudgeGrid loading={enemies.isLoading} items={enemies.data?.items ?? []} type="enemy" EmptyIcon={Skull} />
        </TabsContent>
        <TabsContent value="quests" className="m-0 h-full">
          <GrudgeGrid loading={quests.isLoading} items={quests.data?.items ?? []} type="quest" EmptyIcon={Scroll} />
        </TabsContent>
        <TabsContent value="project" className="m-0 h-full">
          <ProjectAssets />
        </TabsContent>
      </div>
    </Tabs>
  );
}
