import { useState } from "react";
import { useEditor } from "@/store/editor";
import {
  LAYERS,
  DEFAULT_SENSOR_LAYERS,
  layersCollide,
  pairKey,
  type LayerName,
} from "@workspace/scene-schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useNavmeshDebug } from "@/scene/NavmeshDebugOverlay";
import { bakeSceneNavmesh } from "@/lib/navmeshBake";

/**
 * Unity-style "Edit > Project Settings > Tags & Layers > Collision Matrix"
 * panel. Each cell toggles a single ordered pair in
 * `Environment.collisionMatrix`. Pairs default to `true` (everything
 * collides with everything) so the matrix only stores explicit overrides.
 *
 * The sensor strip below the matrix toggles
 * `Environment.sensorLayers` — entities on those layers spawn as Rapier
 * sensors (intersection events fire, no contact response).
 */
export function LayersPanel() {
  const env = useEditor((s) => s.sceneData.environment);
  const cmdSetEnv = useEditor((s) => s.cmdSetEnvironment);
  const matrix = env.collisionMatrix;
  const sensors = env.sensorLayers ?? DEFAULT_SENSOR_LAYERS;
  const navmeshAssetId = env.navmeshAssetId;
  const showNavmesh = useNavmeshDebug((s) => s.show);
  const setShowNavmesh = useNavmeshDebug((s) => s.setShow);
  const [baking, setBaking] = useState(false);
  const [bakeMessage, setBakeMessage] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
  const taggedCount = useEditor(
    (s) =>
      s.sceneData.entities.filter((e) => e.surface && e.surface !== "None")
        .length,
  );

  const onBake = async () => {
    setBaking(true);
    setBakeMessage({ kind: "info", text: "Baking navmesh…" });
    try {
      const result = await bakeSceneNavmesh();
      setBakeMessage({
        kind: "info",
        text: `Baked ${result.stats.polyCount} polys (${(
          result.stats.bytes / 1024
        ).toFixed(1)} KB) in ${result.stats.durationMs}ms${
          result.cached ? " — server cache hit" : ""
        }.`,
      });
    } catch (err) {
      setBakeMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBaking(false);
    }
  };

  const togglePair = (a: LayerName, b: LayerName) => {
    const key = pairKey(a, b);
    const cur = layersCollide(matrix, a, b);
    cmdSetEnv(
      { collisionMatrix: { ...(matrix ?? {}), [key]: !cur } },
      `${cur ? "Disable" : "Enable"} ${a}↔${b} collision`,
    );
  };

  const toggleSensor = (layer: LayerName) => {
    const next = sensors.includes(layer)
      ? sensors.filter((l) => l !== layer)
      : [...sensors, layer];
    cmdSetEnv(
      { sensorLayers: next },
      `${sensors.includes(layer) ? "Unmark" : "Mark"} ${layer} as sensor`,
    );
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Collision Matrix
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            Untick a cell to make those two layers pass through each other.
            Diagonal cells control self-collision (e.g. Projectile vs
            Projectile).
          </p>
          <div className="inline-block border border-border rounded">
            <table className="text-[10px] font-mono">
              <thead>
                <tr>
                  <th className="p-1.5"></th>
                  {LAYERS.map((l) => (
                    <th
                      key={l}
                      className="p-1.5 align-bottom"
                      style={{ writingMode: "vertical-rl", height: 80 }}
                    >
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LAYERS.map((row, i) => (
                  <tr key={row} className="border-t border-border">
                    <th className="p-1.5 text-right whitespace-nowrap">{row}</th>
                    {LAYERS.map((col, j) => {
                      // Render a half-matrix: only cells where j >= i are
                      // interactive (the matrix is symmetric, no need to
                      // toggle the same pair twice).
                      if (j < i) {
                        return <td key={col} className="p-1.5 bg-muted/30" />;
                      }
                      const collide = layersCollide(matrix, row, col);
                      return (
                        <td key={col} className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={collide}
                            onChange={() => togglePair(row, col)}
                            className="size-3 cursor-pointer"
                            aria-label={`${row} vs ${col}`}
                            data-testid={`layer-pair-${row}-${col}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-3 text-xs"
            onClick={() => cmdSetEnv({ collisionMatrix: {} }, "Reset collision matrix")}
          >
            Reset to defaults
          </Button>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Sensor Layers
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            Entities on a sensor layer fire intersection events but produce
            no physical contact (use for trigger volumes, water, score zones).
          </p>
          <div className="grid grid-cols-2 gap-2">
            {LAYERS.map((l) => (
              <div
                key={l}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border"
              >
                <Label htmlFor={`sensor-${l}`} className="text-xs cursor-pointer">
                  {l}
                </Label>
                <Switch
                  id={`sensor-${l}`}
                  checked={sensors.includes(l)}
                  onCheckedChange={() => toggleSensor(l)}
                  data-testid={`layer-sensor-${l}`}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Navmesh
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            {navmeshAssetId === undefined
              ? "No navmesh baked yet — tag walkable meshes with a Surface in the Inspector, then click Bake."
              : `Baked navmesh asset #${navmeshAssetId}. Toggle to show the polygons in the viewport.`}
          </p>
          <div className="flex items-center justify-between gap-2 mb-2">
            <Button
              size="sm"
              onClick={onBake}
              disabled={baking || taggedCount === 0}
              data-testid="bake-navmesh"
            >
              {baking
                ? "Baking…"
                : navmeshAssetId === undefined
                  ? `Bake NavMesh (${taggedCount} tagged)`
                  : `Re-bake (${taggedCount} tagged)`}
            </Button>
            {bakeMessage && (
              <span
                className={`text-[11px] ${
                  bakeMessage.kind === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
                data-testid="bake-navmesh-status"
              >
                {bakeMessage.text}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border">
            <Label
              htmlFor="show-navmesh"
              className="text-xs cursor-pointer"
            >
              Show navmesh
            </Label>
            <Switch
              id="show-navmesh"
              checked={showNavmesh}
              disabled={navmeshAssetId === undefined}
              onCheckedChange={(v) => setShowNavmesh(!!v)}
              data-testid="toggle-show-navmesh"
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
