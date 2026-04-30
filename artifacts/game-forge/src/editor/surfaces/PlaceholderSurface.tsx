import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, Center } from "@react-three/drei";
import { Suspense, useEffect, useState } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { Bone, Film, Wand2, FileBox } from "lucide-react";
import { DevtoolsBridge } from "@/scene/DevtoolsBridge";
import type {
  RiggingTabPayload,
  AnimationTabPayload,
  ConvertTabPayload,
  ModelTabPayload,
} from "@/store/viewportTabs";

/**
 * Lightweight surface used by tab kinds whose full editor is not yet
 * implemented (rigging / animation / batch convert). The infrastructure
 * — independent Canvas, devtools bridge, isolated WebGL context — is
 * already real, so the user can verify "yes, this opens the file in its
 * own surface" today and the editor team fills in domain-specific UI
 * incrementally without re-plumbing tabs.
 */

function ModelPreview({ source }: { source: ModelTabPayload }) {
  const url = source.blobUrl ?? source.assetUrl;
  const ext = source.ext.toLowerCase();
  const renderable = !!url && (ext === "glb" || ext === "gltf");
  if (!renderable) {
    return (
      <Center>
        <mesh castShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#d4af37" metalness={0.3} roughness={0.4} />
        </mesh>
      </Center>
    );
  }
  return <ModelGltf url={url!} />;
}

function ModelGltf({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url);
  useEffect(() => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }, [gltf]);
  return (
    <Center>
      <primitive object={gltf.scene} />
    </Center>
  );
}

function PlaceholderCanvas({
  label,
  source,
}: {
  label: string;
  source?: ModelTabPayload;
}) {
  return (
    <Canvas
      shadows
      camera={{ position: [4, 3, 6], fov: 45 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      dpr={[1, 2]}
    >
      <DevtoolsBridge label={label} />
      <color attach="background" args={["#0a0a14"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[6, 10, 4]} intensity={1.4} castShadow />
      <Suspense fallback={null}>
        {source ? <ModelPreview source={source} /> : (
          <Center>
            <mesh>
              <torusKnotGeometry args={[1, 0.3, 96, 16]} />
              <meshStandardMaterial color="#d4af37" metalness={0.4} roughness={0.3} />
            </mesh>
          </Center>
        )}
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
        position={[0, -0.001, 0]}
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}

function Banner({
  Icon,
  title,
  body,
}: {
  Icon: typeof Bone;
  title: string;
  body: string;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="absolute top-3 right-3 z-10 max-w-xs p-3 rounded-md bg-card/90 backdrop-blur border border-card-border shadow-lg">
      <div className="flex items-start gap-2">
        <Icon className="size-4 text-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">{title}</div>
          <p className="text-[11px] text-muted-foreground leading-snug mt-1">
            {body}
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function RiggingSurface({ payload }: { payload: RiggingTabPayload }) {
  return (
    <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
      <PlaceholderCanvas
        label={`Forge · Rig: ${payload.source.name}`}
        source={payload.source}
      />
      <Banner
        Icon={Bone}
        title="Rigging surface"
        body={`Editing rig for ${payload.source.name} in an isolated viewport. Bone-tools UI is on the roadmap; the model is loaded fresh and won't affect any other tab.`}
      />
    </div>
  );
}

export function AnimationSurface({ payload }: { payload: AnimationTabPayload }) {
  return (
    <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
      <PlaceholderCanvas
        label={`Forge · Anim: ${payload.source.name}`}
        source={payload.source}
      />
      <Banner
        Icon={Film}
        title="Animation surface"
        body={`Authoring clips for ${payload.source.name}. Timeline and keyframe tools are on the roadmap; the rig is sandboxed in its own context.`}
      />
    </div>
  );
}

export function ConvertSurface({ payload }: { payload: ConvertTabPayload }) {
  return (
    <div className="relative w-full h-full bg-background grid-pattern overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Wand2 className="size-5 text-accent" />
          <h2 className="text-lg font-semibold">Batch convert to GLB</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Files queued in this tab will be transcoded in-browser and become
          available in the asset library. This surface is isolated — closing
          it discards anything not yet uploaded.
        </p>
        {payload.files.length === 0 ? (
          <div className="p-6 rounded-md bg-card/60 border border-card-border border-dashed text-center text-xs text-muted-foreground">
            Drop .obj / .fbx / .zip / .asset / .prefab files anywhere in the
            editor — opening from a file picker also queues them here.
          </div>
        ) : (
          <ul className="space-y-2">
            {payload.files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-3 p-2 rounded-md bg-card/60 border border-card-border"
              >
                <FileBox className="size-4 text-accent" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">{f.name}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {f.ext} · {Math.max(1, Math.round(f.size / 1024)).toLocaleString()} KB
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground">queued</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
