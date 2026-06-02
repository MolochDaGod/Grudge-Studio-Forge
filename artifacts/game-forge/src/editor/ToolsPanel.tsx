/**
 * Tools panel — exposes the four desktop-only utilities inside the
 * GameForge UI:
 *   1. 3D Converter    (GLB / GLTF / FBX / OBJ / STL)
 *   2. Unzipper        (.zip extraction)
 *   3. Scene Deployer  (export scene as standalone HTML folder)
 *   4. Script Editor   (load / save .js / .ts from disk + live preview)
 *
 * The same component file is built into both the browser bundle and
 * the Electron renderer. It calls `useDesktopBridge()` to detect the
 * native bridge; if absent it renders a "Available in the desktop
 * app" placeholder so the web build never tries to do something the
 * browser can't.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  useDesktopBridge,
  type Convert3dResult,
  type DeploySceneResult,
  type ProgressEvent as ToolProgressEvent,
  type ThreeDFormat,
  type UnzipResult,
} from "@workspace/desktop-bridge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useEditor } from "@/store/editor";
import {
  Boxes,
  FileArchive,
  Globe,
  Code2,
  Download,
  FolderOpen,
  Save,
  Play,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

// Bundled converter matrix:
//   - Inputs:  GLB, GLTF, FBX, OBJ, STL  (assimpjs + gltf-transform)
//   - Outputs: GLB, GLTF, FBX, OBJ, STL  (FBX uses ASCII FBX 7.4)
const TARGET_FORMATS: ThreeDFormat[] = ["glb", "gltf", "fbx", "obj", "stl"];
const SOURCE_HINT = "GLB · GLTF · FBX · OBJ · STL";

const STARTER_SCRIPT = `// Three.js starter — runs in a sandboxed iframe with a fresh scene.
// Globals: scene, camera, renderer, THREE, requestAnimationFrame.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshNormalMaterial(),
);
scene.add(cube);
function tick() {
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
`;

interface ToolsPanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialTab?: ToolTab;
}

type ToolTab = "converter" | "unzipper" | "deployer" | "scripts";

export function ToolsPanel({
  open,
  onOpenChange,
  initialTab = "converter",
}: ToolsPanelProps) {
  const desktop = useDesktopBridge();
  const [tab, setTab] = useState<ToolTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Tools
            {desktop ? (
              <Badge variant="secondary" className="text-xs">
                Desktop · {desktop.platform}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Web preview
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Native disk-backed utilities for working with 3D assets and scenes.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ToolTab)}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="converter" className="gap-2">
              <Boxes className="size-4" /> Converter
            </TabsTrigger>
            <TabsTrigger value="unzipper" className="gap-2">
              <FileArchive className="size-4" /> Unzipper
            </TabsTrigger>
            <TabsTrigger value="deployer" className="gap-2">
              <Globe className="size-4" /> Deployer
            </TabsTrigger>
            <TabsTrigger value="scripts" className="gap-2">
              <Code2 className="size-4" /> Scripts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="converter">
            <ConverterTool />
          </TabsContent>
          <TabsContent value="unzipper">
            <UnzipperTool />
          </TabsContent>
          <TabsContent value="deployer">
            <SceneDeployerTool />
          </TabsContent>
          <TabsContent value="scripts">
            <ScriptDiskTool />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DesktopOnlyPlaceholder({ tool }: { tool: string }) {
  return (
    <div className="border border-dashed rounded-md p-6 text-center space-y-3 bg-muted/30">
      <Download className="size-8 mx-auto text-muted-foreground" />
      <div className="font-medium">{tool} is available in the desktop app</div>
      <p className="text-sm text-muted-foreground">
        This tool needs native disk access. Install the Windows desktop build
        of Grudge GameForge to use it. The web preview keeps the rest of the
        editor available.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => window.open("https://github.com/", "_blank")}
        data-testid="button-download-desktop"
      >
        Download desktop app
      </Button>
    </div>
  );
}

function useToolProgress(filterPrefix: string) {
  const desktop = useDesktopBridge();
  const [progress, setProgress] = useState<ToolProgressEvent | null>(null);
  useEffect(() => {
    if (!desktop) return;
    return desktop.onProgress((ev) => {
      if (ev.jobId.startsWith(filterPrefix)) setProgress(ev);
    });
  }, [desktop, filterPrefix]);
  return [progress, setProgress] as const;
}

function ProgressLine({ ev }: { ev: ToolProgressEvent | null }) {
  if (!ev) return null;
  return (
    <div className="space-y-1">
      <Progress value={Math.max(0, ev.progress) * 100} />
      <div className="text-xs text-muted-foreground truncate">
        {ev.message ?? ""}
      </div>
    </div>
  );
}

function ConverterTool() {
  const desktop = useDesktopBridge();
  const [input, setInput] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [target, setTarget] = useState<ThreeDFormat>("glb");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Convert3dResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress] = useToolProgress("convert-");

  if (!desktop) return <DesktopOnlyPlaceholder tool="3D Converter" />;

  async function pickInput() {
    const p = await desktop!.dialog.openFile({
      title: "Choose 3D model",
      rememberKey: "converter.input",
      filters: [
        {
          name: "3D Models",
          extensions: ["glb", "gltf", "fbx", "obj", "stl"],
        },
      ],
    });
    if (p) setInput(p);
  }

  async function pickOutputDir() {
    const p = await desktop!.dialog.openDirectory({
      title: "Choose output folder",
      rememberKey: "converter.output",
    });
    if (p) setOutputDir(p);
  }

  async function run() {
    if (!input || !outputDir) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await desktop!.tools.convert3d({
        inputPath: input,
        outputDir,
        targetFormat: target,
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 py-3">
      <PathPicker
        label="Source file"
        value={input}
        onPick={pickInput}
        onDropPath={setInput}
        acceptHint="Drag a .glb / .gltf / .fbx / .obj / .stl file here, or click Browse."
        testId="converter-input"
      />
      <PathPicker
        label="Output folder"
        value={outputDir}
        onPick={pickOutputDir}
        testId="converter-output"
      />
      <div className="space-y-1">
        <Label>Target format</Label>
        <Select value={target} onValueChange={(v) => setTarget(v as ThreeDFormat)}>
          <SelectTrigger data-testid="select-converter-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_FORMATS.map((f) => (
              <SelectItem key={f} value={f}>
                {f.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Reads and writes {SOURCE_HINT}. FBX output uses a minimal
          ASCII FBX 7.4 emitter (round-trips through Blender / Unity).
        </p>
      </div>
      <Button
        onClick={run}
        disabled={!input || !outputDir || busy}
        data-testid="button-converter-run"
      >
        {busy ? "Converting…" : "Convert"}
      </Button>
      <ProgressLine ev={busy ? progress : null} />
      {result && (
        <ResultBox icon={<CheckCircle2 className="size-4 text-green-500" />}>
          <div>
            Wrote <code>{result.outputPath}</code> ({formatBytes(result.bytesWritten)}).
          </div>
          {result.warnings.length > 0 && (
            <ul className="mt-2 text-amber-500 text-xs list-disc pl-4">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </ResultBox>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}

function UnzipperTool() {
  const desktop = useDesktopBridge();
  const [zipPath, setZipPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UnzipResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress] = useToolProgress("unzip-");

  if (!desktop) return <DesktopOnlyPlaceholder tool="Unzipper" />;

  async function pickZip() {
    const p = await desktop!.dialog.openFile({
      title: "Choose archive",
      rememberKey: "unzipper.input",
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (p) setZipPath(p);
  }
  async function pickOut() {
    const p = await desktop!.dialog.openDirectory({
      title: "Choose extraction folder",
      rememberKey: "unzipper.output",
    });
    if (p) setOutputDir(p);
  }
  async function run() {
    if (!zipPath || !outputDir) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await desktop!.tools.unzip({ zipPath, outputDir });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 py-3">
      <PathPicker
        label="Archive (.zip)"
        value={zipPath}
        onPick={pickZip}
        onDropPath={setZipPath}
        acceptHint="Drag a .zip file here, or click Browse."
        testId="unzipper-input"
      />
      <PathPicker
        label="Extract to"
        value={outputDir}
        onPick={pickOut}
        testId="unzipper-output"
      />
      <Button
        onClick={run}
        disabled={!zipPath || !outputDir || busy}
        data-testid="button-unzipper-run"
      >
        {busy ? "Extracting…" : "Extract"}
      </Button>
      <ProgressLine ev={busy ? progress : null} />
      {result && (
        <ResultBox icon={<CheckCircle2 className="size-4 text-green-500" />}>
          Extracted {result.files.length} files ({formatBytes(result.totalBytes)}).
          <ScrollArea className="h-32 mt-2 rounded border bg-background/50 p-2">
            <ul className="text-xs font-mono space-y-0.5">
              {result.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </ScrollArea>
        </ResultBox>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}

function SceneDeployerTool() {
  const desktop = useDesktopBridge();
  const sceneData = useEditor((s) => s.sceneData);
  const sceneName = useEditor((s) => s.sceneName);
  const [outputDir, setOutputDir] = useState("");
  const [zip, setZip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeploySceneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress] = useToolProgress("deploy-");

  if (!desktop) return <DesktopOnlyPlaceholder tool="Scene Deployer" />;

  async function pickOut() {
    const p = await desktop!.dialog.openDirectory({
      title: "Choose deploy folder",
      rememberKey: "deployer.output",
    });
    if (p) setOutputDir(p);
  }

  const assetUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const ent of sceneData.entities ?? []) {
      const m = (ent as { modelUrl?: string }).modelUrl;
      if (typeof m === "string" && /^https?:\/\//.test(m)) urls.add(m);
    }
    return Array.from(urls);
  }, [sceneData]);

  async function run() {
    if (!outputDir) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await desktop!.tools.deployScene({
        outputDir,
        zip,
        sceneJson: JSON.stringify(sceneData, null, 2),
        sceneName: sceneName ?? "GameForge Scene",
        assetUrls,
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 py-3">
      <div className="text-sm text-muted-foreground">
        Exports the current scene as a self-contained folder with bundled
        three.js. Open the resulting <code>index.html</code> in any browser.
      </div>
      <PathPicker
        label="Deploy folder"
        value={outputDir}
        onPick={pickOut}
        testId="deployer-output"
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={zip}
          onCheckedChange={(c) => setZip(c === true)}
          data-testid="checkbox-deployer-zip"
        />
        Also create <code>{outputDir ? `${outputDir}.zip` : "<folder>.zip"}</code>
      </label>
      <div className="text-xs text-muted-foreground">
        {assetUrls.length} referenced asset{assetUrls.length === 1 ? "" : "s"}
        {" "}
        will be copied into <code>assets/</code>.
      </div>
      <Button
        onClick={run}
        disabled={!outputDir || busy}
        data-testid="button-deployer-run"
      >
        {busy ? "Deploying…" : "Deploy scene"}
      </Button>
      <ProgressLine ev={busy ? progress : null} />
      {result && (
        <ResultBox icon={<CheckCircle2 className="size-4 text-green-500" />}>
          Wrote {result.fileCount} files to <code>{result.folderPath}</code>.
          {result.zipPath && (
            <div>
              Archive: <code>{result.zipPath}</code>
            </div>
          )}
        </ResultBox>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}

/**
 * Wires three.js global type declarations into Monaco when the script
 * editor mounts so the user gets autocomplete on `THREE.Mesh`,
 * `BoxGeometry`, etc. — exactly the symbols the live-preview iframe
 * exposes via the import map. We register the typings on
 * `javascriptDefaults` (and `typescriptDefaults` for parity) and
 * declare the runtime globals that the iframe injects.
 */
