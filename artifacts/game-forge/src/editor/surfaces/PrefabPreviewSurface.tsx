import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, Center, Bounds } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { EntityRenderer } from "@/scene/EntityRenderer";
import { DevtoolsBridge } from "@/scene/DevtoolsBridge";
import { buildTree } from "@/lib/hierarchy";
import { useGetPrefab } from "@workspace/api-client-react";
import type { SceneEntity } from "@/scene/types";
import type { PrefabPayload } from "@/scene/prefabPayload";
import type { PrefabTabPayload } from "@/store/viewportTabs";
import { Loader2, AlertTriangle, Package } from "lucide-react";

/**
 * Read-only preview of a prefab in its own isolated Canvas.
 *
 * Lets users keep multiple prefabs open at once (one per tab) without
 * interfering with the main scene. Editing a prefab still happens through
 * the existing sub-scene flow on the Scene tab — this surface is the
 * "look at it without opening it" affordance the user can flip back and
 * forth between.
 */

function RenderNode({
  entity,
  byParent,
}: {
  entity: SceneEntity;
  byParent: Map<string | null, SceneEntity[]>;
}) {
  const kids = byParent.get(entity.id) ?? [];
  return (
    <EntityRenderer entity={entity} selected={false} onPick={() => {}} playMode={false}>
      {kids.map((c) => (
        <RenderNode key={c.id} entity={c} byParent={byParent} />
      ))}
    </EntityRenderer>
  );
}

export function PrefabPreviewSurface({ payload }: { payload: PrefabTabPayload }) {
  const { data: prefab, isLoading, error } = useGetPrefab(payload.prefabId);

  const entities = useMemo<SceneEntity[]>(() => {
    if (!prefab) return [];
    const data = prefab.data as PrefabPayload;
    return Array.isArray(data?.entities) ? data.entities : [];
  }, [prefab]);

  const byParent = useMemo(() => buildTree(entities), [entities]);
  const roots = byParent.get(null) ?? [];

  return (
    <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
      <div className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md bg-card/80 backdrop-blur border border-card-border text-xs font-mono text-muted-foreground pointer-events-none flex items-center gap-2">
        <Package className="size-3.5 text-accent" />
        <span className="text-foreground">{payload.prefabName}</span>
        <span className="opacity-60">·</span>
        <span>preview</span>
        {entities.length > 0 && (
          <>
            <span className="opacity-60">·</span>
            <span>{entities.length} entities</span>
          </>
        )}
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-muted-foreground">
          <Loader2 className="size-4 mr-2 animate-spin" />
          Loading prefab…
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-3 p-6 rounded-md bg-card/90 border border-card-border shadow-lg">
            <AlertTriangle className="size-6 mx-auto text-destructive" />
            <h3 className="text-base font-semibold text-destructive">
              Could not load prefab
            </h3>
            <p className="text-xs text-muted-foreground font-mono break-words">
              {(error as Error).message}
            </p>
          </div>
        </div>
      )}

      {prefab && (
        <Canvas
          shadows="soft"
          camera={{ position: [4, 3, 6], fov: 45 }}
          gl={{
            antialias: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            outputColorSpace: THREE.SRGBColorSpace,
            stencil: false,
          }}
          dpr={[1, 2]}
        >
          <DevtoolsBridge label={`Forge · Prefab: ${payload.prefabName}`} />
          <color attach="background" args={["#0a0a14"]} />
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[6, 10, 4]}
            intensity={1.4}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.0005}
            shadow-normalBias={0.04}
            shadow-camera-near={0.5}
            shadow-camera-far={40}
            shadow-camera-left={-15}
            shadow-camera-right={15}
            shadow-camera-top={15}
            shadow-camera-bottom={-15}
          />
          <directionalLight position={[-6, 8, -4]} intensity={0.35} color="#9eb8ff" />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.4}>
              <Center>
                <group>
                  {roots.map((e) => (
                    <RenderNode key={e.id} entity={e} byParent={byParent} />
                  ))}
                </group>
              </Center>
            </Bounds>
          </Suspense>
          <Grid
            args={[20, 20]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor="#2a2a3e"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#d4af37"
            fadeDistance={30}
            fadeStrength={1.4}
            infiniteGrid
            position={[0, -0.02, 0]}
          />
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
      )}
    </div>
  );
}
