import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, type GlbInfo } from "@/lib/glbInspect";
import { Box, FileBox, Plus, Layers, Image as ImageIcon, Music2, Bone, Film } from "lucide-react";

export interface InspectorPayload {
  fileName: string;
  fileSize: number;
  /** undefined for `.gltf` (JSON-only) — we still show the file metadata. */
  glb?: GlbInfo;
  /** Storage URL the asset can be loaded from. */
  modelUrl: string;
  /** Project-asset id of the saved record. */
  assetId?: number;
}

interface Props {
  payload: InspectorPayload | null;
  onClose: () => void;
  onAddToScene: (p: InspectorPayload) => void;
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Box;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border">
      <Icon className="size-3.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">
          {label}
        </div>
        <div className="font-mono text-sm leading-tight">{value}</div>
      </div>
    </div>
  );
}

export function GlbInspectorDialog({ payload, onClose, onAddToScene }: Props) {
  const open = !!payload;
  const p = payload;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl flex items-center gap-2">
            <FileBox className="size-5 text-primary" />
            <span className="brand-gold">Binary Inspector</span>
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {p?.fileName} · {p ? formatBytes(p.fileSize) : ""}
          </DialogDescription>
        </DialogHeader>

        {p && (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              {/* GLB header — shown only for true binary GLB */}
              {p.glb ? (
                <section>
                  <h3 className="font-heading text-sm uppercase tracking-wider text-muted-foreground mb-2">
                    GLB Container
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat icon={Box} label="Magic" value={`"${p.glb.magic}"`} />
                    <Stat icon={Box} label="Version" value={p.glb.version} />
                    <Stat icon={Box} label="Total" value={formatBytes(p.glb.totalLength)} />
                    <Stat icon={Box} label="JSON Chunk" value={formatBytes(p.glb.json.size)} />
                    <Stat
                      icon={Box}
                      label="BIN Chunk"
                      value={p.glb.bin ? formatBytes(p.glb.bin.size) : "—"}
                    />
                    <Stat
                      icon={Box}
                      label="Generator"
                      value={p.glb.json.asset?.generator?.slice(0, 14) ?? "—"}
                    />
                  </div>
                  <div className="mt-2 px-2.5 py-1.5 rounded-md bg-background/60 border border-border">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                      Header bytes (first 16)
                    </div>
                    <code className="font-mono text-[11px] text-primary/90">
                      {p.glb.headerHex}
                    </code>
                  </div>
                </section>
              ) : (
                <section className="px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground">
                  This is a <span className="font-mono text-foreground">.gltf</span> JSON file
                  (not a binary GLB), so there's no chunk container to decode. The model will
                  still load and render normally.
                </section>
              )}

              {/* Decoded counts */}
              {p.glb && (
                <section>
                  <h3 className="font-heading text-sm uppercase tracking-wider text-muted-foreground mb-2">
                    Scene Contents
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat icon={Layers} label="Scenes" value={p.glb.json.counts.scenes} />
                    <Stat icon={Box} label="Nodes" value={p.glb.json.counts.nodes} />
                    <Stat icon={Box} label="Meshes" value={p.glb.json.counts.meshes} />
                    <Stat icon={Box} label="Primitives" value={p.glb.json.counts.primitives} />
                    <Stat icon={Box} label="Materials" value={p.glb.json.counts.materials} />
                    <Stat icon={ImageIcon} label="Textures" value={p.glb.json.counts.textures} />
                    <Stat icon={ImageIcon} label="Images" value={p.glb.json.counts.images} />
                    <Stat icon={Film} label="Animations" value={p.glb.json.counts.animations} />
                    <Stat icon={Bone} label="Skins" value={p.glb.json.counts.skins} />
                  </div>
                </section>
              )}

              {/* Top-level keys */}
              {p.glb && (
                <section>
                  <h3 className="font-heading text-sm uppercase tracking-wider text-muted-foreground mb-2">
                    Top-level Keys
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {p.glb.json.keys.map((k) => (
                      <Badge
                        key={k}
                        variant="outline"
                        className="font-mono text-[10px] border-primary/40 text-primary"
                      >
                        {k}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {/* Saved confirmation */}
              <section className="px-3 py-2 rounded-md border border-primary/30 bg-primary/5">
                <div className="flex items-center gap-2 text-xs">
                  <Music2 className="size-3.5 text-primary" />
                  <span className="text-foreground">
                    Saved to <span className="font-medium">Project Assets</span>
                  </span>
                  <code className="ml-auto font-mono text-[10px] text-muted-foreground truncate max-w-[280px]">
                    {p.modelUrl}
                  </code>
                </div>
              </section>
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="button-inspector-close">
            Close
          </Button>
          <Button
            onClick={() => p && onAddToScene(p)}
            disabled={!p}
            data-testid="button-inspector-add"
          >
            <Plus className="size-4 mr-1" /> Add to Scene
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
