import { Canvas, useLoader } from "@react-three/fiber";
import { Grid, OrbitControls, Center, Bounds, Stats } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DevtoolsBridge } from "@/scene/DevtoolsBridge";
import { extendGltfLoader } from "@/lib/gltfLoaderConfig";
import type { ModelTabPayload } from "@/store/viewportTabs";
import { Loader2, FileBox, AlertTriangle, RotateCw } from "lucide-react";

/**
 * Stand-alone 3D model viewer for a single .glb/.gltf file.
 *
 * Mounting model: only the **active** model tab has a live Canvas + WebGL
 * context (see `ViewportHost`). When the user switches away the surface
 * unmounts, R3F disposes the renderer, and we explicitly dispose every
 * geometry / material / texture the GLTF created and clear the loader
 * cache for this URL — otherwise opening 30 model tabs in a row would
 * pin tens of MB of GPU memory per session.
 *
 * For non-glTF formats (.obj, .fbx, .zip, …) we delegate to the
 * `@/lib/converters` module on first paint, transcode to a temporary GLB
 * blob URL in-browser, then feed it through the same path. Any errors
 * surface as a contained banner inside the tab — they never propagate to
 * the editor shell.
 */

interface ModelSurfaceProps {
  payload: ModelTabPayload;
}

interface PreparedModel {
  url: string;
  /** True if we created the URL ourselves (transcode result) and must
   *  revoke it when the component unmounts. */
  ownsUrl: boolean;
  /** True for placeholder URLs that aren't actually GLBs. */
  placeholder?: boolean;
}

/** Resolve the payload to a glTF-loadable URL. For native glTF we just
 *  return the existing URL. For OBJ we transcode in-browser. For other
 *  formats we surface a "format not yet supported" placeholder. */
function usePreparedModel(payload: ModelTabPayload): {
  state: "loading" | "ready" | "error";
  data?: PreparedModel;
  error?: string;
} {
  const [state, setState] = useState<{
    state: "loading" | "ready" | "error";
    data?: PreparedModel;
    error?: string;
  }>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    let owned: string | null = null;

    async function run() {
      try {
        const sourceUrl = payload.blobUrl ?? payload.assetUrl;
        if (!sourceUrl) {
          throw new Error("Tab has neither blobUrl nor assetUrl.");
        }

        const ext = payload.ext.toLowerCase();
        if (ext === "glb" || ext === "gltf") {
          if (!cancelled) {
            setState({
              state: "ready",
              data: { url: sourceUrl, ownsUrl: false },
            });
          }
          return;
        }

        if (ext === "obj") {
          // Lazy-load the converter so heavy three.js loaders don't enter
          // the bundle for users who never open a model tab.
          const [{ objToGlb }, text] = await Promise.all([
            import("@/lib/converters"),
            fetch(sourceUrl).then((r) => r.text()),
          ]);
          const file = await objToGlb(text, payload.name);
          const url = URL.createObjectURL(file);
          owned = url;
          if (!cancelled) {
            setState({
              state: "ready",
              data: { url, ownsUrl: true },
            });
          }
          return;
        }

        // .fbx, .zip, .asset, .prefab — we can OPEN the tab and present a
        // friendly "transcode pending" placeholder, but we don't try to
        // crash the viewer trying to load them as glTF.
        if (!cancelled) {
          setState({
            state: "ready",
            data: { url: "", ownsUrl: false, placeholder: true },
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            state: "error",
            error: (err as Error).message ?? String(err),
          });
        }
      }
    }

    run();
    return () => {
      cancelled = true;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [payload]);

  return state;
}

function disposeGltfGraph(scene: THREE.Object3D) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      // Dispose every texture the material references. We iterate every
      // own property because three's material classes expose textures on
      // varying named slots (`map`, `normalMap`, `metalnessMap`, …).
      for (const key of Object.keys(m) as (keyof THREE.Material)[]) {
        // reason: same as EntityRenderer — material slot names vary by
        // subtype; iterate own keys and runtime-check Texture identity.
        const val = (m as unknown as Record<string, unknown>)[key as string];
        if (val && (val as THREE.Texture).isTexture) {
          (val as THREE.Texture).dispose();
        }
      }
      m.dispose();
    }
  });
}

