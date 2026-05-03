import { useEffect, useState, useRef } from "react";
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
import { Sword, Package, Skull, Scroll, Plus, ExternalLink, Loader2, Trash2, Search, Upload, Image as ImageIcon, Sun, Box, Library, LayoutGrid, List as ListIcon, Copy, Eye, FileBox } from "lucide-react";
import { useViewportTabs } from "@/store/viewportTabs";
import { openModelTabFromAsset } from "@/lib/openModelTab";
import { getTierColor, type GrudgeItem } from "@/lib/grudge";
import { usePolyHaven, fetchPolyHavenFiles, type PolyHavenAsset, type PolyHavenAssetKind } from "@/lib/polyhaven";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { BestPracticesSubMenu } from "@/editor/BestPracticesMenu";
import type { BestPracticeContext } from "@/lib/bestPractices";

function classifyAsset(name: string, contentType: string): "model" | "image" | "audio" | "texture" | "other" {
  if (/\.(glb|gltf|fbx|obj)$/i.test(name)) return "model";
  if (/^audio\//.test(contentType) || /\.(mp3|wav|ogg|m4a)$/i.test(name)) return "audio";
  if (/\.(png|jpe?g|webp|ktx2)$/i.test(name) && /texture|normal|albedo|roughness/i.test(name)) return "texture";
  if (/^image\//.test(contentType)) return "image";
  return "other";
}

type ViewMode = "list" | "grid";

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-background overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => onChange("list")}
        title="List view"
        aria-label="List view"
        aria-pressed={value === "list"}
        data-testid="button-view-list"
        className={`h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground ${
          value === "list" ? "bg-accent/15 text-accent" : ""
        }`}
      >
        <ListIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange("grid")}
        title="Grid view"
        aria-label="Grid view"
        aria-pressed={value === "grid"}
        data-testid="button-view-grid"
        className={`h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground border-l border-border ${
          value === "grid" ? "bg-accent/15 text-accent" : ""
        }`}
      >
        <LayoutGrid className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Compact "Windows Explorer details view" row for a Grudge catalogue item.
 * Mirrors the click-to-spawn / hover-to-import affordances of `AssetCard`
 * but in a single dense line so dozens of items fit in the panel without
 * the user having to scroll a wall of thumbnails.
 */
