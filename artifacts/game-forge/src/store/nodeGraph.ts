import { create } from "zustand";
import { nanoid } from "nanoid";
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import {
  type GraphKind,
  type SceneFlowNode,
  type SceneFlowEdge,
  type SceneNodeKind,
  type NodeGraph,
  SCENE_NODE_DEFAULTS,
  SCENE_NODE_LABELS,
} from "@/editor/nodes/types";

const emptyGraph = (kind: GraphKind): NodeGraph => ({
  kind,
  nodes:
    kind === "scene"
      ? [
          {
            id: nanoid(6),
            type: "sceneOutput",
            position: { x: 600, y: 200 },
            data: {
              kind: "sceneOutput",
              label: SCENE_NODE_LABELS.sceneOutput,
              params: { ...SCENE_NODE_DEFAULTS.sceneOutput },
            },
          },
        ]
      : [],
  edges: [],
});

interface NodeGraphState {
  activeKind: GraphKind;
  graphs: Record<GraphKind, NodeGraph>;

  setActiveKind: (k: GraphKind) => void;
  setNodes: (nodes: SceneFlowNode[]) => void;
  setEdges: (edges: SceneFlowEdge[]) => void;
  onNodesChange: (changes: NodeChange<SceneFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<SceneFlowEdge>[]) => void;
  addNode: (kind: SceneNodeKind, position: { x: number; y: number }) => void;
  updateNodeParam: (id: string, field: string, value: number | string | boolean) => void;
  clearGraph: (kind: GraphKind) => void;
  loadGraph: (kind: GraphKind, graph: NodeGraph) => void;
}

export const useNodeGraph = create<NodeGraphState>((set, get) => ({
  activeKind: "scene",
  graphs: {
    scene: emptyGraph("scene"),
    logic: emptyGraph("logic"),
    shader: emptyGraph("shader"),
  },

  setActiveKind: (k) => set({ activeKind: k }),

  setNodes: (nodes) =>
    set((s) => ({
      graphs: {
        ...s.graphs,
        [s.activeKind]: { ...s.graphs[s.activeKind], nodes },
      },
    })),

  setEdges: (edges) =>
    set((s) => ({
      graphs: {
        ...s.graphs,
        [s.activeKind]: { ...s.graphs[s.activeKind], edges },
      },
    })),

  onNodesChange: (changes) =>
    set((s) => {
      const cur = s.graphs[s.activeKind];
      return {
        graphs: {
          ...s.graphs,
          [s.activeKind]: { ...cur, nodes: applyNodeChanges(changes, cur.nodes) as SceneFlowNode[] },
        },
      };
    }),

  onEdgesChange: (changes) =>
    set((s) => {
      const cur = s.graphs[s.activeKind];
      return {
        graphs: {
          ...s.graphs,
          [s.activeKind]: { ...cur, edges: applyEdgeChanges(changes, cur.edges) },
        },
      };
    }),

  addNode: (kind, position) =>
    set((s) => {
      const cur = s.graphs[s.activeKind];
      const newNode: SceneFlowNode = {
        id: nanoid(6),
        type: kind,
        position,
        data: {
          kind,
          label: SCENE_NODE_LABELS[kind],
          params: { ...SCENE_NODE_DEFAULTS[kind] },
        },
      };
      return {
        graphs: {
          ...s.graphs,
          [s.activeKind]: { ...cur, nodes: [...cur.nodes, newNode] },
        },
      };
    }),

  updateNodeParam: (id, field, value) =>
    set((s) => {
      const cur = s.graphs[s.activeKind];
      return {
        graphs: {
          ...s.graphs,
          [s.activeKind]: {
            ...cur,
            nodes: cur.nodes.map((n) =>
              n.id === id
                ? { ...n, data: { ...n.data, params: { ...n.data.params, [field]: value } } }
                : n,
            ),
          },
        },
      };
    }),

  clearGraph: (kind) =>
    set((s) => ({
      graphs: { ...s.graphs, [kind]: emptyGraph(kind) },
    })),

  loadGraph: (kind, graph) =>
    set((s) => ({
      graphs: { ...s.graphs, [kind]: graph },
    })),
}));
