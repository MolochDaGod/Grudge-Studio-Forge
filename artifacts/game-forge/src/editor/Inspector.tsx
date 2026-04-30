import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { useEditor } from "@/store/editor";
import { useListScripts, getListScriptsQueryKey } from "@workspace/api-client-react";
import type { Vec3, CameraMode, ControllerKind } from "@/scene/types";
import { Box, FlaskConical, Lightbulb, Palette, Settings2, Code2, User, Camera } from "lucide-react";

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

export function Inspector() {
  const projectId = useEditor((s) => s.projectId);
  const selectedId = useEditor((s) => s.selectedId);
  const entity = useEditor((s) =>
    s.selectedId ? s.sceneData.entities.find((e) => e.id === s.selectedId) ?? null : null,
  );
  const env = useEditor((s) => s.sceneData.environment);
  const setEnv = useEditor((s) => s.setEnvironment);
  const updateEntity = useEditor((s) => s.updateEntity);
  const setEntityTransform = useEditor((s) => s.setEntityTransform);
  const renameEntity = useEditor((s) => s.renameEntity);
  const setEntityScript = useEditor((s) => s.setEntityScript);
  const setEntityController = useEditor((s) => s.setEntityController);
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
              value={(env.gravity ?? [0, -9.81, 0]) as Vec3}
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
