import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls, Stats } from "@react-three/drei";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useListScripts, getListScriptsQueryKey, type Script } from "@workspace/api-client-react";
import { EntityRenderer } from "@/scene/EntityRenderer";
import { getCompiledScript, makeContext } from "@/scene/PlayRuntime";
import type { ScriptEntity } from "@/scene/csTranspile";
import { useKeyboardState } from "@/lib/keyboard";

function SceneEditMode() {
  const sceneData = useEditor((s) => s.sceneData);
  const selectedId = useEditor((s) => s.selectedId);
  const selectEntity = useEditor((s) => s.selectEntity);
  const setEntityTransform = useEditor((s) => s.setEntityTransform);
  const transformMode = useEditor((s) => s.transformMode);

  const groupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const selectedRef = selectedId ? groupRefs.current.get(selectedId) : undefined;

  return (
    <>
      {sceneData.entities.map((entity) => (
        <group
          key={entity.id}
          ref={(el) => {
            if (el) groupRefs.current.set(entity.id, el);
            else groupRefs.current.delete(entity.id);
          }}
        >
          <EntityRenderer
            entity={entity}
            selected={selectedId === entity.id}
            onPick={() => selectEntity(entity.id)}
            playMode={false}
          />
        </group>
      ))}
      {selectedRef && (
        <TransformControls
          object={selectedRef}
          mode={transformMode}
          onObjectChange={() => {
            if (!selectedId || !selectedRef) return;
            const o = selectedRef;
            if (transformMode === "translate") {
              setEntityTransform(selectedId, "position", [o.position.x, o.position.y, o.position.z]);
            } else if (transformMode === "rotate") {
              setEntityTransform(selectedId, "rotation", [o.rotation.x, o.rotation.y, o.rotation.z]);
            } else {
              setEntityTransform(selectedId, "scale", [o.scale.x, o.scale.y, o.scale.z]);
            }
          }}
        />
      )}
    </>
  );
}

