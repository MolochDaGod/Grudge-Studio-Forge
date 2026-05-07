import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { useEditor } from "@/store/editor";
import { bakeEntityConvexHulls } from "@/lib/bakeEntityColliders";
import type { BuildHullsOptions, HullFillMode } from "@/lib/colliderBaker";
import { useState } from "react";
import { useListScripts, getListScriptsQueryKey } from "@workspace/api-client-react";
import type { Vec3, CameraMode, ControllerKind } from "@/scene/types";
import {
  LAYERS,
  type LayerName,
  DEFAULT_GRAVITY,
  SURFACES,
  DEFAULT_NAV_AGENT,
  type SurfaceKind,
  type NavAgentComponent,
} from "@workspace/scene-schema";
import {
  Box,
  FlaskConical,
  Lightbulb,
  Palette,
  Settings2,
  Code2,
  User,
  Camera,
  Layers as LayersIcon,
  Map as MapIcon,
  Bot,
} from "lucide-react";

function NumberInput({
  value,
  onChange,
  step = 0.1,
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className={`h-7 text-xs font-mono ${className}`}
    />
  );
}

function Vec3Field({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  step?: number;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      <div className="grid grid-cols-3 gap-1.5">
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <div key={axis} className="relative">
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">
              {axis}
            </span>
            <NumberInput
              value={value[i]}
              onChange={(n) => {
                const next = [...value] as Vec3;
                next[i] = n;
                onChange(next);
              }}
              step={step}
              className="pl-5"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof Box;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
        <Icon className="size-3" />
        {title}
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  );
}

/** Sub-card rendered inside the "Nav Agent" section when the selected
 *  entity already has `navAgent` set. Lets the user retune the FSM
 *  parameters (filter / speed / radius / height / accel / turn) and
 *  remove the component. Every change routes through `cmdSetEntityNavAgent`
 *  so undo works one-step. */
