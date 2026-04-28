/**
 * Map generator dialog. Pick a generator, tweak size/density/seed, and
 * preview the entity count before committing. The generated entities are
 * inserted under a single root parent so the user can move/delete the
 * whole chunk in one click — and the insert is a single undoable command.
 */

import { useState, useMemo } from "react";
import { useEditor } from "@/store/editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { generateMap, type MapKind } from "@/lib/mapGen";
import { addEntitiesCommand } from "@/lib/commands";
import { reidTree } from "@/lib/hierarchy";

export interface MapGenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KIND_LABELS: { value: MapKind; label: string; help: string }[] = [
  { value: "cityGrid", label: "City Grid", help: "Gridded blocks of buildings with street lights." },
  { value: "openArena", label: "Open Arena", help: "Bordered playfield with scattered cover crates." },
  { value: "dungeonRooms", label: "Dungeon Rooms", help: "BSP-style rooms with doorways and torches." },
  { value: "maze", label: "Maze", help: "Recursive-backtracker corridors carved from a grid." },
];

export function MapGenDialog({ open, onOpenChange }: MapGenDialogProps) {
  const [kind, setKind] = useState<MapKind>("cityGrid");
  const [size, setSize] = useState(40);
  const [density, setDensity] = useState(0.6);
  const [seedStr, setSeedStr] = useState("1");

  const seed = useMemo(() => {
    const n = Number(seedStr);
    if (Number.isFinite(n)) return n >>> 0;
    // Hash string to int (DJB2)
    let h = 5381;
    for (let i = 0; i < seedStr.length; i++) h = ((h << 5) + h + seedStr.charCodeAt(i)) >>> 0;
    return h;
  }, [seedStr]);

  // Live preview count (cheap — the generator is fast enough on these sizes)
  const previewCount = useMemo(() => {
    try {
      return generateMap({ kind, size, density, seed }).length;
    } catch {
      return 0;
    }
  }, [kind, size, density, seed]);

  const commandStack = useEditor((s) => s.commandStack);
  const getEntities = () => useEditor.getState().sceneData.entities;
  const setEntities = useEditor((s) => s.setEntities);
  const selectEntity = useEditor((s) => s.selectEntity);
  const pushLog = useEditor((s) => s.pushLog);
  const projectId = useEditor((s) => s.projectId);

  const onGenerate = () => {
    if (!projectId) {
      pushLog("warn", "Open a project first.");
      return;
    }
    const fresh = generateMap({ kind, size, density, seed });
    // Re-id everything we hand to the scene so subsequent generations don't collide.
    const { entities: prepared } = reidTree(fresh, null);
    const rootId = prepared[0]?.id ?? null;
    const cmd = addEntitiesCommand(
      { getEntities, setEntities, selectEntity },
      prepared,
      `Generate ${KIND_LABELS.find((k) => k.value === kind)!.label} (${prepared.length} entities)`,
      rootId,
    );
    commandStack.push(cmd);
    pushLog("info", `Generated ${prepared.length} entities. Undo (Ctrl+Z) reverses the whole map.`);
    onOpenChange(false);
  };

  const helpText = KIND_LABELS.find((k) => k.value === kind)?.help ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-[0.18em] text-accent">
            Generate Map
          </DialogTitle>
          <DialogDescription className="font-lore italic">
            Procedurally seed a chunk of geometry. Same seed → same map. The
            entire generated set lives under a single parent so you can move,
            delete, or undo it as one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-heading uppercase tracking-[0.16em] text-muted-foreground">
              Map type
            </Label>
            <Select value={kind} onValueChange={(v) => setKind(v as MapKind)}>
              <SelectTrigger data-testid="select-map-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_LABELS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{helpText}</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs font-heading uppercase tracking-[0.16em] text-muted-foreground">
                Size
              </Label>
              <span className="text-[11px] font-mono text-muted-foreground">
                {size} units
              </span>
            </div>
            <Slider
              value={[size]}
              onValueChange={([v]) => setSize(v)}
              min={12}
              max={120}
              step={4}
              data-testid="slider-map-size"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs font-heading uppercase tracking-[0.16em] text-muted-foreground">
                Density
              </Label>
              <span className="text-[11px] font-mono text-muted-foreground">
                {Math.round(density * 100)}%
              </span>
            </div>
            <Slider
              value={[density]}
              onValueChange={([v]) => setDensity(v)}
              min={0}
              max={1}
              step={0.05}
              data-testid="slider-map-density"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-heading uppercase tracking-[0.16em] text-muted-foreground">
              Seed
            </Label>
            <div className="flex gap-2">
              <Input
                value={seedStr}
                onChange={(e) => setSeedStr(e.target.value)}
                className="font-mono"
                data-testid="input-map-seed"
              />
              <Button
                variant="outline"
                onClick={() => setSeedStr(String(Math.floor(Math.random() * 1e9)))}
                title="Random seed"
              >
                Roll
              </Button>
            </div>
          </div>

          <div className="rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground font-mono">
            Preview: <span className="text-foreground">{previewCount}</span> entities will be added.
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onGenerate}
            className="bg-primary text-primary-foreground hover:bg-primary/90 hover-gold-glow"
            data-testid="button-generate-map"
          >
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
