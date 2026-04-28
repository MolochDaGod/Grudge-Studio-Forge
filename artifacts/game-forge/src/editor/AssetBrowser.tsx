import { useState, useRef } from "react";
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
import { useUpload } from "@workspace/object-storage-web";
import { useEditor } from "@/store/editor";
import { Sword, Package, Skull, Scroll, Plus, ExternalLink, Loader2, Trash2, Search, Upload } from "lucide-react";
import { getTierColor, type GrudgeItem } from "@/lib/grudge";

function classifyAsset(name: string, contentType: string): "model" | "image" | "audio" | "texture" | "other" {
  if (/\.(glb|gltf|fbx|obj)$/i.test(name)) return "model";
  if (/^audio\//.test(contentType) || /\.(mp3|wav|ogg|m4a)$/i.test(name)) return "audio";
  if (/\.(png|jpe?g|webp|ktx2)$/i.test(name) && /texture|normal|albedo|roughness/i.test(name)) return "texture";
  if (/^image\//.test(contentType)) return "image";
  return "other";
}

/**
 * Single asset card. Compact, click-to-spawn, with three layers of visual
 * fallback so every card always shows *something* meaningful:
 *
 *   1. `imageUrl`  — real PNG sprite from Grudge (loaded lazily). If the
 *                    request 404s or errors we silently swap to layer 2.
 *   2. `emoji`     — the unicode glyph the catalog ships for the item
 *                    (e.g. "⚔️" for swords, "🧪" for potions). This is the
 *                    common case — the Grudge feed has no PNG sprites today.
 *   3. `EmptyIcon` — the tab's category Lucide icon, tinted by tier. This
 *                    catches items with neither image nor emoji.
 *
 * Clicking the card spawns; the small "save" overlay (top-right) imports the
 * asset into the project's asset list without spawning. We keep the import
 * action visible-on-hover so the dense grid stays readable, but the spawn
 * action is the entire card so the cards feel like prefab tiles.
 */
function AssetCard({
  it,
  idx,
  type,
  EmptyIcon,
  onSpawn,
  onImport,
}: {
  it: GrudgeItem;
  idx: number;
  type: "weapon" | "item" | "enemy" | "quest";
  EmptyIcon: typeof Sword;
  onSpawn: (it: GrudgeItem) => void;
  onImport: (it: GrudgeItem) => void;
}) {
  const name = String(it.name ?? it.key ?? it.id ?? `${type} ${idx}`);
  const tier = typeof it.tier === "number" ? it.tier : null;
  const tierColor = tier ? getTierColor(tier) : null;
  const desc = typeof it.description === "string" ? it.description : "";
  const emoji = typeof it.emoji === "string" ? it.emoji : "";
  const imageUrl = typeof it.imageUrl === "string" ? it.imageUrl : "";
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!imageUrl && !imgFailed;

  const tooltip = [name, desc, tier ? `Tier ${tier} · ${tierColor?.name}` : ""]
    .filter(Boolean)
    .join("\n");

  return (
    // Card root is a div+role="button" instead of a real <button> so we can
    // safely nest a real <button> for the import overlay. Nesting interactive
    // elements inside a <button> is invalid HTML and breaks keyboard / screen
    // reader behavior.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSpawn(it)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSpawn(it);
        }
      }}
      title={tooltip}
      aria-label={`Spawn ${name}`}
      className="group relative bg-card border border-card-border rounded-md overflow-hidden hover-elevate focus:outline-none focus:ring-1 focus:ring-accent text-left cursor-pointer"
      data-testid={`grudge-item-${idx}`}
      style={
        tierColor
          ? { boxShadow: `inset 0 0 0 1px ${tierColor.hex}33` }
          : undefined
      }
    >
      <div
        className="aspect-square flex items-center justify-center relative"
        style={{
          background: tierColor
            ? `radial-gradient(circle at 50% 40%, ${tierColor.hex}33, ${tierColor.hex}0a 60%, transparent)`
            : "hsl(var(--muted) / 0.4)",
        }}
      >
        {showImage ? (
          <img
            src={imageUrl}
            alt={name}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="size-full object-contain p-1.5"
            draggable={false}
          />
        ) : emoji ? (
          <span
            className="select-none leading-none"
            style={{ fontSize: "clamp(20px, 3.2vw, 36px)" }}
            aria-hidden
          >
            {emoji}
          </span>
        ) : (
          <EmptyIcon
            className="size-7"
            style={{ color: tierColor?.hex ?? "hsl(var(--muted-foreground))" }}
          />
        )}
        {tier && (
          <span
            className="absolute top-0.5 left-0.5 text-[9px] font-mono leading-none px-1 py-0.5 rounded-sm bg-background/80"
            style={{ color: tierColor?.hex }}
          >
            T{tier}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onImport(it);
          }}
          onKeyDown={(e) => {
            // Stop the keyboard event from bubbling to the card so Enter/Space
            // on the import button doesn't *also* trigger spawn.
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
            }
          }}
          title="Save to project assets"
          aria-label={`Save ${name} to project assets`}
          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded-sm bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground"
          data-testid={`button-import-${idx}`}
        >
          <ExternalLink className="size-3" />
        </button>
      </div>
      <div className="px-1.5 py-1 border-t border-card-border bg-card">
        <div className="text-[11px] font-medium truncate leading-tight">
          {name}
        </div>
        {desc && (
          <div className="text-[9px] text-muted-foreground/80 truncate leading-tight">
            {desc}
          </div>
        )}
      </div>
    </div>
  );
}

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
    const url = String(it.model ?? it.imageUrl ?? it.icon ?? "");
    await createAsset.mutateAsync({
      data: {
        projectId,
        name,
        url,
        type: /\.(glb|gltf)$/i.test(url) ? "model" : "image",
        source: "grudge",
      },
    });
    qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    pushLog("info", `Imported "${name}" from Grudge Studio`);
  };

  const spawn = (it: GrudgeItem) => {
    if (!projectId) {
      pushLog("warn", "Open a project first to spawn items into a scene.");
      window.alert("Open or create a project first — items can only be spawned into a project's scene.");
      return;
    }
    const name = String(it.name ?? it.key ?? it.id ?? `Grudge ${type}`);
    const url = String(it.model ?? "");
    if (url && /\.(glb|gltf)$/i.test(url)) {
      const e = addEntity("model", name);
      updateEntity(e.id, (d) => {
        d.model = { url };
        d.transform = { ...d.transform, position: [0, 1, 0] };
      });
      pushLog("info", `Spawned model "${name}" at (0, 1, 0).`);
    } else {
      // Fallback: tier-coloured cube floating above the floor where it's visible.
      const e = addEntity("box", name);
      const tierHex = typeof it.tier === "number" ? getTierColor(it.tier).hex : "#8b7355";
      updateEntity(e.id, (d) => {
        if (!d.material) d.material = {};
        d.material.color = tierHex;
        d.material.emissive = tierHex;
        d.transform = {
          ...d.transform,
          position: [0, 1.2, 0],
          scale: [0.6, 0.6, 0.6],
        };
      });
      pushLog(
        "info",
        `Spawned placeholder cube for "${name}" at (0, 1.2, 0). (No 3D model in the catalogue — assign one from the inspector.)`,
      );
    }
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
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-1.5 p-2">
          {filtered.map((it, idx) => (
            <AssetCard
              key={`${String(it.id ?? it.key ?? it.name ?? idx)}-${idx}`}
              it={it}
              idx={idx}
              type={type}
              EmptyIcon={EmptyIcon}
              onSpawn={spawn}
              onImport={importAsset}
            />
          ))}
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading, progress } = useUpload({
    onError: (err: Error) => pushLog("error", `Upload failed: ${err.message}`),
  });

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

  const onUpload = async (file: File) => {
    if (!projectId) {
      pushLog("warn", "Open a project first to upload assets.");
      window.alert("Open or create a project first — uploads are organised under each project.");
      return;
    }
    pushLog("info", `Uploading ${file.name} (${(file.size / 1024).toFixed(1)} KB)…`);
    const type = classifyAsset(file.name, file.type);
    const res = await uploadFile(file, { projectId, assetType: type });
    if (!res) return;
    const servingUrl = `/api/storage${res.objectPath}`;
    await createAsset.mutateAsync({
      data: {
        projectId,
        name: file.name,
        url: servingUrl,
        type,
        source: "upload",
      },
    });
    qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    pushLog("info", `Uploaded "${file.name}" → ${servingUrl}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-border flex flex-wrap gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".glb,.gltf,.png,.jpg,.jpeg,.webp,.mp3,.wav,.ogg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
          data-testid="input-file-upload"
        />
        <Button
          size="sm"
          variant="default"
          className="h-7"
          onClick={() => fileInputRef.current?.click()}
          disabled={!projectId || isUploading}
          data-testid="button-upload-file"
        >
          {isUploading ? (
            <>
              <Loader2 className="size-3 mr-1 animate-spin" /> {progress}%
            </>
          ) : (
            <>
              <Upload className="size-3 mr-1" /> Upload File
            </>
          )}
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Asset name"
          className="h-7 text-xs flex-1 min-w-[120px]"
          data-testid="input-asset-name"
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://...glb"
          className="h-7 text-xs flex-[2] min-w-[160px]"
          data-testid="input-asset-url"
        />
        <Button size="sm" variant="outline" className="h-7" onClick={onAdd} disabled={!projectId || !name || !url}>
          <Plus className="size-3 mr-1" /> Add URL
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
              {a.source === "upload" && a.url && (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground"
                  title="Open uploaded file"
                >
                  <ExternalLink className="size-3" />
                </a>
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
