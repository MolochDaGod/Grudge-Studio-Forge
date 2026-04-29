import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SceneFlowNode, SceneNodeKind } from "./types";
import { useNodeGraph } from "@/store/nodeGraph";
import {
  Box,
  Circle,
  Square,
  Cylinder,
  Palette,
  Move3D,
  Lightbulb,
  Layers,
  Target,
} from "lucide-react";

const ICONS: Record<SceneNodeKind, typeof Box> = {
  geomBox: Box,
  geomSphere: Circle,
  geomPlane: Square,
  geomCylinder: Cylinder,
  material: Palette,
  mesh: Layers,
  light: Lightbulb,
  transform: Move3D,
  sceneOutput: Target,
};

const HEADER_TINT: Record<SceneNodeKind, string> = {
  geomBox: "from-blue-700 to-blue-800",
  geomSphere: "from-blue-700 to-blue-800",
  geomPlane: "from-blue-700 to-blue-800",
  geomCylinder: "from-blue-700 to-blue-800",
  material: "from-purple-700 to-purple-800",
  mesh: "from-amber-700 to-amber-800",
  light: "from-yellow-600 to-yellow-700",
  transform: "from-emerald-700 to-emerald-800",
  sceneOutput: "from-[#a8881e] to-[#d4af37]",
};

interface FieldProps {
  nodeId: string;
  field: string;
  value: number | string | boolean;
  type?: "number" | "color" | "text" | "select";
  options?: string[];
  step?: number;
  label?: string;
}

function Field({ nodeId, field, value, type = "number", options, step = 0.1, label }: FieldProps) {
  const updateNodeParam = useNodeGraph((s) => s.updateNodeParam);
  const onChange = useCallback(
    (v: number | string | boolean) => updateNodeParam(nodeId, field, v),
    [nodeId, field, updateNodeParam],
  );
  return (
    <label className="flex items-center justify-between gap-2 text-[10px]">
      <span className="text-muted-foreground capitalize w-12 truncate">
        {label ?? field}
      </span>
      {type === "color" ? (
        <input
          type="color"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-5 w-7 rounded border border-border bg-transparent cursor-pointer nodrag"
        />
      ) : type === "select" && options ? (
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="nodrag h-5 w-20 rounded border border-border bg-background px-1 text-[10px]"
        >
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : type === "number" ? (
        <input
          type="number"
          value={Number(value)}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="nodrag h-5 w-16 rounded border border-border bg-background px-1 text-[10px] text-right tabular-nums"
        />
      ) : (
        <input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="nodrag h-5 w-20 rounded border border-border bg-background px-1 text-[10px]"
        />
      )}
    </label>
  );
}

interface BaseShellProps {
  kind: SceneNodeKind;
  title: string;
  hasInput?: boolean;
  hasOutput?: boolean;
  inputs?: Array<{ id: string; label: string; offset: number }>;
  children?: React.ReactNode;
}

function NodeShell({ kind, title, hasInput, hasOutput, inputs, children }: BaseShellProps) {
  const Icon = ICONS[kind];
  return (
    <div className="rounded-md border border-border bg-card shadow-md min-w-[180px] overflow-hidden text-foreground">
      <div className={`flex items-center gap-1.5 bg-gradient-to-r ${HEADER_TINT[kind]} px-2 py-1 text-[11px] text-white`}>
        <Icon className="size-3" />
        <span className="font-medium">{title}</span>
      </div>
      <div className="p-2 space-y-1.5">{children}</div>
      {hasInput && (
        <Handle type="target" position={Position.Left} className="!size-2 !bg-[#d4af37] !border-[#d4af37]" />
      )}
      {inputs?.map((inp) => (
        <Handle
          key={inp.id}
          id={inp.id}
          type="target"
          position={Position.Left}
          style={{ top: inp.offset }}
          className="!size-2 !bg-[#d4af37] !border-[#d4af37]"
        />
      ))}
      {hasOutput && (
        <Handle type="source" position={Position.Right} className="!size-2 !bg-[#d4af37] !border-[#d4af37]" />
      )}
    </div>
  );
}

const GeomBoxNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="geomBox" title={data.label} hasOutput>
    <Field nodeId={id} field="sizeX" value={data.params.sizeX} label="X" />
    <Field nodeId={id} field="sizeY" value={data.params.sizeY} label="Y" />
    <Field nodeId={id} field="sizeZ" value={data.params.sizeZ} label="Z" />
  </NodeShell>
));
GeomBoxNode.displayName = "GeomBoxNode";

const GeomSphereNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="geomSphere" title={data.label} hasOutput>
    <Field nodeId={id} field="radius" value={data.params.radius} label="radius" />
  </NodeShell>
));
GeomSphereNode.displayName = "GeomSphereNode";

const GeomPlaneNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="geomPlane" title={data.label} hasOutput>
    <Field nodeId={id} field="sizeX" value={data.params.sizeX} label="X" />
    <Field nodeId={id} field="sizeY" value={data.params.sizeY} label="Y" />
  </NodeShell>
));
GeomPlaneNode.displayName = "GeomPlaneNode";

const GeomCylinderNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="geomCylinder" title={data.label} hasOutput>
    <Field nodeId={id} field="radius" value={data.params.radius} label="radius" />
    <Field nodeId={id} field="height" value={data.params.height} label="height" />
  </NodeShell>
));
GeomCylinderNode.displayName = "GeomCylinderNode";

const MaterialNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="material" title={data.label} hasOutput>
    <Field nodeId={id} field="color" value={data.params.color} type="color" label="color" />
    <Field nodeId={id} field="metalness" value={data.params.metalness} step={0.05} label="metal" />
    <Field nodeId={id} field="roughness" value={data.params.roughness} step={0.05} label="rough" />
  </NodeShell>
));
MaterialNode.displayName = "MaterialNode";

const MeshNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="mesh" title={data.label} hasInput hasOutput>
    <Field nodeId={id} field="name" value={data.params.name} type="text" label="name" />
    <p className="text-[9px] text-muted-foreground leading-tight">
      Inputs: geometry, material, transform
    </p>
  </NodeShell>
));
MeshNode.displayName = "MeshNode";

const LightNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="light" title={data.label} hasInput hasOutput>
    <Field
      nodeId={id}
      field="kind"
      value={data.params.kind}
      type="select"
      options={["point", "directional", "spot"]}
      label="kind"
    />
    <Field nodeId={id} field="color" value={data.params.color} type="color" label="color" />
    <Field nodeId={id} field="intensity" value={data.params.intensity} step={0.1} label="intens" />
    <Field nodeId={id} field="distance" value={data.params.distance} step={0.5} label="dist" />
  </NodeShell>
));
LightNode.displayName = "LightNode";

const TransformNode = memo(({ id, data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="transform" title={data.label} hasOutput>
    <div className="grid grid-cols-3 gap-1">
      <Field nodeId={id} field="x" value={data.params.x} label="X" />
      <Field nodeId={id} field="y" value={data.params.y} label="Y" />
      <Field nodeId={id} field="z" value={data.params.z} label="Z" />
    </div>
  </NodeShell>
));
TransformNode.displayName = "TransformNode";

const SceneOutputNode = memo(({ data }: NodeProps<SceneFlowNode>) => (
  <NodeShell kind="sceneOutput" title={data.label} hasInput>
    <p className="text-[9px] text-muted-foreground leading-tight">
      Connect meshes and lights here, then click Apply to spawn.
    </p>
  </NodeShell>
));
SceneOutputNode.displayName = "SceneOutputNode";

export const sceneNodeTypes = {
  geomBox: GeomBoxNode,
  geomSphere: GeomSphereNode,
  geomPlane: GeomPlaneNode,
  geomCylinder: GeomCylinderNode,
  material: MaterialNode,
  mesh: MeshNode,
  light: LightNode,
  transform: TransformNode,
  sceneOutput: SceneOutputNode,
};
