import { useEffect, useState } from "react";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/store/editor";
import { useToast } from "@/hooks/use-toast";
import type { CameraMode, EntityType } from "@/scene/types";
import { useCreateAsset, getListAssetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

/** Fire a CustomEvent on `window`. Existing flows (Toolbar, AssetBrowser,
 *  Hierarchy, Electron shell) already listen for `gameforge:*` events —
 *  the MenuBar simply shares that bus instead of plumbing callbacks. */
function fire<T = unknown>(name: string, detail?: T) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Switch the bottom panel to its Assets tab and then focus a specific
 *  provider tab inside the AssetBrowser. The order matters: AssetBrowser
 *  isn't mounted until the bottom Tabs surface its `assets` panel, so we
 *  fire focusAssetTab on the next microtask to give it time to mount. */
function openAssets(tab:
  | "weapons" | "items" | "enemies" | "quests"
  | "ph-models" | "ph-textures" | "ph-hdris" | "project",
) {
  useEditor.getState().setBottomTab("assets");
  setTimeout(() => fire("gameforge:focusAssetTab", tab), 0);
}

const apiUrl = (path: string) => `/api/${path.replace(/^\/+/, "")}`;

export function MenuBar({
  onOpenProjects,
  onToggleAIWorker,
}: {
  onOpenProjects: () => void;
  onToggleAIWorker: () => void;
}) {
  const { toast } = useToast();
  const projectId = useEditor((s) => s.projectId);
  const sceneName = useEditor((s) => s.sceneName);
  const sceneData = useEditor((s) => s.sceneData);
  const showStats = useEditor((s) => s.showStats);
  const renderQuality = useEditor((s) => s.renderQuality);
  const cameraMode: CameraMode = sceneData.environment.cameraMode ?? "editor";

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const createAsset = useCreateAsset();
  const qc = useQueryClient();

  // Native menu (Electron) → "Help → Keyboard shortcuts" forwards as a
  // `gameforge:openShortcuts` event so the desktop and web menus end at
  // the same dialog.
  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener("gameforge:openShortcuts", open);
    return () => window.removeEventListener("gameforge:openShortcuts", open);
  }, []);

  const setEnvironment = useEditor.getState().setEnvironment;
  const setCameraMode = (mode: CameraMode) =>
    setEnvironment({ ...sceneData.environment, cameraMode: mode });

  const addPrimitive = (type: EntityType) => {
    useEditor.getState().cmdAddEntity(
      type,
      type[0].toUpperCase() + type.slice(1),
      null,
    );
  };

  const undo = () => {
    const label = useEditor.getState().commandStack.undo();
    if (label) useEditor.getState().pushLog("info", `Undo: ${label}`);
  };
  const redo = () => {
    const label = useEditor.getState().commandStack.redo();
    if (label) useEditor.getState().pushLog("info", `Redo: ${label}`);
  };
  const duplicateSelected = () => {
    const id = useEditor.getState().selectedId;
    if (id) useEditor.getState().cmdDuplicateEntity(id);
  };
  const deleteSelected = () => {
    const id = useEditor.getState().selectedId;
    if (id) useEditor.getState().cmdRemoveEntity(id);
  };
  const focusSelected = () => {
    if (useEditor.getState().selectedId) useEditor.getState().requestFocus();
  };
  const forgePrefab = () => {
    const id = useEditor.getState().selectedId;
    if (id) fire("gameforge:forgePrefab", { entityId: id });
  };

  const saveSnapshot = async () => {
    if (!projectId) {
      toast({
        title: "No project open",
        description: "Open or create a project before saving a snapshot.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(apiUrl("ai-storage/scene-snapshot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: sceneName || "snapshot",
          scene: sceneData,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { url?: string; key?: string };
      toast({
        title: "Snapshot saved to cloud",
        description: data.key ?? data.url ?? "ok",
      });
      useEditor.getState().pushLog("info", `Cloud snapshot: ${data.key ?? data.url ?? "ok"}`);
    } catch (err) {
      toast({
        title: "Snapshot failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const importFromUrl = async () => {
    const url = importUrl.trim();
    if (!url || !projectId) return;
    setImportBusy(true);
    try {
      const res = await fetch(apiUrl("ai-storage/import-asset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url?: string; key?: string; bytes?: number };
      const finalUrl = data.url ?? url;
      const name = url.split("/").pop()?.split("?")[0] || "asset";
      const isModel = /\.(glb|gltf)$/i.test(finalUrl);
      await createAsset.mutateAsync({
        data: {
          projectId,
          name,
          url: finalUrl,
          type: isModel ? "model" : "image",
          source: "url",
        },
      });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
      toast({
        title: "Asset imported",
        description: `${name}${data.bytes ? ` · ${(data.bytes / 1024).toFixed(1)} KB` : ""}`,
      });
      setImportOpen(false);
      setImportUrl("");
      // Surface the result so the user can see/use it.
      openAssets("project");
    } catch (err) {
      toast({
        title: "Import failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <>
      <Menubar className="rounded-none border-x-0 border-t-0 px-2 h-7 bg-background/95 backdrop-blur">
        {/* ---------- File ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-file">File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onOpenProjects} data-testid="menu-file-new">
              New Project…
            </MenubarItem>
            <MenubarItem onSelect={onOpenProjects} data-testid="menu-file-open">
              Open Project…
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => fire("gameforge:save")} data-testid="menu-file-save">
              Save Scene <MenubarShortcut>Ctrl+S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={saveSnapshot} data-testid="menu-file-snapshot">
              Save Snapshot to Cloud
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => setImportOpen(true)} data-testid="menu-file-import-url">
              Import Asset from URL…
            </MenubarItem>
            <MenubarItem onSelect={() => fire("gameforge:openTool", "deployer")} data-testid="menu-file-deploy">
              Publish / Deploy Scene…
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem
              onSelect={() => {
                if (typeof window !== "undefined") window.close();
              }}
              data-testid="menu-file-exit"
            >
              Exit
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* ---------- Edit ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-edit">Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={undo} data-testid="menu-edit-undo">
              Undo <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={redo} data-testid="menu-edit-redo">
              Redo <MenubarShortcut>Ctrl+Y</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={duplicateSelected} data-testid="menu-edit-duplicate">
              Duplicate <MenubarShortcut>Ctrl+D</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={deleteSelected} data-testid="menu-edit-delete">
              Delete <MenubarShortcut>Del</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={forgePrefab} data-testid="menu-edit-forge-prefab">
              Forge Selection as Prefab <MenubarShortcut>Ctrl+G</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* ---------- View ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-view">View</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={focusSelected} data-testid="menu-view-focus">
              Focus on Selection <MenubarShortcut>F</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>Camera Mode</MenubarSubTrigger>
              <MenubarSubContent>
                {(["editor", "rts", "thirdPerson", "firstPerson"] as CameraMode[]).map((m) => (
                  <MenubarItem
                    key={m}
                    onSelect={() => setCameraMode(m)}
                    data-testid={`menu-view-camera-${m}`}
                  >
                    {m === cameraMode ? "● " : "  "}{m === "editor" ? "Editor (Orbit)" : m === "rts" ? "RTS" : m === "thirdPerson" ? "Third-person" : "First-person"}
                  </MenubarItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSub>
              <MenubarSubTrigger>Render Quality</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onSelect={() => useEditor.getState().setRenderQuality("high")}>
                  {renderQuality === "high" ? "● " : "  "}High (effects on)
                </MenubarItem>
                <MenubarItem onSelect={() => useEditor.getState().setRenderQuality("perf")}>
                  {renderQuality === "perf" ? "● " : "  "}Performance
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onSelect={() => useEditor.getState().setShowStats(!showStats)} data-testid="menu-view-stats">
              {showStats ? "Hide" : "Show"} FPS / Stats
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => useEditor.getState().setBottomTab("console")}>
              Show Console
            </MenubarItem>
            <MenubarItem onSelect={() => openAssets("project")}>
              Show Asset Browser
            </MenubarItem>
            <MenubarItem onSelect={() => useEditor.getState().setBottomTab("scripts")}>
              Show Script Editor
            </MenubarItem>
            <MenubarItem onSelect={() => useEditor.getState().setBottomTab("nodes")}>
              Show Node Graph
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* ---------- Add ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-add">Add</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => addPrimitive("box")}>Box</MenubarItem>
            <MenubarItem onSelect={() => addPrimitive("sphere")}>Sphere</MenubarItem>
            <MenubarItem onSelect={() => addPrimitive("cylinder")}>Cylinder</MenubarItem>
            <MenubarItem onSelect={() => addPrimitive("plane")}>Plane</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => addPrimitive("light")}>Light</MenubarItem>
            <MenubarItem onSelect={() => addPrimitive("model")}>Empty Model Slot</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => openAssets("ph-models")}>
              From PolyHaven Models…
            </MenubarItem>
            <MenubarItem onSelect={() => openAssets("weapons")}>
              From Grudge Object Store…
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* ---------- Assets ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-assets">Assets</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => openAssets("project")}>Open Asset Browser</MenubarItem>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>PolyHaven (free CC0)</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onSelect={() => openAssets("ph-models")} data-testid="menu-assets-ph-models">Browse Models</MenubarItem>
                <MenubarItem onSelect={() => openAssets("ph-textures")} data-testid="menu-assets-ph-textures">Browse Textures</MenubarItem>
                <MenubarItem onSelect={() => openAssets("ph-hdris")} data-testid="menu-assets-ph-hdris">Browse HDRIs</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSub>
              <MenubarSubTrigger>Grudge Object Store</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onSelect={() => openAssets("weapons")} data-testid="menu-assets-grudge-weapons">Weapons</MenubarItem>
                <MenubarItem onSelect={() => openAssets("items")} data-testid="menu-assets-grudge-items">Items / Equipment</MenubarItem>
                <MenubarItem onSelect={() => openAssets("enemies")} data-testid="menu-assets-grudge-enemies">Enemy Templates</MenubarItem>
                <MenubarItem onSelect={() => openAssets("quests")} data-testid="menu-assets-grudge-quests">Quests</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onSelect={() => setImportOpen(true)} data-testid="menu-assets-import-url">
              Import from URL…
            </MenubarItem>
            <MenubarItem onSelect={saveSnapshot}>
              Save Scene Snapshot to Cloud
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* ---------- Tools ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-tools">Tools</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => fire("gameforge:openTool", "converter")} data-testid="menu-tools-converter">
              3D Format Converter
            </MenubarItem>
            <MenubarItem onSelect={() => fire("gameforge:openTool", "unzipper")} data-testid="menu-tools-unzipper">
              Asset Pack Unzipper
            </MenubarItem>
            <MenubarItem onSelect={() => fire("gameforge:openTool", "scripts")} data-testid="menu-tools-scripts">
              Script Editor
            </MenubarItem>
            <MenubarItem onSelect={() => fire("gameforge:openTool", "deployer")} data-testid="menu-tools-deployer">
              Deploy Scene
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => fire("gameforge:openMapGen")} data-testid="menu-tools-mapgen">
              AI Map Generator…
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* ---------- Plugins ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-plugins">Plugins</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onToggleAIWorker} data-testid="menu-plugins-ai">
              AI Worker
            </MenubarItem>
            <MenubarItem onSelect={() => fire("gameforge:installPwa")}>
              Install as Desktop App (PWA)
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* ---------- Help ---------- */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs h-6 px-2" data-testid="menu-help">Help</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => setShortcutsOpen(true)} data-testid="menu-help-shortcuts">
              Keyboard Shortcuts
            </MenubarItem>
            <MenubarItem
              onSelect={() => window.open("https://polyhaven.com", "_blank", "noopener")}
            >
              PolyHaven Website
            </MenubarItem>
            <MenubarItem
              onSelect={() => window.open("https://threejs.org/docs/", "_blank", "noopener")}
            >
              Three.js Documentation
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => setAboutOpen(true)} data-testid="menu-help-about">
              About Grudge GameForge
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/* ---------- Import Asset from URL dialog ---------- */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Asset from URL</DialogTitle>
            <DialogDescription>
              Paste a direct link to a GLB / GLTF / image / HDR. The file is
              streamed through the server (SSRF-guarded, 25&nbsp;MB cap) and
              stored in your project's cloud bucket.
            </DialogDescription>
          </DialogHeader>
          <input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://example.com/asset.glb"
            className="w-full px-3 py-2 rounded border bg-background text-sm font-mono"
            data-testid="input-import-url"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              onClick={importFromUrl}
              disabled={!importUrl.trim() || !projectId || importBusy}
              data-testid="button-import-url-go"
            >
              {importBusy ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Keyboard shortcuts dialog ---------- */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <div className="text-sm grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono">
            <span className="text-muted-foreground">W / E / R</span><span>Translate / Rotate / Scale gizmo</span>
            <span className="text-muted-foreground">F</span><span>Focus camera on selection</span>
            <span className="text-muted-foreground">P</span><span>Toggle play / stop</span>
            <span className="text-muted-foreground">Esc</span><span>Stop play mode</span>
            <span className="text-muted-foreground">Ctrl+Z / Ctrl+Y</span><span>Undo / Redo</span>
            <span className="text-muted-foreground">Ctrl+D</span><span>Duplicate selected</span>
            <span className="text-muted-foreground">Delete</span><span>Delete selected</span>
            <span className="text-muted-foreground">Ctrl+S</span><span>Save scene</span>
            <span className="text-muted-foreground">Ctrl+G</span><span>Forge selection as prefab</span>
            <span className="text-muted-foreground">Space</span><span><em>(reserved for game scripts — jump)</em></span>
          </div>
          <DialogFooter>
            <Button onClick={() => setShortcutsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- About dialog ---------- */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grudge GameForge</DialogTitle>
            <DialogDescription>
              A browser-native 3D game editor — Three.js · React-Three-Fiber ·
              Rapier physics · Blazor C# transpiler. PolyHaven CC0 assets and
              the Grudge Object Store are wired in directly so any model,
              texture, HDRI, weapon, item, enemy or quest can be dragged
              straight into a scene.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAboutOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
