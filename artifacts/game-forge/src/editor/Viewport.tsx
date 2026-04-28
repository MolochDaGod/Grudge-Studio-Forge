import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useListScripts, getListScriptsQueryKey, type Script } from "@workspace/api-client-react";
import { EntityRenderer } from "@/scene/EntityRenderer";
import { getCompiledScript, makeContext } from "@/scene/PlayRuntime";
import type { ScriptEntity } from "@/scene/csTranspile";
import { useKeyboardState } from "@/lib/keyboard";
import { PlayCameraController } from "@/scene/CameraControllers";
import { buildTree } from "@/lib/hierarchy";
import type { SceneEntity } from "@/scene/types";

interface RenderNodeProps {
  entity: SceneEntity;
  childrenByParent: Map<string | null, SceneEntity[]>;
  selectedId: string | null;
  onPick: (id: string) => void;
  groupRefs?: React.MutableRefObject<Map<string, THREE.Group>>;
  bodyRefs?: React.MutableRefObject<Map<string, RapierRigidBody | THREE.Group>>;
  playMode: boolean;
}

/** Renders an entity + recursively all of its children inside its group, so
 *  child transforms compose with the parent's (Unity-style hierarchy). */
function RenderNode({
  entity,
  childrenByParent,
  selectedId,
  onPick,
  groupRefs,
  bodyRefs,
  playMode,
}: RenderNodeProps) {
  const kids = childrenByParent.get(entity.id) ?? [];
  const childNodes = kids.map((c) => (
    <RenderNode
      key={c.id}
      entity={c}
      childrenByParent={childrenByParent}
      selectedId={selectedId}
      onPick={onPick}
      groupRefs={groupRefs}
      bodyRefs={bodyRefs}
      playMode={playMode}
    />
  ));

  if (groupRefs) {
    // Edit mode — wrap in tracking group so TransformControls can grab it.
    return (
      <group
        ref={(el) => {
          if (el) groupRefs.current.set(entity.id, el);
          else groupRefs.current.delete(entity.id);
        }}
      >
        <EntityRenderer
          entity={entity}
          selected={selectedId === entity.id}
          onPick={() => onPick(entity.id)}
          playMode={false}
        >
          {childNodes}
        </EntityRenderer>
      </group>
    );
  }

  // Play mode — attach body/group ref directly on the EntityRenderer.
  return (
    <EntityRenderer
      entity={entity}
      ref={(el) => {
        if (!bodyRefs) return;
        if (el) bodyRefs.current.set(entity.id, el as RapierRigidBody | THREE.Group);
        else bodyRefs.current.delete(entity.id);
      }}
      playMode
    >
      {childNodes}
    </EntityRenderer>
  );
}

function SceneEditMode({ data }: { data?: { entities: SceneEntity[] } }) {
  const liveData = useEditor((s) => s.sceneData);
  const sceneData = data ?? liveData;
  const selectedId = useEditor((s) => s.selectedId);
  const selectEntity = useEditor((s) => s.selectEntity);
  const setEntityTransform = useEditor((s) => s.setEntityTransform);
  const transformMode = useEditor((s) => s.transformMode);

  const groupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const selectedRef = selectedId ? groupRefs.current.get(selectedId) : undefined;

  const childrenByParent = useMemo(() => buildTree(sceneData.entities), [sceneData.entities]);
  const roots = childrenByParent.get(null) ?? [];

  return (
    <>
      {roots.map((entity) => (
        <RenderNode
          key={entity.id}
          entity={entity}
          childrenByParent={childrenByParent}
          selectedId={selectedId}
          onPick={selectEntity}
          groupRefs={groupRefs}
          playMode={false}
        />
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

function ScriptedEntities({
  bodyRefs,
}: {
  bodyRefs: React.MutableRefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const sceneData = useEditor((s) => s.sceneData);
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const isPaused = useEditor((s) => s.isPaused);
  const { data: scripts } = useListScripts(projectId ?? 0, {
    query: { queryKey: getListScriptsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const keysRef = useKeyboardState(true);

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

  const childrenByParent = useMemo(() => buildTree(sceneData.entities), [sceneData.entities]);
  const roots = childrenByParent.get(null) ?? [];

  return (
    <>
      {roots.map((entity) => (
        <RenderNode
          key={entity.id}
          entity={entity}
          childrenByParent={childrenByParent}
          selectedId={null}
          onPick={() => {}}
          bodyRefs={bodyRefs}
          playMode
        />
      ))}
    </>
  );
}

function ScenePlayMode() {
  const env = useEditor((s) => s.sceneData.environment);
  const gravity = (env.gravity ?? [0, -9.81, 0]) as [number, number, number];
  const bodyRefs = useRef<Map<string, RapierRigidBody | THREE.Group>>(new Map());

  return (
    <Physics gravity={gravity}>
      <ScriptedEntities bodyRefs={bodyRefs} />
      <PlayCameraController bodyRefs={bodyRefs} />
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
  const cameraMode = env.cameraMode ?? "editor";

  const hint = !isPlaying
    ? "Edit Mode — drag the gizmo or click an object"
    : cameraMode === "rts"
      ? "▶ RTS — WASD or edge of screen to pan · wheel to zoom"
      : cameraMode === "thirdPerson"
        ? "▶ Third-person — drag to orbit · WASD to move · Shift to sprint"
        : cameraMode === "firstPerson"
          ? "▶ First-person — click to lock pointer · WASD + mouselook · Shift to sprint · Esc to release"
          : "▶ PLAY MODE — physics & scripts running";

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
          <>
            <Grid
              args={[40, 40]}
              cellSize={1}
              cellThickness={0.5}
              cellColor="#2a2a3e"
              sectionSize={5}
              sectionThickness={1}
              sectionColor="#d4af37"
              fadeDistance={40}
              fadeStrength={1.4}
              infiniteGrid
              position={[0, -0.001, 0]}
            />
            <OrbitControls makeDefault />
          </>
        )}
        <ClickToDeselect />
      </Canvas>

      <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-card/80 backdrop-blur border border-card-border text-xs font-mono text-muted-foreground pointer-events-none">
        <span className={isPlaying ? "text-accent" : ""}>{hint}</span>
      </div>
    </div>
  );
}