function NavAgentEditor({
  entity,
}: {
  entity: { id: string; navAgent?: NavAgentComponent };
}) {
  const raw = entity.navAgent ?? DEFAULT_NAV_AGENT;
  // Normalize to a fully-populated agent so the editor controls never
  // see undefined fields. The narrowed shape mirrors DEFAULT_NAV_AGENT
  // (filter is always an array) which keeps the per-field handlers
  // below trivially typed.
  const agent: Required<Omit<NavAgentComponent, "animationClips">> & {
    animationClips?: NavAgentComponent["animationClips"];
  } = {
    ...DEFAULT_NAV_AGENT,
    ...raw,
    filter: raw.filter ?? DEFAULT_NAV_AGENT.filter,
  };
  const update = (patch: Partial<NavAgentComponent>) =>
    useEditor
      .getState()
      .cmdSetEntityNavAgent(entity.id, { ...agent, ...patch });
  const toggleFilter = (s: SurfaceKind) => {
    const has = agent.filter.includes(s);
    update({
      filter: has ? agent.filter.filter((x) => x !== s) : [...agent.filter, s],
    });
  };
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-[11px] text-muted-foreground">
          Surface filter
        </Label>
        <div className="flex flex-wrap gap-1 mt-1">
          {SURFACES.filter((s) => s !== "None").map((s) => {
            const active = agent.filter.includes(s);
            return (
              <button
                key={s}
                type="button"
                data-testid={`nav-agent-filter-${s}`}
                onClick={() => toggleFilter(s)}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>
      {(
        [
          ["speed", 0.1],
          ["radius", 0.05],
          ["height", 0.1],
          ["acceleration", 0.5],
          ["turnSpeed", 0.5],
        ] as Array<
          [
            "speed" | "radius" | "height" | "acceleration" | "turnSpeed",
            number,
          ]
        >
      ).map(([k, step]) => (
        <div key={k} className="flex items-center gap-2">
          <Label className="text-[11px] text-muted-foreground w-20">{k}</Label>
          <NumberInput
            value={agent[k]}
            step={step}
            onChange={(n) => update({ [k]: n })}
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs w-full text-destructive"
        data-testid="btn-remove-nav-agent"
        onClick={() => useEditor.getState().cmdSetEntityNavAgent(entity.id, null)}
      >
        Remove nav-agent
      </Button>
    </div>
  );
}

/** Inspector control for the V-HACD convex-decomp baker. Mirrors the
 *  options accepted by the AI `bake_convex_hulls` tool and persists
 *  them on `physics.colliderBakeOptions` for reproducible re-bakes. */
function BakeConvexDecompPanel({
  entityId,
  saved,
}: {
  entityId: string;
  saved?: BuildHullsOptions;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxHulls, setMaxHulls] = useState<string>(
    saved?.maxHulls != null ? String(saved.maxHulls) : "",
  );
  const [minHullVolume, setMinHullVolume] = useState<string>(
    saved?.minHullVolume != null ? String(saved.minHullVolume) : "",
  );
  const [voxelResolution, setVoxelResolution] = useState<string>(
    saved?.voxelResolution != null ? String(saved.voxelResolution) : "",
  );
  const [maxVerticesPerHull, setMaxVerticesPerHull] = useState<string>(
    saved?.maxVerticesPerHull != null ? String(saved.maxVerticesPerHull) : "",
  );
  const [fillMode, setFillMode] = useState<HullFillMode | "default">(
    saved?.fillMode ?? "default",
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    kind: "info" | "ok" | "error";
    text: string;
  } | null>(null);

  const onBake = async () => {
    const opts: BuildHullsOptions = {};
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };
    const mh = num(maxHulls);
    if (mh !== undefined) opts.maxHulls = mh;
    const mv = num(minHullVolume);
    if (mv !== undefined) opts.minHullVolume = mv;
    const vr = num(voxelResolution);
    if (vr !== undefined) opts.voxelResolution = vr;
    const mvph = num(maxVerticesPerHull);
    if (mvph !== undefined) opts.maxVerticesPerHull = mvph;
    if (fillMode !== "default") opts.fillMode = fillMode;
    setBusy(true);
    setStatus({ kind: "info", text: "Baking convex hulls…" });
    try {
      const r = await bakeEntityConvexHulls(entityId, opts);
      if (r.ok) {
        const warn =
          r.warnings.length > 0
            ? ` (${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"})`
            : "";
        setStatus({
          kind: "ok",
          text: `Baked ${r.hulls} hull${r.hulls === 1 ? "" : "s"} (${r.totalVerts} verts)${warn}.`,
        });
      } else {
        setStatus({ kind: "error", text: r.error });
      }
    } catch (err) {
      setStatus({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 border-t border-border/50 pt-3">
      <Label className="text-xs text-muted-foreground block">
        Convex Decomposition
      </Label>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs flex-1"
          disabled={busy}
          onClick={() => void onBake()}
          data-testid="btn-bake-convex-decomp"
        >
          {busy
            ? "Baking…"
            : saved
              ? "Re-bake convex decomp"
              : "Bake convex decomp"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="btn-bake-advanced-toggle"
        >
          {showAdvanced ? "Hide" : "Advanced"}
        </Button>
      </div>
      {showAdvanced && (
        <div className="space-y-1.5 pt-1.5" data-testid="bake-advanced-panel">
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1 block">
              Max hulls (V-HACD default 64)
            </Label>
            <Input
              type="number"
              value={maxHulls}
              placeholder="e.g. 32"
              onChange={(e) => setMaxHulls(e.target.value)}
              className="h-7 text-xs font-mono"
              data-testid="input-bake-max-hulls"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1 block">
              Voxel resolution (default 400000)
            </Label>
            <Input
              type="number"
              value={voxelResolution}
              placeholder="e.g. 100000"
              onChange={(e) => setVoxelResolution(e.target.value)}
              className="h-7 text-xs font-mono"
              data-testid="input-bake-voxel-resolution"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1 block">
              Max verts / hull (default 64)
            </Label>
            <Input
              type="number"
              value={maxVerticesPerHull}
              placeholder="e.g. 64"
              onChange={(e) => setMaxVerticesPerHull(e.target.value)}
              className="h-7 text-xs font-mono"
              data-testid="input-bake-max-verts-per-hull"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1 block">
              Min hull volume (m³, drops slivers)
            </Label>
            <Input
              type="number"
              value={minHullVolume}
              placeholder="e.g. 0.001"
              onChange={(e) => setMinHullVolume(e.target.value)}
              className="h-7 text-xs font-mono"
              data-testid="input-bake-min-hull-volume"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1 block">
              Fill mode
            </Label>
            <Select
              value={fillMode}
              onValueChange={(v) => setFillMode(v as HullFillMode | "default")}
            >
              <SelectTrigger
                className="h-7 text-xs"
                data-testid="select-bake-fill-mode"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default (flood)</SelectItem>
                <SelectItem value="flood">Flood — watertight meshes</SelectItem>
                <SelectItem value="raycast">Raycast — open meshes</SelectItem>
                <SelectItem value="surface">Surface — hollow / skin only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {status && (
        <p
          className={`text-[11px] ${
            status.kind === "error"
              ? "text-destructive"
              : status.kind === "ok"
                ? "text-foreground"
                : "text-muted-foreground"
          }`}
          data-testid="bake-convex-decomp-status"
        >
          {status.text}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        V-HACD splits the entity's mesh into convex hulls so concave shapes
        (rooms, characters, U-shapes) collide accurately. Settings are saved
        on the entity for reproducible re-bakes.
      </p>
    </div>
  );
}

export function Inspector() {
  const projectId = useEditor((s) => s.projectId);
  const selectedId = useEditor((s) => s.selectedId);
  const entity = useEditor((s) =>
    s.selectedId ? s.sceneData.entities.find((e) => e.id === s.selectedId) ?? null : null,
  );
  const env = useEditor((s) => s.sceneData.environment);
  // All scene mutations route through the cmd* wrappers so every edit is
  // captured by the CommandStack and reachable via Ctrl+Z / redo. Direct
  // `setEnvironment` / `updateEntity` etc. on the store remain available
  // but bypass undo — only use them for non-user-driven internal flows.
  const setEnv = useEditor((s) => s.cmdSetEnvironment);
  const updateEntity = useEditor((s) => s.cmdUpdateEntity);
  const setEntityTransform = useEditor((s) => s.cmdSetEntityTransform);
  const renameEntity = useEditor((s) => s.cmdRenameEntity);
  const setEntityScript = useEditor((s) => s.cmdSetEntityScript);
  const setEntityController = useEditor((s) => s.cmdSetEntityController);
  const entities = useEditor((s) => s.sceneData.entities);
  const explodeGlbHierarchy = useEditor((s) => s.explodeGlbHierarchy);

  const { data: scripts = [] } = useListScripts(projectId ?? 0, {
    query: { queryKey: getListScriptsQueryKey(projectId ?? 0), enabled: !!projectId },
  });

  if (!entity) {
    return (
      <div className="h-full flex flex-col bg-sidebar">
        <div className="px-3 py-2 border-b border-sidebar-border text-xs uppercase tracking-wider text-muted-foreground">
          Environment
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Sky</Label>
              <Input
                type="color"
                value={env.skyColor ?? "#0a0a14"}
                onChange={(e) => setEnv({ skyColor: e.target.value })}
                className="h-8 cursor-pointer"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Ambient: {(env.ambientIntensity ?? 0.4).toFixed(2)}
              </Label>
              <Slider
                value={[env.ambientIntensity ?? 0.4]}
                min={0}
                max={2}
                step={0.05}
                onValueChange={([v]) => setEnv({ ambientIntensity: v })}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Sun: {(env.sunIntensity ?? 1.2).toFixed(2)}
              </Label>
              <Slider
                value={[env.sunIntensity ?? 1.2]}
                min={0}
                max={5}
                step={0.05}
                onValueChange={([v]) => setEnv({ sunIntensity: v })}
              />
            </div>
            <Vec3Field
              label="Gravity"
              value={(env.gravity ?? DEFAULT_GRAVITY) as Vec3}
              onChange={(v) => setEnv({ gravity: v })}
              step={0.1}
            />

            <Separator />

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
                <Camera className="size-3" /> Play-Mode Camera
              </Label>
              <Select
                value={env.cameraMode ?? "editor"}
                onValueChange={(v) => setEnv({ cameraMode: v as CameraMode })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor (orbit)</SelectItem>
                  <SelectItem value="rts">RTS top-down</SelectItem>
                  <SelectItem value="thirdPerson">Third-person</SelectItem>
                  <SelectItem value="firstPerson">First-person</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Camera Target</Label>
              <Select
                value={env.cameraTargetEntityId ?? "__auto"}
                onValueChange={(v) =>
                  setEnv({ cameraTargetEntityId: v === "__auto" ? null : v })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Auto (first player)</SelectItem>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Move Speed: {(env.playerMoveSpeed ?? 6).toFixed(1)} m/s
              </Label>
              <Slider
                value={[env.playerMoveSpeed ?? 6]}
                min={1}
                max={20}
                step={0.5}
                onValueChange={([v]) => setEnv({ playerMoveSpeed: v })}
              />
            </div>

            <p className="text-[11px] text-muted-foreground pt-2">
              Select an entity in the hierarchy to edit its components.
            </p>
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-sidebar">
      <div className="px-3 py-2 border-b border-sidebar-border flex items-center gap-2">
        <Input
          value={entity.name}
          onChange={(e) => renameEntity(entity.id, e.target.value)}
          className="h-7 text-sm font-medium border-transparent bg-transparent focus-visible:bg-background"
          data-testid="input-entity-name"
        />
        <span className="text-[10px] uppercase font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">
          {entity.type}
        </span>
      </div>

      <ScrollArea className="flex-1">
        <Section title="Layer" Icon={LayersIcon}>
          <Select
            value={(entity.layer as LayerName | undefined) ?? "Default"}
            onValueChange={(v) =>
              useEditor.getState().cmdSetEntityLayer([entity.id], v as LayerName)
            }
          >
            <SelectTrigger className="h-7 text-xs" data-testid="select-entity-layer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAYERS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Drives Rapier collision groups via the scene's collision matrix
            (Layers panel). Trigger / Water default to sensors.
          </p>
        </Section>

        <Section title="Surface" Icon={MapIcon}>
          <Select
            value={(entity.surface as SurfaceKind | undefined) ?? "None"}
            onValueChange={(v) =>
              useEditor
                .getState()
                .cmdSetEntitySurface([entity.id], v as SurfaceKind)
            }
          >
            <SelectTrigger
              className="h-7 text-xs"
              data-testid="select-entity-surface"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SURFACES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Recast area + lockstep layer (Walk/Jump/Climb/Dig→Terrain,
            Swim→Water). Re-bake the navmesh after retagging.
          </p>
        </Section>

        <Section title="Nav Agent" Icon={Bot}>
          {entity.navAgent ? (
            <NavAgentEditor entity={entity} />
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs w-full"
              data-testid="btn-add-nav-agent"
              onClick={() =>
                useEditor
                  .getState()
                  .cmdSetEntityNavAgent(entity.id, { ...DEFAULT_NAV_AGENT })
              }
            >
              Add nav-agent
            </Button>
          )}
        </Section>

        <Section title="Transform" Icon={Settings2}>
          <Vec3Field
            label="Position"
            value={entity.transform.position}
            onChange={(v) => setEntityTransform(entity.id, "position", v)}
          />
          <Vec3Field
            label="Rotation (rad)"
            value={entity.transform.rotation}
            onChange={(v) => setEntityTransform(entity.id, "rotation", v)}
            step={0.05}
          />
          <Vec3Field
            label="Scale"
            value={entity.transform.scale}
            onChange={(v) => setEntityTransform(entity.id, "scale", v)}
            step={0.05}
          />
        </Section>

        {entity.material && (
          <Section title="Material" Icon={Palette}>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Color</Label>
              <Input
                type="color"
                value={entity.material.color ?? "#d4af37"}
                onChange={(e) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.material) d.material = {};
                    d.material.color = e.target.value;
                  })
                }
                className="h-8 cursor-pointer"
                data-testid="input-material-color"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Metalness: {(entity.material.metalness ?? 0.1).toFixed(2)}
              </Label>
              <Slider
                value={[entity.material.metalness ?? 0.1]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([v]) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.material) d.material = {};
                    d.material.metalness = v;
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Roughness: {(entity.material.roughness ?? 0.6).toFixed(2)}
              </Label>
              <Slider
                value={[entity.material.roughness ?? 0.6]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([v]) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.material) d.material = {};
                    d.material.roughness = v;
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Emissive</Label>
              <Input
                type="color"
                value={entity.material.emissive ?? "#000000"}
                onChange={(e) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.material) d.material = {};
                    d.material.emissive = e.target.value;
                  })
                }
                className="h-8 cursor-pointer"
              />
            </div>
          </Section>
        )}

        {entity.light && (
          <Section title="Light" Icon={Lightbulb}>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Kind</Label>
              <Select
                value={entity.light.kind ?? "point"}
                onValueChange={(v) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.light) d.light = {};
                    d.light.kind = v as "point" | "directional" | "spot";
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="point">Point</SelectItem>
                  <SelectItem value="directional">Directional</SelectItem>
                  <SelectItem value="spot">Spot</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Color</Label>
              <Input
                type="color"
                value={entity.light.color ?? "#ffffff"}
                onChange={(e) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.light) d.light = {};
                    d.light.color = e.target.value;
                  })
                }
                className="h-8 cursor-pointer"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Intensity: {(entity.light.intensity ?? 4).toFixed(1)}
              </Label>
              <Slider
                value={[entity.light.intensity ?? 4]}
                min={0}
                max={20}
                step={0.1}
                onValueChange={([v]) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.light) d.light = {};
                    d.light.intensity = v;
                  })
                }
              />
            </div>
          </Section>
        )}

        {entity.physics && (
          <Section title="Rigid Body" Icon={FlaskConical}>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Body Type</Label>
              <Select
                value={entity.physics.bodyType ?? "dynamic"}
                onValueChange={(v) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.physics) d.physics = {};
                    d.physics.bodyType = v as "fixed" | "dynamic" | "kinematicPosition" | "kinematicVelocity";
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dynamic">Dynamic</SelectItem>
                  <SelectItem value="fixed">Fixed (static)</SelectItem>
                  <SelectItem value="kinematicPosition">Kinematic Position</SelectItem>
                  <SelectItem value="kinematicVelocity">Kinematic Velocity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Mass: {(entity.physics.mass ?? 1).toFixed(2)}
              </Label>
              <Slider
                value={[entity.physics.mass ?? 1]}
                min={0.1}
                max={20}
                step={0.1}
                onValueChange={([v]) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.physics) d.physics = {};
                    d.physics.mass = v;
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Restitution: {(entity.physics.restitution ?? 0.4).toFixed(2)}
              </Label>
              <Slider
                value={[entity.physics.restitution ?? 0.4]}
                min={0}
                max={1.5}
                step={0.05}
                onValueChange={([v]) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.physics) d.physics = {};
                    d.physics.restitution = v;
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Friction: {(entity.physics.friction ?? 0.6).toFixed(2)}
              </Label>
              <Slider
                value={[entity.physics.friction ?? 0.6]}
                min={0}
                max={2}
                step={0.05}
                onValueChange={([v]) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.physics) d.physics = {};
                    d.physics.friction = v;
                  })
                }
              />
            </div>
            <BakeConvexDecompPanel
              key={entity.id}
              entityId={entity.id}
              saved={entity.physics.colliderBakeOptions}
            />
          </Section>
        )}

        {entity.model && (
          <Section title="Model" Icon={Box}>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">URL (.glb / .gltf)</Label>
              <Input
                value={entity.model.url ?? ""}
                onChange={(e) =>
                  updateEntity(entity.id, (d) => {
                    if (!d.model) d.model = {};
                    d.model.url = e.target.value;
                  })
                }
                placeholder="https://..."
                className="h-7 text-xs font-mono"
                data-testid="input-model-url"
              />
            </div>
            {entity.model.proxy ? (
              <p className="text-[11px] text-muted-foreground">
                Locator (proxy) for sub-node{" "}
                <span className="font-mono text-foreground">{entity.model.subNode ?? "?"}</span> of
                its parent GLB. Geometry is rendered by the parent — this entity is a
                transform-only anchor you can target by name (Spawn_*, Cover_*, etc.) or attach
                scripts/behaviors to.
              </p>
            ) : (
              entity.model.url && (
                <div className="space-y-1.5">
                  {(() => {
                    const alreadyExposed = entities.some(
                      (e) => e.parentId === entity.id && e.model?.proxy,
                    );
                    return (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs w-full"
                          disabled={alreadyExposed}
                          onClick={() => {
                            void explodeGlbHierarchy(entity.id);
                          }}
                          data-testid="button-expose-children"
                        >
                          {alreadyExposed ? "Children already exposed" : "Expose Children"}
                        </Button>
                        <p className="text-[11px] text-muted-foreground">
                          Walks the GLB and adds a transform-only locator child for each top-level
                          named node (Spawn_*, Cover_*, Door_*, …). Lets scripts/AI target sub-parts
                          by name and attach behaviors.
                        </p>
                      </>
                    );
                  })()}
                </div>
              )
            )}
          </Section>
        )}

        <Section title="Player Controller" Icon={User}>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Role</Label>
            <Select
              value={entity.controllerKind ?? "none"}
              onValueChange={(v) => setEntityController(entity.id, v as ControllerKind)}
            >
              <SelectTrigger className="h-7 text-xs" data-testid="select-controller">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (passive object)</SelectItem>
                <SelectItem value="thirdPerson">Player — Third-person</SelectItem>
                <SelectItem value="firstPerson">Player — First-person</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Marks this entity as the player. Camera in Play Mode will follow it
              and WASD will drive it. Use kinematic body type to avoid physics
              fighting the controller.
            </p>
          </div>
        </Section>

        <Section title="Script" Icon={Code2}>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Attached Script</Label>
            <Select
              value={entity.scriptId ? String(entity.scriptId) : "__none"}
              onValueChange={(v) =>
                setEntityScript(entity.id, v === "__none" ? null : Number(v))
              }
            >
              <SelectTrigger className="h-7 text-xs" data-testid="select-script">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {scripts.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    [{s.language.toUpperCase()}] {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scripts.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                No scripts yet. Open the Scripts panel below to create one.
              </p>
            )}
          </div>
        </Section>

        <Separator />
        <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground">id: {selectedId}</div>
      </ScrollArea>
    </div>
  );
}
