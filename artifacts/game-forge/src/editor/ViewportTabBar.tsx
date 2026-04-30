import {
  Layers3,
  FileBox,
  Package,
  Bone,
  Film,
  Wand2,
  X,
  Plus,
} from "lucide-react";
import { useViewportTabs, type ViewportTab } from "@/store/viewportTabs";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRef } from "react";
import { useEditor } from "@/store/editor";
import { classifyDroppedFile } from "@/lib/fileKind";
import { openModelTabFromFile } from "@/lib/openModelTab";

/** Icon per tab kind, kept in one place so the bar, the inspector, and any
 *  future surface stay visually consistent. */
const KIND_ICON = {
  scene: Layers3,
  model: FileBox,
  prefab: Package,
  rigging: Bone,
  animation: Film,
  convert: Wand2,
} as const;

function TabPill({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: ViewportTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const Icon = KIND_ICON[tab.kind];
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid={`viewport-tab-${tab.kind}-${tab.id}`}
      onClick={onActivate}
      onAuxClick={(e) => {
        // Middle-click closes, matching browser tab convention.
        if (e.button === 1 && tab.closable) {
          e.preventDefault();
          onClose();
        }
      }}
      className={cn(
        "group flex items-center gap-1.5 pl-2.5 pr-1 h-8 rounded-t-md border border-b-0 cursor-pointer min-w-0 max-w-56 select-none",
        active
          ? "bg-background border-card-border text-foreground"
          : "bg-card/40 border-transparent text-muted-foreground hover:bg-card/60",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", active ? "text-accent" : "")} />
      <span className="text-xs truncate" title={tab.title}>
        {tab.title}
      </span>
      {tab.closable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 size-5 inline-flex items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-card/80"
          aria-label={`Close ${tab.title}`}
          data-testid={`viewport-tab-close-${tab.id}`}
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="ml-1 size-5" aria-hidden />
      )}
    </div>
  );
}

export function ViewportTabBar() {
  const tabs = useViewportTabs((s) => s.tabs);
  const activeId = useViewportTabs((s) => s.activeId);
  const setActive = useViewportTabs((s) => s.setActive);
  const closeTab = useViewportTabs((s) => s.closeTab);
  const openTab = useViewportTabs((s) => s.openTab);
  const pushLog = useEditor((s) => s.pushLog);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const kind = classifyDroppedFile(file);
      if (kind === "glb" || kind === "gltf" || kind === "obj") {
        openModelTabFromFile(file, openTab);
        pushLog("info", `Opened "${file.name}" in a new viewer tab.`);
      } else {
        // Unknown / unsupported in the model viewer — drop into a Convert tab.
        const blobUrl = URL.createObjectURL(file);
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        openTab({
          kind: "convert",
          data: {
            files: [{ name: file.name, ext, blobUrl, size: file.size }],
          },
        });
        pushLog(
          "info",
          `Queued "${file.name}" in a new Convert tab (.${ext} not directly previewable).`,
        );
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Viewport tabs"
      className="h-9 flex items-end gap-0.5 px-2 pt-1 border-b border-border bg-sidebar/60 shrink-0"
    >
      {tabs.map((t) => (
        <TabPill
          key={t.id}
          tab={t}
          active={t.id === activeId}
          onActivate={() => setActive(t.id)}
          onClose={() => closeTab(t.id)}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="ml-1 size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-card/60 hover:text-foreground"
            aria-label="Open new viewer tab"
            data-testid="button-new-viewport-tab"
            title="Open new viewer tab"
          >
            <Plus className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>New viewer tab</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => fileInputRef.current?.click()}
            data-testid="menu-open-model-file"
          >
            <FileBox className="size-4 mr-2" />
            Open 3D file in new tab…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              openTab({ kind: "convert", data: { files: [] } })
            }
            data-testid="menu-open-convert-tab"
          >
            <Wand2 className="size-4 mr-2" />
            New Convert tab
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider opacity-60">
            From a model
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled
            className="text-muted-foreground"
            title="Open a model first, then use its tab menu"
          >
            <Bone className="size-4 mr-2" />
            Rigging surface
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled
            className="text-muted-foreground"
            title="Open a model first, then use its tab menu"
          >
            <Film className="size-4 mr-2" />
            Animation surface
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".glb,.gltf,.obj,.fbx,.zip,.asset,.prefab,.gfscene,.json"
        className="hidden"
        onChange={(e) => {
          handleOpenFiles(e.target.files);
          e.target.value = "";
        }}
        data-testid="input-open-3d-file"
      />
    </div>
  );
}
