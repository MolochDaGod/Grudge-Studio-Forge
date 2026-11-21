/**
 * Forge Renderer Inspector MVP — bottom-panel ops HUD.
 *
 * Tabs: Performance · Scene · Memory · Physics · Log
 * Actions: Copy snapshot (+ log tail) to clipboard.
 *
 * Data comes from RendererStatsSampler / RendererPhysicsSampler via
 * lib/rendererInspector.ts. Extends THREEJS_EDITOR_PARITY — not a Spawn clone.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditor } from "@/store/editor";
import {
  formatSnapshotForCopy,
  getRendererSnapshot,
  subscribeRendererSnapshot,
  type RendererInspectorTab,
  type RendererSnapshot,
  emptyRendererSnapshot,
} from "@/lib/rendererInspector";
import { Activity, Box, Copy, Cpu, MemoryStick, Terminal } from "lucide-react";
import { toast } from "sonner";

function Row({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs font-mono">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={warn ? "text-amber-400 tabular-nums" : "text-foreground/90 tabular-nums"}>
        {value}
      </span>
    </div>
  );
}

function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function PerformancePane({ snap }: { snap: RendererSnapshot }) {
  const fpsWarn = snap.fps > 0 && snap.fps < 30;
  const drawWarn = snap.calls > 500;
  return (
    <div className="space-y-1 p-3">
      <Row label="FPS" value={fmt(snap.fps, 1)} warn={fpsWarn} />
      <Row label="Frame ms" value={fmt(snap.frameMs, 2)} warn={snap.frameMs > 33} />
      <Row label="Draw calls" value={fmt(snap.calls)} warn={drawWarn} />
      <Row label="Triangles" value={fmt(snap.triangles)} />
      <Row label="Points" value={fmt(snap.points)} />
      <Row label="Lines" value={fmt(snap.lines)} />
      <Row label="Backend" value={snap.backend} />
      <Row label="Quality" value={snap.renderQuality} />
      <Row label="Playing" value={snap.isPlaying ? "yes" : "no"} />
    </div>
  );
}

function ScenePane({ snap }: { snap: RendererSnapshot }) {
  return (
    <div className="space-y-1 p-3">
      <Row label="Entities (.gfscene)" value={fmt(snap.entities)} />
      <Row label="Entities w/ physics" value={fmt(snap.entitiesWithPhysics)} />
      <Row label="Object3D" value={fmt(snap.objects)} />
      <Row label="Meshes" value={fmt(snap.meshes)} />
      <Row label="Skinned" value={fmt(snap.skinnedMeshes)} />
      <Row label="Bones" value={fmt(snap.bones)} />
      <Row label="Lights" value={fmt(snap.lights)} />
      <Row label="Cameras" value={fmt(snap.cameras)} />
    </div>
  );
}

function MemoryPane({ snap }: { snap: RendererSnapshot }) {
  return (
    <div className="space-y-1 p-3">
      <Row label="Geometries (GPU)" value={fmt(snap.geometries)} />
      <Row label="Textures (GPU)" value={fmt(snap.textures)} />
      <Row
        label="JS heap used"
        value={snap.jsHeapUsedMb != null ? `${fmt(snap.jsHeapUsedMb, 1)} MB` : "n/a"}
        warn={snap.jsHeapUsedMb != null && snap.jsHeapUsedMb > 512}
      />
      <Row
        label="JS heap total"
        value={snap.jsHeapTotalMb != null ? `${fmt(snap.jsHeapTotalMb, 1)} MB` : "n/a"}
      />
      <p className="pt-2 text-[10px] text-muted-foreground leading-snug">
        GPU counts come from <code className="text-accent">WebGLRenderer.info.memory</code>. JS heap
        is Chromium-only (<code className="text-accent">performance.memory</code>).
      </p>
    </div>
  );
}

function PhysicsPane({ snap }: { snap: RendererSnapshot }) {
  const live = snap.rapierBodies != null;
  return (
    <div className="space-y-1 p-3">
      <Row label="Authored physics ents" value={fmt(snap.entitiesWithPhysics)} />
      <Row
        label="Rapier bodies"
        value={live ? fmt(snap.rapierBodies!) : "n/a (press Play)"}
      />
      <Row
        label="Rapier colliders"
        value={live ? fmt(snap.rapierColliders!) : "n/a (press Play)"}
      />
      <Row
        label="Step ms"
        value={
          snap.rapierStepMs != null ? fmt(snap.rapierStepMs, 2) : "n/a (not instrumented)"
        }
      />
      <p className="pt-2 text-[10px] text-muted-foreground leading-snug">
        Live Rapier counts appear in Play mode. Authored count is from entity{" "}
        <code className="text-accent">physics</code> components in the scene graph.
      </p>
    </div>
  );
}

function LogPane() {
  const messages = useEditor((s) => s.consoleMessages);
  const clear = useEditor((s) => s.clearConsole);
  const tail = messages.slice(-60);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/50 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Console tail ({tail.length})
        </span>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={clear}>
          Clear
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5 font-mono text-[11px]">
          {tail.length === 0 && (
            <p className="text-muted-foreground/60 p-2">No console messages.</p>
          )}
          {tail.map((m) => {
            const color =
              m.level === "error"
                ? "text-destructive"
                : m.level === "warn"
                  ? "text-amber-400"
                  : m.level === "info"
                    ? "text-accent"
                    : "text-foreground/80";
            return (
              <div key={m.id} className={`flex gap-2 ${color}`}>
                <span className="text-muted-foreground/60 shrink-0">
                  {new Date(m.ts).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className="uppercase text-[10px] mt-px shrink-0 w-10 text-muted-foreground/60">
                  {m.level}
                </span>
                <span className="break-all whitespace-pre-wrap">{m.text}</span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export function RendererInspector() {
  const [snap, setSnap] = useState<RendererSnapshot>(() => getRendererSnapshot());
  const [tab, setTab] = useState<RendererInspectorTab>("performance");

  useEffect(() => subscribeRendererSnapshot(setSnap), []);

  const onCopy = async () => {
    const logs = useEditor.getState().consoleMessages.map((m) => ({
      level: m.level,
      text: m.text,
      ts: m.ts,
    }));
    const text = formatSnapshotForCopy(snap.ts ? snap : emptyRendererSnapshot(snap), logs);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Renderer snapshot copied");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  return (
    <div className="flex flex-col h-full bg-card/40" data-testid="renderer-inspector">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Renderer Inspector
          <span className="ml-2 text-muted-foreground/70 font-mono normal-case">
            {snap.fps > 0 ? `${fmt(snap.fps, 0)} fps · ${fmt(snap.calls)} draws` : "waiting for viewport…"}
          </span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={() => void onCopy()}
          data-testid="renderer-inspector-copy"
          title="Copy performance / scene / memory / physics / log tail"
        >
          <Copy className="size-3 mr-1" /> Copy
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as RendererInspectorTab)}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList className="rounded-none w-fit mx-2 mt-1.5 shrink-0 h-8">
          <TabsTrigger value="performance" className="text-xs gap-1 px-2" data-testid="ri-tab-performance">
            <Activity className="size-3" /> Perf
          </TabsTrigger>
          <TabsTrigger value="scene" className="text-xs gap-1 px-2" data-testid="ri-tab-scene">
            <Box className="size-3" /> Scene
          </TabsTrigger>
          <TabsTrigger value="memory" className="text-xs gap-1 px-2" data-testid="ri-tab-memory">
            <MemoryStick className="size-3" /> Mem
          </TabsTrigger>
          <TabsTrigger value="physics" className="text-xs gap-1 px-2" data-testid="ri-tab-physics">
            <Cpu className="size-3" /> Phys
          </TabsTrigger>
          <TabsTrigger value="log" className="text-xs gap-1 px-2" data-testid="ri-tab-log">
            <Terminal className="size-3" /> Log
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0">
          <TabsContent value="performance" className="m-0 h-full overflow-auto">
            <PerformancePane snap={snap} />
          </TabsContent>
          <TabsContent value="scene" className="m-0 h-full overflow-auto">
            <ScenePane snap={snap} />
          </TabsContent>
          <TabsContent value="memory" className="m-0 h-full overflow-auto">
            <MemoryPane snap={snap} />
          </TabsContent>
          <TabsContent value="physics" className="m-0 h-full overflow-auto">
            <PhysicsPane snap={snap} />
          </TabsContent>
          <TabsContent value="log" className="m-0 h-full min-h-0 flex flex-col">
            <LogPane />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