function ScriptedEntities() {
  const sceneData = useEditor((s) => s.sceneData);
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const isPaused = useEditor((s) => s.isPaused);
  const { data: scripts } = useListScripts(projectId ?? 0, {
    query: { queryKey: getListScriptsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const keysRef = useKeyboardState(true);

  const bodyRefs = useRef<Map<string, RapierRigidBody | THREE.Group>>(new Map());
  const startedRef = useRef<Set<string>>(new Set());
  const elapsedRef = useRef(0);

  const scriptMap = useMemo(() => {
    const m = new Map<number, Script>();
    (scripts ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [scripts]);

  useFrame((_state, delta) => {
    if (isPaused) return;
    elapsedRef.current += delta;
    for (const entity of sceneData.entities) {
      if (!entity.scriptId) continue;
      const script = scriptMap.get(entity.scriptId);
      if (!script) continue;
      const compiled = getCompiledScript(script);
      if (compiled.error) continue;

      const bodyOrGroup = bodyRefs.current.get(entity.id);
      const scriptEntity: ScriptEntity = {
        id: entity.id,
        name: entity.name,
        position: [...entity.transform.position] as [number, number, number],
        rotation: [...entity.transform.rotation] as [number, number, number],
        scale: [...entity.transform.scale] as [number, number, number],
      };

      // Pull current transform from the live rigid body / group if available
      if (bodyOrGroup) {
        if ("translation" in bodyOrGroup) {
          const t = bodyOrGroup.translation();
          const r = bodyOrGroup.rotation();
          scriptEntity.position = [t.x, t.y, t.z];
          // approximate quaternion -> euler isn't worth the complexity in the script context; we leave rotation as scene-time
          void r;
        } else {
          scriptEntity.position = [bodyOrGroup.position.x, bodyOrGroup.position.y, bodyOrGroup.position.z];
          scriptEntity.rotation = [bodyOrGroup.rotation.x, bodyOrGroup.rotation.y, bodyOrGroup.rotation.z];
        }
      }

      const ctx = makeContext({
        delta,
        elapsed: elapsedRef.current,
        keys: keysRef.current,
        log: (level, text) => pushLog(level, `[${entity.name}] ${text}`),
        findEntity: (name) => {
          const found = sceneData.entities.find((e) => e.name === name);
          if (!found) return undefined;
          return {
            id: found.id,
            name: found.name,
            position: [...found.transform.position] as [number, number, number],
            rotation: [...found.transform.rotation] as [number, number, number],
            scale: [...found.transform.scale] as [number, number, number],
          };
        },
      });

      try {
        if (!startedRef.current.has(entity.id) && compiled.start) {
          compiled.start(scriptEntity, ctx);
          startedRef.current.add(entity.id);
        }
        if (compiled.update) {
          compiled.update(scriptEntity, ctx);
        }
      } catch (err) {
        pushLog("error", `[${entity.name}] ${(err as Error).message}`);
        continue;
      }

      // Apply mutations back to the rigid body / group
      if (bodyOrGroup) {
        if ("setNextKinematicTranslation" in bodyOrGroup) {
          const body = bodyOrGroup;
          body.setNextKinematicTranslation({
            x: scriptEntity.position[0],
            y: scriptEntity.position[1],
            z: scriptEntity.position[2],
          });
        } else {
          bodyOrGroup.position.set(...scriptEntity.position);
          bodyOrGroup.rotation.set(...scriptEntity.rotation);
        }
      }
    }
  });

  return (
    <>
      {sceneData.entities.map((entity) => (
        <EntityRenderer
          key={entity.id}
          entity={entity}
          ref={(el) => {
            if (el) bodyRefs.current.set(entity.id, el as RapierRigidBody | THREE.Group);
            else bodyRefs.current.delete(entity.id);
          }}
          playMode
        />
      ))}
    </>
  );
}

function ScenePlayMode() {
  const env = useEditor((s) => s.sceneData.environment);
  const gravity = (env.gravity ?? [0, -9.81, 0]) as [number, number, number];

  return (
    <Physics gravity={gravity}>
      <ScriptedEntities />
    </Physics>
  );
}

function Lights() {
  const env = useEditor((s) => s.sceneData.environment);
  return (
    <>
      <ambientLight intensity={env.ambientIntensity ?? 0.4} />
      <directionalLight
        position={[10, 12, 8]}
        intensity={env.sunIntensity ?? 1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
    </>
  );
}

function ClickToDeselect() {
  const selectEntity = useEditor((s) => s.selectEntity);
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Only clear if click didn't hit a mesh (handled via stopPropagation in EntityRenderer)
      // We attach this to the canvas itself; meshes call stopPropagation.
    };
    el.addEventListener("pointerdown", handler);
    return () => el.removeEventListener("pointerdown", handler);
  }, [gl]);
  return null;
}

export function Viewport() {
  const env = useEditor((s) => s.sceneData.environment);
  const isPlaying = useEditor((s) => s.isPlaying);
  const selectEntity = useEditor((s) => s.selectEntity);

  return (
    <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
      <Canvas
        shadows
        camera={{ position: [8, 8, 12], fov: 45 }}
        onPointerMissed={() => selectEntity(null)}
      >
        <color attach="background" args={[env.skyColor ?? "#0a0a14"]} />
        <fog attach="fog" args={[env.skyColor ?? "#0a0a14", 30, 80]} />
        <Lights />
        <Suspense fallback={null}>
          {isPlaying ? <ScenePlayMode /> : <SceneEditMode />}
        </Suspense>
        {!isPlaying && (
          <Grid
            args={[40, 40]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#2a2a3e"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#9b6dff"
            fadeDistance={40}
            fadeStrength={1.4}
            infiniteGrid
            position={[0, -0.001, 0]}
          />
        )}
        <OrbitControls makeDefault />
        <ClickToDeselect />
        <Stats className="!left-auto !right-3 !top-3" />
      </Canvas>

      <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-card/80 backdrop-blur border border-card-border text-xs font-mono text-muted-foreground pointer-events-none">
        {isPlaying ? (
          <span className="text-accent">▶ PLAY MODE — physics & scripts running</span>
        ) : (
          <span>Edit Mode — drag the gizmo or click an object</span>
        )}
      </div>
    </div>
  );
}