function GltfModel({ url }: { url: string }) {
  // useLoader caches per URL, but a fresh blob URL per tab guarantees
  // the cache key is unique (no risk of two tabs sharing a graph).
  const gltf = useLoader(GLTFLoader, url, extendGltfLoader);
  const root = useRef<THREE.Group>(null!);

  // Apply a sensible default: enable shadow casting so the user can SEE
  // their model with depth, even with otherwise-flat materials.
  useEffect(() => {
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [gltf]);

  // Tear-down: dispose every GPU resource the GLTF created and evict the
  // useLoader cache entry so the next open doesn't hand back a graph
  // whose textures we just released.
  useEffect(() => {
    return () => {
      try {
        disposeGltfGraph(gltf.scene);
      } catch {
        /* ignore — best-effort cleanup */
      }
      try {
        useLoader.clear(GLTFLoader, url);
      } catch {
        /* older drei/r3f versions may not expose this; harmless if absent */
      }
    };
  }, [gltf, url]);

  return (
    <Bounds fit clip observe margin={1.2}>
      <Center>
        <primitive ref={root} object={gltf.scene} />
      </Center>
    </Bounds>
  );
}

function ViewerLights() {
  return (
    <>
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
      {/* Cool rim fill — gives loaded models edge definition. */}
      <directionalLight position={[-6, 8, -4]} intensity={0.35} color="#9eb8ff" />
      <hemisphereLight args={["#dcd4ff", "#1a1325", 0.4]} />
    </>
  );
}

export function ModelSurface({ payload }: ModelSurfaceProps) {
  const prep = usePreparedModel(payload);
  const [epoch, setEpoch] = useState(0);

  const sizeKb = useMemo(
    () => (payload.size ? Math.max(1, Math.round(payload.size / 1024)) : null),
    [payload.size],
  );

  return (
    <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
      <div className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md bg-card/80 backdrop-blur border border-card-border text-xs font-mono text-muted-foreground pointer-events-none flex items-center gap-2">
        <FileBox className="size-3.5 text-accent" />
        <span className="text-foreground">{payload.name}</span>
        <span className="opacity-60">·</span>
        <span className="uppercase">{payload.ext}</span>
        {sizeKb && (
          <>
            <span className="opacity-60">·</span>
            <span>{sizeKb.toLocaleString()} KB</span>
          </>
        )}
      </div>

      {prep.state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-muted-foreground">
          <Loader2 className="size-4 mr-2 animate-spin" />
          Preparing {payload.ext.toUpperCase()}…
        </div>
      )}

      {prep.state === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-3 p-6 rounded-md bg-card/90 border border-card-border shadow-lg">
            <div className="flex justify-center">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <h3 className="text-base font-semibold text-destructive">
              Could not open {payload.name}
            </h3>
            <p className="text-xs text-muted-foreground font-mono break-words">
              {prep.error}
            </p>
            <button
              type="button"
              onClick={() => setEpoch((n) => n + 1)}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-accent-foreground hover:opacity-90 inline-flex items-center gap-1.5"
              data-testid="button-model-retry"
            >
              <RotateCw className="size-3" /> Retry
            </button>
          </div>
        </div>
      )}

      {prep.state === "ready" && prep.data?.placeholder && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-3 p-6 rounded-md bg-card/90 border border-card-border shadow-lg">
            <FileBox className="size-6 mx-auto text-accent" />
            <h3 className="text-base font-semibold">Tab opened in isolation</h3>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono uppercase">.{payload.ext}</span> is
              recognised but not yet renderable in the live viewer. Use the
              Convert tab to transcode it to GLB, or drop a .glb / .gltf /
              .obj for instant preview.
            </p>
          </div>
        </div>
      )}

      {prep.state === "ready" && !prep.data?.placeholder && prep.data && (
        <Canvas
          key={`${prep.data.url}-${epoch}`}
          shadows
          camera={{ position: [4, 3, 6], fov: 45 }}
          gl={{
            antialias: true,
            powerPreference: "high-performance",
            toneMapping: THREE.ACESFilmicToneMapping,
            outputColorSpace: THREE.SRGBColorSpace,
            stencil: false,
          }}
          dpr={[1, 2]}
        >
          <DevtoolsBridge label={`Forge · Model: ${payload.name}`} />
          <color attach="background" args={["#0a0a14"]} />
          <ViewerLights />
          <Suspense fallback={null}>
            <GltfModel url={prep.data.url} />
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
          <Stats className="!left-auto !right-3 !top-3" />
        </Canvas>
      )}
    </div>
  );
}