const attachThreeTypings: OnMount = (_editor, monaco) => {
  const declaration = `
declare module "three" {
  export = THREE;
  export as namespace THREE;
}
declare const THREE: typeof import("three");
declare const scene: import("three").Scene;
declare const camera: import("three").PerspectiveCamera;
declare const renderer: import("three").WebGLRenderer;
declare function requestAnimationFrame(cb: (t: number) => void): number;
`;
  const uri = "ts:filename/three-globals.d.ts";
  const existing = monaco.editor.getModel(monaco.Uri.parse(uri));
  if (!existing) {
    monaco.languages.typescript.javascriptDefaults.addExtraLib(declaration, uri);
    monaco.languages.typescript.typescriptDefaults.addExtraLib(declaration, uri);
  }
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
};

function ScriptDiskTool() {
  const desktop = useDesktopBridge();
  const [filePath, setFilePath] = useState<string | null>(null);
  const [contents, setContents] = useState<string>(STARTER_SCRIPT);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const previewRef = useRef<HTMLIFrameElement | null>(null);

  // Hydrate recent script paths from the on-disk MRU store.
  useEffect(() => {
    if (!desktop) return;
    void desktop.fs.recent("scripts.files").then(setRecents);
  }, [desktop, savedAt]);

  // Re-render the preview iframe whenever the script changes (debounced).
  useEffect(() => {
    const handle = setTimeout(() => {
      const iframe = previewRef.current;
      if (!iframe) return;
      const html = `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#0a0a0a}</style></head>
        <body>
          <script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js" } }<\/script>
          <script type="module">
            import * as THREE from "three";
            window.THREE = THREE;
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 1000);
            camera.position.set(3,3,3); camera.lookAt(0,0,0);
            const renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(innerWidth, innerHeight);
            document.body.appendChild(renderer.domElement);
            try {
              ${contents}
            } catch (e) { document.body.innerHTML = '<pre style="color:#f88;padding:12px;font-family:monospace">'+e.message+'</pre>'; }
          <\/script>
        </body></html>`;
      iframe.srcdoc = html;
    }, 400);
    return () => clearTimeout(handle);
  }, [contents]);

  if (!desktop) return <DesktopOnlyPlaceholder tool="Three.js Script Editor" />;

  const open = useCallback(async () => {
    const p = await desktop!.dialog.openFile({
      title: "Open script",
      rememberKey: "scripts.input",
      filters: [{ name: "Scripts", extensions: ["js", "ts", "mjs", "cjs"] }],
    });
    if (!p) return;
    try {
      const r = await desktop!.script.read(p);
      setFilePath(r.path);
      setContents(r.content);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [desktop]);

  async function writeTo(target: string) {
    try {
      await desktop!.script.write(target, contents);
      setFilePath(target);
      setSavedAt(Date.now());
      setError(null);
      // Push to MRU; the bridge dedupes on the main side.
      await desktop!.fs.recent("scripts.files");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const save = useCallback(async () => {
    let target = filePath;
    if (!target) {
      target = await desktop!.dialog.saveFile({
        title: "Save script as",
        rememberKey: "scripts.output",
        defaultName: "scene.js",
        filters: [{ name: "JavaScript", extensions: ["js"] }],
      });
      if (!target) return;
    }
    await writeTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, contents, filePath]);

  const saveAs = useCallback(async () => {
    const target = await desktop!.dialog.saveFile({
      title: "Save script as",
      rememberKey: "scripts.output",
      defaultName: filePath
        ? filePath.split(/[\\/]/).pop() ?? "scene.js"
        : "scene.js",
      filters: [{ name: "JavaScript", extensions: ["js"] }],
    });
    if (!target) return;
    await writeTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, contents, filePath]);

  const openRecent = useCallback(
    async (p: string) => {
      try {
        const r = await desktop!.script.read(p);
        setFilePath(r.path);
        setContents(r.content);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [desktop],
  );

  return (
    <div className="space-y-3 py-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={open}
          data-testid="button-script-open"
        >
          <FolderOpen className="size-4 mr-1" /> Open
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={save}
          data-testid="button-script-save"
        >
          <Save className="size-4 mr-1" /> Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={saveAs}
          data-testid="button-script-save-as"
        >
          Save As…
        </Button>
        {recents.length > 0 && (
          <Select onValueChange={openRecent}>
            <SelectTrigger
              className="h-8 w-[180px]"
              data-testid="select-script-recents"
            >
              <SelectValue placeholder="Recent files…" />
            </SelectTrigger>
            <SelectContent>
              {recents.filter((r) => r).map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {r.split(/[\\/]/).slice(-2).join("/")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setContents(STARTER_SCRIPT)}
          data-testid="button-script-template"
        >
          <Play className="size-4 mr-1" /> Insert starter
        </Button>
        <div className="text-xs text-muted-foreground ml-auto truncate max-w-[280px]">
          {filePath ?? "Untitled"}
          {savedAt && (
            <span className="ml-2">
              · saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 h-[360px]">
        <div
          className="rounded border overflow-hidden bg-background/50"
          data-testid="editor-script"
        >
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={contents}
            onChange={(v) => setContents(v ?? "")}
            onMount={attachThreeTypings}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              tabSize: 2,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              suggestOnTriggerCharacters: true,
              quickSuggestions: { other: true, comments: false, strings: false },
            }}
          />
        </div>
        <iframe
          ref={previewRef}
          title="Live preview"
          className="rounded border bg-black"
          sandbox="allow-scripts"
        />
      </div>
      {error && <ErrorBox message={error} />}
    </div>
  );
}

function PathPicker({
  label,
  value,
  onPick,
  testId,
  onDropPath,
  acceptHint,
}: {
  label: string;
  value: string;
  onPick: () => void;
  testId: string;
  onDropPath?: (path: string) => void;
  acceptHint?: string;
}) {
  const desktop = useDesktopBridge();
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!onDropPath || !desktop) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const p = desktop.fs.getPathForFile(file);
    if (p) onDropPath(p);
  };
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div
        className={`flex gap-2 rounded ${
          dragOver && onDropPath ? "ring-2 ring-primary/60" : ""
        }`}
        onDragOver={(e) => {
          if (!onDropPath) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        data-testid={`drop-${testId}`}
      >
        <Input
          value={value}
          readOnly
          placeholder={onDropPath ? `Drop a file or click Browse…` : "Click Browse…"}
          data-testid={`input-${testId}`}
        />
        <Button
          variant="outline"
          onClick={onPick}
          data-testid={`button-pick-${testId}`}
        >
          Browse…
        </Button>
      </div>
      {acceptHint && (
        <p className="text-[10px] text-muted-foreground">{acceptHint}</p>
      )}
    </div>
  );
}

function ResultBox({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
      <div className="flex items-center gap-2 font-medium">{icon} Result</div>
      <div>{children}</div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-start gap-2">
      <AlertTriangle className="size-4 text-destructive mt-0.5" />
      <div>{message}</div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
