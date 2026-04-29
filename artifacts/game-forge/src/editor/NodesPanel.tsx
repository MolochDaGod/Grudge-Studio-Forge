import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  type Connection,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Boxes,
  Sparkles,
  Palette as PaletteIcon,
  GitBranch,
  Plus,
  Play,
  Trash2,
} from "lucide-react";
import { useEditor } from "@/store/editor";
import { useNodeGraph } from "@/store/nodeGraph";
import { sceneNodeTypes } from "./nodes/sceneNodes";
import { compileSceneGraph } from "./nodes/sceneCompile";
import {
  SCENE_NODE_LABELS,
  type SceneNodeKind,
} from "./nodes/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const SCENE_PALETTE: SceneNodeKind[] = [
  "geomBox",
  "geomSphere",
  "geomPlane",
  "geomCylinder",
  "material",
  "transform",
  "mesh",
  "light",
  "sceneOutput",
];

function GraphKindTab({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Boxes;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
        active
          ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[#d4af37]"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}

function NodesPanelInner() {
  const kind = useNodeGraph((s) => s.activeKind);
  const setKind = useNodeGraph((s) => s.setActiveKind);
  const nodes = useNodeGraph((s) => s.graphs[s.activeKind].nodes);
  const edges = useNodeGraph((s) => s.graphs[s.activeKind].edges);
  const setNodes = useNodeGraph((s) => s.setNodes);
  const setEdges = useNodeGraph((s) => s.setEdges);
  const addNode = useNodeGraph((s) => s.addNode);
  const onNodesChange = useNodeGraph((s) => s.onNodesChange);
  const onEdgesChange = useNodeGraph((s) => s.onEdgesChange);
  const clearGraph = useNodeGraph((s) => s.clearGraph);

  const projectId = useEditor((s) => s.projectId);
  const cmdAddEntity = useEditor((s) => s.cmdAddEntity);
  const updateEntity = useEditor((s) => s.updateEntity);
  const selectEntity = useEditor((s) => s.selectEntity);
  const log = useEditor((s) => s.pushLog);

  const [aiPrompt, setAiPrompt] = useState("");

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => setEdges(addEdge(connection, edges)),
    [edges, setEdges],
  );

  const handleApply = useCallback(() => {
    if (kind !== "scene") {
      log("warn", `Compile not yet wired for ${kind} graph (coming next turn).`);
      return;
    }
    if (!projectId) {
      log("warn", "Open a project first.");
      return;
    }
    const result = compileSceneGraph(nodes, edges);
    for (const w of result.warnings) log("warn", `[Nodes] ${w}`);
    if (result.entities.length === 0) {
      log("info", "[Nodes] Compiled graph produced 0 entities.");
      return;
    }
    let firstId: string | null = null;
    for (const ent of result.entities) {
      const created = cmdAddEntity(ent.type, ent.name, null);
      if (!firstId) firstId = created.id;
      updateEntity(created.id, (e) => {
        e.transform = ent.transform;
        if (ent.material) e.material = ent.material;
        if (ent.light) e.light = ent.light;
      });
    }
    if (firstId) selectEntity(firstId);
    log("info", `[Nodes] Spawned ${result.entities.length} entit${result.entities.length === 1 ? "y" : "ies"} from graph.`);
  }, [kind, nodes, edges, projectId, cmdAddEntity, updateEntity, selectEntity, log]);

  const handleAddNode = useCallback(
    (k: SceneNodeKind) => addNode(k, { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 }),
    [addNode],
  );

  const handleAiGenerate = useCallback(() => {
    if (!aiPrompt.trim()) return;
    log("info", `[AI Nodes] Prompt-to-graph wires up next turn (queued: "${aiPrompt}").`);
  }, [aiPrompt, log]);

  const palette = useMemo(() => {
    if (kind === "scene") return SCENE_PALETTE;
    return [];
  }, [kind]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border">
        <div className="flex items-center gap-1">
          <GraphKindTab
            active={kind === "scene"}
            onClick={() => setKind("scene")}
            icon={Boxes}
            label="Scene"
          />
          <GraphKindTab
            active={kind === "logic"}
            onClick={() => setKind("logic")}
            icon={GitBranch}
            label="Logic"
            disabled
          />
          <GraphKindTab
            active={kind === "shader"}
            onClick={() => setKind("shader")}
            icon={PaletteIcon}
            label="Shader"
            disabled
          />
        </div>
        <div className="h-4 w-px bg-border mx-1" />
        {palette.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1">
                <Plus className="size-3" /> Add Node
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="text-xs">
              <DropdownMenuLabel>Scene Nodes</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {palette.map((p) => (
                <DropdownMenuItem key={p} onClick={() => handleAddNode(p)}>
                  {SCENE_NODE_LABELS[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] gap-1"
          onClick={() => clearGraph(kind)}
          data-testid="button-clear-graph"
        >
          <Trash2 className="size-3" /> Clear
        </Button>
        <div className="flex-1 flex items-center gap-2 ml-2">
          <Sparkles className="size-3 text-[#d4af37] shrink-0" />
          <Input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAiGenerate(); }}
            placeholder="Describe a graph (AI prompt-to-graph wires up next turn)"
            className="h-6 text-[11px] flex-1 min-w-0"
            data-testid="input-ai-prompt"
          />
        </div>
        <Button
          size="sm"
          className="h-6 text-[11px] gap-1 bg-[#d4af37] text-black hover:bg-[#c19f2c]"
          onClick={handleApply}
          data-testid="button-apply-graph"
        >
          <Play className="size-3" /> Apply to Scene
        </Button>
      </div>

      <div className="flex-1 min-h-0 bg-[#0c0c0c]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={sceneNodeTypes}
          fitView
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            style: { stroke: "#d4af37", strokeWidth: 1.5 },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2a2a" />
          <Controls className="!bg-card !border-border" />
          <MiniMap
            pannable
            zoomable
            className="!bg-[#0c0c0c] !border-border"
            nodeColor={() => "#d4af37"}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export function NodesPanel() {
  return (
    <ReactFlowProvider>
      <NodesPanelInner />
    </ReactFlowProvider>
  );
}
