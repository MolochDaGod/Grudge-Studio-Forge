import * as React from "react";
import { Canvas } from "@react-three/fiber";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { PlayCameraController } from "@/scene/CameraControllers";
import { EffectsRig } from "@/scene/EffectsRig";
import { PlayScriptRuntime } from "@/scene/PlayScriptRuntime";
import { useEditor } from "./playerStore";
import { PlayerHUD } from "./PlayerHUD";
import { DEFAULT_GRAVITY, DEFAULT_FOG } from "@workspace/scene-schema";

/**
 * Standalone-player scene tree.
 *
 * Mirrors the play-mode JSX path of `Viewport.tsx` (Canvas → fog → Lights →
 * Physics → entities → camera → post-processing) but without any edit-mode
 * chrome (no Grid, no OrbitControls, no TransformControls, no gizmo gates,
 * no Hotbar, no PlayHUD overlays).
 *
 * The gameplay tick — entity spawn/cleanup, script `start`/`update`,
 * nav-agent FSMs, surface ticks, navmesh hydration — runs inside
 * `<PlayScriptRuntime>`, which is the same component the editor's play
 * mode mounts. The only difference is *where* the scripts come from:
 *   - editor: `useListScripts(projectId)` against the API
 *   - player: `useEditor((s) => s.scripts)` populated from `./scripts.json`
 *
 * Performance: `<Physics>` is memoised on `gravity` so re-renders never
 * re-create the world. `bodyRefs` is the shared map the camera controller
 * and the runtime both read.
 */

function Lights(): React.ReactElement {
  const env = useEditor((s) => s.sceneData.environment);
  const ambient = env.ambientIntensity ?? 0.4;
  const sky = env.skyColor ?? "#0a0a14";
  const ground = env.groundColor ?? "#1a1a2e";
  return (
    <>
      <ambientLight intensity={ambient} />
      <hemisphereLight args={[sky, ground, ambient * 0.85]} />
      <directionalLight
        position={[10, 12, 8]}
        intensity={env.sunIntensity ?? 1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
        shadow-camera-near={0.5}
        shadow-camera-far={120}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      {/* Cool fill from the opposite side — non-shadow-casting,
          mirrors the editor Viewport preset for consistent look. */}
      <directionalLight
        position={[-8, 10, -6]}
        intensity={(env.sunIntensity ?? 1.2) * 0.25}
        color="#9eb8ff"
      />
    </>
  );
}

function ScenePlayMode(): React.ReactElement {
  const envGravity = useEditor((s) => s.sceneData.environment.gravity);
  const scripts = useEditor((s) => s.scripts);
  const gravity = useMemo<[number, number, number]>(
    () => (envGravity ?? DEFAULT_GRAVITY) as [number, number, number],
    [envGravity],
  );
  const bodyRefs = useRef<Map<string, RapierRigidBody | THREE.Group>>(
    new Map(),
  );

  return (
    <Physics gravity={gravity}>
      <PlayScriptRuntime bodyRefs={bodyRefs} scripts={scripts} />
      <PlayCameraController bodyRefs={bodyRefs} />
    </Physics>
  );
}

export function PlayerScene(): React.ReactElement {
  const env = useEditor((s) => s.sceneData.environment);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
        shadows="soft"
        camera={{ position: [8, 8, 12], fov: 45 }}
        gl={{
          antialias: true,
          outputColorSpace: THREE.SRGBColorSpace,
          stencil: false,
          powerPreference: "high-performance",
          toneMapping: THREE.NoToneMapping,
        }}
        dpr={[1, 2]}
        style={{ cursor: "none" }}
      >
        <color attach="background" args={[env.skyColor ?? "#0a0a14"]} />
        <fog
          attach="fog"
          args={[
            env.fog?.color ?? env.skyColor ?? "#0a0a14",
            env.fog?.near ?? DEFAULT_FOG.near,
            env.fog?.far ?? DEFAULT_FOG.far,
          ]}
        />
        <Lights />
        <Suspense fallback={null}>
          <ScenePlayMode />
        </Suspense>
        <EffectsRig highQuality={false} />
      </Canvas>
      <PlayerHUD />
    </div>
  );
}