function AssetRow({
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

  const row = (
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
      title={[name, desc, tier ? `Tier ${tier} · ${tierColor?.name}` : ""].filter(Boolean).join("\n")}
      aria-label={`Spawn ${name}`}
      className="group flex items-center gap-2 h-7 px-2 rounded-sm hover-elevate focus:outline-none focus:ring-1 focus:ring-accent text-left cursor-pointer text-xs"
      data-testid={`grudge-row-${idx}`}
    >
      <div
        className="size-5 shrink-0 flex items-center justify-center rounded-sm overflow-hidden bg-muted/40"
        style={tierColor ? { boxShadow: `inset 0 0 0 1px ${tierColor.hex}55` } : undefined}
      >
        {showImage ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="size-full object-contain"
            draggable={false}
          />
        ) : emoji ? (
          <span className="leading-none text-[12px]" aria-hidden>
            {emoji}
          </span>
        ) : (
          <EmptyIcon
            className="size-3.5"
            style={{ color: tierColor?.hex ?? "hsl(var(--muted-foreground))" }}
          />
        )}
      </div>
      <span className="font-medium truncate flex-1">{name}</span>
      {tier && (
        <span
          className="font-mono text-[9px] px-1 py-0.5 rounded-sm bg-background/60 shrink-0"
          style={{ color: tierColor?.hex }}
        >
          T{tier}
        </span>
      )}
      {desc && (
        <span className="text-[10px] text-muted-foreground/70 truncate hidden md:inline max-w-[40%]">
          {desc}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onImport(it);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
        title="Save to project assets"
        aria-label={`Save ${name} to project assets`}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-sm text-muted-foreground hover:text-foreground shrink-0"
        data-testid={`button-import-row-${idx}`}
      >
        <ExternalLink className="size-3" />
      </button>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <GrudgeAssetMenu it={it} type={type} onSpawn={onSpawn} onImport={onImport} />
    </ContextMenu>
  );
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

  const card = (
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <GrudgeAssetMenu it={it} type={type} onSpawn={onSpawn} onImport={onImport} />
    </ContextMenu>
  );
}

function GrudgeAssetMenu({
  it,
  type,
  onSpawn,
  onImport,
}: {
  it: GrudgeItem;
  type: "weapon" | "item" | "enemy" | "quest";
  onSpawn: (it: GrudgeItem) => void;
  onImport: (it: GrudgeItem) => void;
}) {
  const pushLog = useEditor((s) => s.pushLog);
  const name = String(it.name ?? it.key ?? it.id ?? type);
  const url = String(it.model ?? it.imageUrl ?? it.icon ?? "");
  const tier = typeof it.tier === "number" ? it.tier : null;
  const ctx: BestPracticeContext = type;

  const copy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => pushLog("info", `Copied ${label}: ${text}`))
      .catch(() => pushLog("warn", `Could not copy ${label} to clipboard.`));
  };

  return (
    <ContextMenuContent className="min-w-[220px]">
      <ContextMenuLabel className="flex flex-col items-start gap-0.5">
        <span className="text-xs font-medium truncate max-w-[260px]">{name}</span>
        <span className="text-[10px] text-muted-foreground font-mono uppercase">
          {type}
          {tier ? ` · T${tier}` : ""}
        </span>
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onSpawn(it)}>
        <Plus className="size-3.5 mr-2" /> Spawn into scene
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onImport(it)}>
        <Library className="size-3.5 mr-2" /> Import to project assets
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!url}
        onClick={() => copy(url, "URL")}
      >
        <Copy className="size-3.5 mr-2" /> Copy resource URL
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!url}
        onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
      >
        <Eye className="size-3.5 mr-2" /> Open resource in new tab
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() =>
          pushLog(
            "info",
            `${name} — ${JSON.stringify(it, null, 2)}`,
          )
        }
      >
        <ExternalLink className="size-3.5 mr-2" /> Dump to console
      </ContextMenuItem>
      <ContextMenuSeparator />
      <BestPracticesSubMenu context={ctx} label={`${type} best practices`} />
    </ContextMenuContent>
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
  const [viewMode, setViewMode] = useState<ViewMode>("list");

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
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>
      <ScrollArea className="flex-1">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1 p-1.5">
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
        ) : (
          <div className="p-1.5">
            {filtered.map((it, idx) => (
              <AssetRow
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
              <p className="text-xs text-muted-foreground text-center py-8">No matches.</p>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ProjectAssets() {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const addEntity = useEditor((s) => s.addEntity);
  const updateEntity = useEditor((s) => s.updateEntity);
  const openTab = useViewportTabs((s) => s.openTab);
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
        <div className="p-1.5">
          {assets.map((a) => (
            <div
              key={a.id}
              className="group flex items-center gap-2 h-7 px-2 rounded-sm hover-elevate text-xs"
              data-testid={`asset-row-${a.id}`}
            >
              <span className="font-mono text-[9px] uppercase text-muted-foreground/70 w-10 shrink-0 tracking-wider">{a.type}</span>
              <span className="font-medium truncate flex-1">{a.name}</span>
              <span className="text-[10px] text-muted-foreground/60 truncate max-w-[200px] hidden md:inline">{a.url}</span>
              {a.type === "model" && a.url && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      openModelTabFromAsset({ name: a.name, url: a.url }, openTab);
                      pushLog("info", `Opened "${a.name}" in a new viewer tab.`);
                    }}
                    title="Open in new viewer tab"
                    data-testid={`button-open-asset-tab-${a.id}`}
                  >
                    <FileBox className="size-3 mr-1" /> Open
                  </Button>
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
                </>
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

/**
 * One Poly Haven asset card. Same visual language as `AssetCard` (grudge) so
 * the two libraries feel like one unified browser, but the click behaviour is
 * different per kind:
 *
 *   - models  → click spawns it directly into the scene (lazy-resolves the
 *               GLTF URL via /api/polyhaven/files/:slug, then routes through
 *               the existing model-entity path).
 *   - textures + HDRIs → click imports the resolved download URL into the
 *               project's Asset list (creating an `image` asset). Spawning a
 *               texture as a scene object doesn't make sense; the user wires
 *               it up later via the inspector.
 *
 * The thumbnail is served straight from Poly Haven's CDN — no proxy needed,
 * their CDN is CORS-enabled.
 */
function PolyHavenCard({
  asset,
  busy,
  onPrimary,
  primaryLabel,
  EmptyIcon,
}: {
  asset: PolyHavenAsset;
  busy: boolean;
  onPrimary: () => void;
  primaryLabel: string;
  EmptyIcon: typeof Box;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const tooltip = [
    asset.name,
    asset.categories.slice(0, 4).join(" · "),
    `${(asset.download_count / 1000).toFixed(0)}k downloads`,
    primaryLabel,
  ]
    .filter(Boolean)
    .join("\n");

  const card = (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      onClick={busy ? undefined : onPrimary}
      onKeyDown={(e) => {
        if (busy) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPrimary();
        }
      }}
      title={tooltip}
      aria-label={`${primaryLabel} ${asset.name}`}
      aria-busy={busy}
      className="group relative bg-card border border-card-border rounded-md overflow-hidden hover-elevate focus:outline-none focus:ring-1 focus:ring-accent text-left cursor-pointer aria-busy:opacity-60 aria-busy:cursor-wait"
      data-testid={`polyhaven-card-${asset.slug}`}
    >
      <div className="aspect-square flex items-center justify-center relative bg-muted/40">
        {imgFailed ? (
          <EmptyIcon className="size-7 text-muted-foreground" />
        ) : (
          <img
            src={asset.thumbnail_url}
            alt={asset.name}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="size-full object-cover"
            draggable={false}
          />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40">
            <Loader2 className="size-4 animate-spin text-accent" />
          </div>
        )}
      </div>
      <div className="px-1.5 py-1 border-t border-card-border bg-card">
        <div className="text-[11px] font-medium truncate leading-tight">
          {asset.name}
        </div>
        <div className="text-[9px] text-muted-foreground/80 truncate leading-tight">
          {asset.categories[0] ?? asset.kind}
        </div>
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <PolyHavenAssetMenu asset={asset} onPrimary={onPrimary} primaryLabel={primaryLabel} />
    </ContextMenu>
  );
}

function PolyHavenAssetMenu({
  asset,
  onPrimary,
  primaryLabel,
}: {
  asset: PolyHavenAsset;
  onPrimary: () => void;
  primaryLabel: string;
}) {
  const pushLog = useEditor((s) => s.pushLog);
  const phUrl = `https://polyhaven.com/a/${asset.slug}`;
  const ctx: BestPracticeContext =
    asset.kind === "hdris" ? "hdri" : asset.kind === "textures" ? "texture" : "model";

  const copy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => pushLog("info", `Copied ${label}: ${text}`))
      .catch(() => pushLog("warn", `Could not copy ${label} to clipboard.`));
  };

  return (
    <ContextMenuContent className="min-w-[220px]">
      <ContextMenuLabel className="flex flex-col items-start gap-0.5">
        <span className="text-xs font-medium truncate max-w-[260px]">{asset.name}</span>
        <span className="text-[10px] text-muted-foreground font-mono uppercase">
          {asset.kind} · {(asset.download_count / 1000).toFixed(0)}k downloads
        </span>
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onPrimary}>
        <Plus className="size-3.5 mr-2" /> {primaryLabel}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => copy(asset.thumbnail_url, "thumbnail URL")}>
        <Copy className="size-3.5 mr-2" /> Copy thumbnail URL
      </ContextMenuItem>
      <ContextMenuItem onClick={() => copy(asset.slug, "slug")}>
        <Copy className="size-3.5 mr-2" /> Copy slug
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => window.open(phUrl, "_blank", "noopener,noreferrer")}
      >
        <Eye className="size-3.5 mr-2" /> Open on Poly Haven
      </ContextMenuItem>
      <ContextMenuSeparator />
      <BestPracticesSubMenu context={ctx} label={`${ctx} best practices`} />
    </ContextMenuContent>
  );
}

function PolyHavenRow({
  asset,
  busy,
  onPrimary,
  primaryLabel,
  EmptyIcon,
}: {
  asset: PolyHavenAsset;
  busy: boolean;
  onPrimary: () => void;
  primaryLabel: string;
  EmptyIcon: typeof Box;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const row = (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      onClick={busy ? undefined : onPrimary}
      onKeyDown={(e) => {
        if (busy) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPrimary();
        }
      }}
      title={`${primaryLabel} ${asset.name}\n${asset.categories.slice(0, 4).join(" · ")}`}
      aria-label={`${primaryLabel} ${asset.name}`}
      aria-busy={busy}
      className="group flex items-center gap-2 h-7 px-2 rounded-sm hover-elevate focus:outline-none focus:ring-1 focus:ring-accent text-left cursor-pointer text-xs aria-busy:opacity-60 aria-busy:cursor-wait"
      data-testid={`polyhaven-row-${asset.slug}`}
    >
      <div className="size-5 shrink-0 flex items-center justify-center rounded-sm overflow-hidden bg-muted/40">
        {imgFailed ? (
          <EmptyIcon className="size-3.5 text-muted-foreground" />
        ) : (
          <img
            src={asset.thumbnail_url}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="size-full object-cover"
            draggable={false}
          />
        )}
      </div>
      <span className="font-medium truncate flex-1">{asset.name}</span>
      <span className="text-[10px] text-muted-foreground/70 truncate hidden md:inline max-w-[35%]">
        {asset.categories[0] ?? asset.kind}
      </span>
      <span className="font-mono text-[9px] text-muted-foreground/60 shrink-0">
        {(asset.download_count / 1000).toFixed(0)}k
      </span>
      {busy && <Loader2 className="size-3 animate-spin text-accent shrink-0" />}
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <PolyHavenAssetMenu asset={asset} onPrimary={onPrimary} primaryLabel={primaryLabel} />
    </ContextMenu>
  );
}

/**
 * Grid of Poly Haven assets for one kind (textures / hdris / models).
 *
 * The whole catalog is fetched once (it's small JSON — a few hundred KB
 * uncompressed — and the api-server caches it for 30 minutes). Filtering and
 * paging are client-side: `query` filters by name/category/tag, and we cap
 * the rendered list at `PAGE` items with a "Show more" button so the initial
 * paint stays fast (a 700-item grid with `<img>`s would chew through the
 * thumbnail bandwidth budget on first open).
 */
function PolyHavenGrid({ kind }: { kind: PolyHavenAssetKind }) {
  const PAGE = 60;
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const addEntity = useEditor((s) => s.addEntity);
  const updateEntity = useEditor((s) => s.updateEntity);
  const qc = useQueryClient();
  const createAsset = useCreateAsset();
  const { data, isLoading, error } = usePolyHaven(kind);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const items = data?.items ?? [];
  const q = query.trim().toLowerCase();
  // Score each candidate so that direct name matches outrank items whose only
  // connection to the query is a shared tag (Poly Haven's tag taxonomy is
  // intentionally broad — e.g. all seating shares the "chair" tag — so a raw
  // includes() filter would surface sofas above actual chairs). Negative score
  // means "no match" → filtered out.
  const scored = items
    .map((a) => {
      if (!q) return { a, score: 0 };
      const name = a.name.toLowerCase();
      const slug = a.slug.toLowerCase();
      if (name === q || slug === q) return { a, score: 100 };
      if (name.startsWith(q) || slug.startsWith(q)) return { a, score: 80 };
      if (name.includes(q) || slug.includes(q)) return { a, score: 60 };
      if (a.categories.some((c) => c.toLowerCase().includes(q))) return { a, score: 40 };
      if (a.tags.some((t) => t.toLowerCase().includes(q))) return { a, score: 20 };
      return { a, score: -1 };
    })
    .filter((x) => x.score >= 0);
  // Stable secondary sort by download_count keeps the catalogue's "popular
  // first" ordering inside each score bucket.
  if (q) scored.sort((x, y) => y.score - x.score);
  const filtered = scored.map((x) => x.a);
  const visible = filtered.slice(0, page * PAGE);

  const requireProject = (): boolean => {
    if (projectId) return true;
    pushLog("warn", "Open a project first to use library assets.");
    window.alert("Open or create a project first — assets are saved per project.");
    return false;
  };

  const handleModel = async (asset: PolyHavenAsset) => {
    if (!requireProject() || !projectId) return;
    setBusySlug(asset.slug);
    try {
      const files = await fetchPolyHavenFiles(asset.slug);
      const url = files.model?.url;
      if (!url) {
        pushLog("warn", `No GLTF available for "${asset.name}".`);
        return;
      }
      await createAsset.mutateAsync({
        data: {
          projectId,
          name: asset.name,
          url,
          type: "model",
          source: "polyhaven",
        },
      });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      const e = addEntity("model", asset.name);
      updateEntity(e.id, (d) => {
        d.model = { url };
        d.transform = { ...d.transform, position: [0, 0, 0] };
      });
      pushLog("info", `Spawned Poly Haven model "${asset.name}" (${files.model?.resolution}).`);
    } catch (err) {
      pushLog("error", `Failed to load "${asset.name}": ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusySlug(null);
    }
  };

  const handleImage = async (asset: PolyHavenAsset, kindLabel: string) => {
    if (!requireProject() || !projectId) return;
    setBusySlug(asset.slug);
    try {
      const files = await fetchPolyHavenFiles(asset.slug);
      const url = kind === "hdris" ? files.hdri?.url : files.texture?.diffuse?.url;
      if (!url) {
        pushLog("warn", `No downloadable file for "${asset.name}".`);
        return;
      }
      await createAsset.mutateAsync({
        data: {
          projectId,
          name: kind === "hdris" ? `${asset.name} (HDRI)` : `${asset.name} (diffuse)`,
          url,
          type: kind === "hdris" ? "image" : "texture",
          source: "polyhaven",
        },
      });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      pushLog("info", `Imported ${kindLabel} "${asset.name}" — assign it from the inspector.`);
    } catch (err) {
      pushLog("error", `Failed to import "${asset.name}": ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusySlug(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Fetching from Poly Haven…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Couldn't reach the Poly Haven library: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  const EmptyIcon = kind === "hdris" ? Sun : kind === "models" ? Box : ImageIcon;
  const primaryLabel = kind === "models" ? "Spawn" : "Import";
  const placeholderHint =
    kind === "models"
      ? "Search models (chair, sword, plant)…"
      : kind === "hdris"
        ? "Search HDRIs (sunset, studio, indoor)…"
        : "Search textures (brick, wood, metal)…";

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-border flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={placeholderHint}
            className="h-7 pl-7 text-xs"
            data-testid={`input-polyhaven-search-${kind}`}
          />
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {visible.length}/{filtered.length}
        </span>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>
      <ScrollArea className="flex-1">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1 p-1.5">
            {visible.map((asset) => (
              <PolyHavenCard
                key={asset.slug}
                asset={asset}
                busy={busySlug === asset.slug}
                onPrimary={() =>
                  kind === "models"
                    ? handleModel(asset)
                    : handleImage(asset, kind === "hdris" ? "HDRI" : "texture")
                }
                primaryLabel={primaryLabel}
                EmptyIcon={EmptyIcon}
              />
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full text-xs text-muted-foreground text-center py-8">
                No matches.
              </p>
            )}
          </div>
        ) : (
          <div className="p-1.5">
            {visible.map((asset) => (
              <PolyHavenRow
                key={asset.slug}
                asset={asset}
                busy={busySlug === asset.slug}
                onPrimary={() =>
                  kind === "models"
                    ? handleModel(asset)
                    : handleImage(asset, kind === "hdris" ? "HDRI" : "texture")
                }
                primaryLabel={primaryLabel}
                EmptyIcon={EmptyIcon}
              />
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">No matches.</p>
            )}
          </div>
        )}
        {visible.length < filtered.length && (
          <div className="flex justify-center p-3">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setPage((p) => p + 1)}
              data-testid={`button-polyhaven-more-${kind}`}
            >
              Show {Math.min(PAGE, filtered.length - visible.length)} more
            </Button>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70 text-center pb-3 px-3">
          Free CC0 assets from{" "}
          <a
            href="https://polyhaven.com"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            polyhaven.com
          </a>{" "}
          — usable in any project, commercial or otherwise.
        </p>
      </ScrollArea>
    </div>
  );
}

/** Tab identifiers accepted by the `gameforge:focusAssetTab` event so the
 *  top menu (Assets → …) can deep-link straight to a provider. Kept in
 *  one place so the menu and this component cannot drift apart. */
export type AssetBrowserTab =
  | "weapons"
  | "items"
  | "enemies"
  | "quests"
  | "ph-models"
  | "ph-textures"
  | "ph-hdris"
  | "project";

export function AssetBrowser() {
  const weapons = useGetGrudgeWeapons();
  const items = useGetGrudgeItems();
  const enemies = useGetGrudgeEnemies();
  const quests = useGetGrudgeQuests();
  const [tab, setTab] = useState<AssetBrowserTab>("weapons");

  // Top menu (Assets → Browse PolyHaven HDRIs, etc.) dispatches a
  // `gameforge:focusAssetTab` CustomEvent with the target tab id. We
  // accept any of the known ids and silently ignore the rest.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const valid: readonly AssetBrowserTab[] = [
        "weapons", "items", "enemies", "quests",
        "ph-models", "ph-textures", "ph-hdris", "project",
      ];
      if (valid.includes(detail as AssetBrowserTab)) {
        setTab(detail as AssetBrowserTab);
      }
    };
    window.addEventListener("gameforge:focusAssetTab", handler);
    return () => window.removeEventListener("gameforge:focusAssetTab", handler);
  }, []);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as AssetBrowserTab)} className="flex flex-col h-full">
      <TabsList className="rounded-none w-fit mx-2 mt-1.5 flex-wrap h-auto">
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
        <TabsTrigger value="ph-models" className="text-xs gap-1.5" data-testid="tab-polyhaven-models">
          <Box className="size-3" /> Models
        </TabsTrigger>
        <TabsTrigger value="ph-textures" className="text-xs gap-1.5" data-testid="tab-polyhaven-textures">
          <ImageIcon className="size-3" /> Textures
        </TabsTrigger>
        <TabsTrigger value="ph-hdris" className="text-xs gap-1.5" data-testid="tab-polyhaven-hdris">
          <Sun className="size-3" /> HDRIs
        </TabsTrigger>
        <TabsTrigger value="project" className="text-xs gap-1.5">
          <Library className="size-3" /> Project Assets
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
        <TabsContent value="ph-models" className="m-0 h-full">
          <PolyHavenGrid kind="models" />
        </TabsContent>
        <TabsContent value="ph-textures" className="m-0 h-full">
          <PolyHavenGrid kind="textures" />
        </TabsContent>
        <TabsContent value="ph-hdris" className="m-0 h-full">
          <PolyHavenGrid kind="hdris" />
        </TabsContent>
        <TabsContent value="project" className="m-0 h-full">
          <ProjectAssets />
        </TabsContent>
      </div>
    </Tabs>
  );
}
