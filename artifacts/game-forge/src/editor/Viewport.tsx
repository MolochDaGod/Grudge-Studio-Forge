import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, Stats, TransformControls } from "@react-three/drei";
import { EffectsRig } from "@/scene/EffectsRig";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { useListScripts, getListScriptsQueryKey, type Script } from "@workspace/api-client-react";
import { EntityRenderer } from "@/scene/EntityRenderer";
import { getCompiledScript, makeContext } from "@/scene/PlayRuntime";
import type { ScriptEntity } from "@/scene/csTranspile";
import { useKeyboardState } from "@/lib/keyboard";
import { PlayCameraController } from "@/scene/CameraControllers";
import { buildTree } from "@/lib/hierarchy";
import type { SceneEntity, EntityType } from "@/scene/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Hotbar } from "@/editor/Hotbar";
import { DevtoolsBridge } from "@/scene/DevtoolsBridge";
import { BestPracticesSubMenu } from "@/editor/BestPracticesMenu";
import { Box as BoxIcon, Circle as CircleIcon, Cylinder as CylinderIcon, Square as SquareIcon, Lightbulb as LightIcon, Plus, Wand2 } from "lucide-react";
import { useListPrefabs, getListPrefabsQueryKey, type Prefab } from "@workspace/api-client-react";

interface PrefabPayload {
  entities?: SceneEntity[];
}

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
 *  child transforms compose with the parent's (Unity-style hierarchy).
 *
 *  IMPORTANT: We forward refs to EntityRenderer's *actual transformed group*
 *  (not a separate wrapper). If we wrapped in a tracking group, TransformControls
 *  would mutate the wrapper while EntityRenderer kept its inner group anchored
 *  to entity.transform — the gizmo and the visual mesh would diverge after the
 *  first drag. Forwarding directly keeps the gizmo, mesh, and store in sync. */
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

  return (
    <EntityRenderer
      entity={entity}
      selected={selectedId === entity.id}
      onPick={() => onPick(entity.id)}
      playMode={playMode}
      ref={(el) => {
        if (groupRefs) {
          // In edit mode the ref is always a THREE.Group (no physics).
          if (el) groupRefs.current.set(entity.id, el as THREE.Group);
          else groupRefs.current.delete(entity.id);
        }
        if (bodyRefs) {
          if (el) bodyRefs.current.set(entity.id, el as RapierRigidBody | THREE.Group);
          else bodyRefs.current.delete(entity.id);
        }
      }}
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
  // Use the command-dispatching wrapper so a TransformControls drag becomes
  // a single undo step (the command coalesces same-axis edits within ~800ms).
  const cmdSetEntityTransform = useEditor((s) => s.cmdSetEntityTransform);
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
              cmdSetEntityTransform(selectedId, "position", [o.position.x, o.position.y, o.position.z]);
            } else if (transformMode === "rotate") {
              cmdSetEntityTransform(selectedId, "rotation", [o.rotation.x, o.rotation.y, o.rotation.z]);
            } else {
              cmdSetEntityTransform(selectedId, "scale", [o.scale.x, o.scale.y, o.scale.z]);
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
  const envGravity = useEditor((s) => s.sceneData.environment.gravity);
  // Memoise so <Physics> doesn't tear down + recreate the world (and orphan
  // every RigidBody ref) every time a parent re-renders. The `?? [...]` would
  // otherwise allocate a fresh tuple on every render → new prop reference →
  // forced remount of the entire physics tree.
  const gravity = useMemo<[number, number, number]>(
    () => (envGravity ?? [0, -9.81, 0]) as [number, number, number],
    [envGravity],
  );
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

/** Snap the orbit-controls target onto the selected entity whenever the user
 *  presses F (or picks "Focus camera" from a context menu). We bump
 *  `focusToken` in the store and the effect below re-runs.
 *
 *  The effect deliberately depends ONLY on `focusToken` — selecting a new
 *  entity should NOT auto-focus (that's surprising). */
function FocusCameraController() {
  const focusToken = useEditor((s) => s.focusToken);
  const { camera, controls } = useThree();
  useEffect(() => {
    if (focusToken === 0) return; // initial mount, don't snap
    const { selectedId, sceneData } = useEditor.getState();
    if (!selectedId) return;
    const e = sceneData.entities.find((x) => x.id === selectedId);
    if (!e) return;
    const [x, y, z] = e.transform.position;
    // OrbitControls extends EventDispatcher; useThree types `controls` as the
    // base class. Cast through `unknown` to access the orbit-specific fields.
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (c && c.target) {
      const target = new THREE.Vector3(x, y, z);
      // Keep the camera's current direction; move it to a fixed distance
      // from the new target so the entity is centered.
      const dir = camera.position.clone().sub(c.target).normalize();
      const dist = Math.max(6, camera.position.distanceTo(c.target));
      c.target.copy(target);
      camera.position.copy(target.clone().add(dir.multiplyScalar(dist)));
      c.update?.();
    }
  }, [focusToken, camera, controls]);
  return null;
}

/**
 * Catches render-time exceptions from anything inside the 3D viewport (the
 * `<Canvas>`, scripts, post-processing, GLB loaders, etc.) and shows a
 * contained fallback in the viewport pane instead of letting the whole editor
 * shell — toolbar, hierarchy, inspector — go down with it. The "Reload
 * viewport" button bumps a key so the boundary remounts the entire subtree.
 *
 * React requires class components for error boundaries; there is no hook
 * equivalent.
 */
interface ViewportErrorBoundaryState {
  error: Error | null;
}
class ViewportErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  ViewportErrorBoundaryState
> {
  state: ViewportErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewportErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to dev console; the editor's own log panel doesn't see render
    // errors because they happen above the React tree the panel reads from.
    // eslint-disable-next-line no-console
    console.error("[Viewport] render error:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-background grid-pattern p-6">
          <div className="max-w-md text-center space-y-3 p-6 rounded-md bg-card/90 border border-card-border shadow-lg">
            <h3 className="text-base font-semibold text-destructive">
              Viewport crashed
            </h3>
            <p className="text-xs text-muted-foreground font-mono break-words">
              {this.state.error.message}
            </p>
            <p className="text-xs text-muted-foreground">
              The rest of the editor is still usable — open the console for the
              full stack, then reload the viewport once you've fixed the issue.
            </p>
            <button
              type="button"
              onClick={this.reset}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-accent-foreground hover:opacity-90"
              data-testid="button-reload-viewport"
            >
              Reload viewport
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const VIEWPORT_PRIMITIVES: { type: EntityType; label: string; Icon: typeof BoxIcon }[] = [
  { type: "box", label: "Box", Icon: BoxIcon },
  { type: "sphere", label: "Sphere", Icon: CircleIcon },
  { type: "cylinder", label: "Cylinder", Icon: CylinderIcon },
  { type: "plane", label: "Plane", Icon: SquareIcon },
  { type: "light", label: "Light", Icon: LightIcon },
];

/**
 * Probe whether the browser tab can actually acquire a WebGL context BEFORE
 * we hand off to R3F. Without this, a momentary GPU failure (Replit iframe
 * sandbox throttling, the "too many active WebGL contexts" limit some
 * browsers enforce, etc.) throws synchronously inside `new THREE.WebGLRenderer`
 * and the @replit/vite-plugin-runtime-error-modal overlays the entire app —
 * the user can't dismiss it without reloading. A tiny probe + graceful
 * fallback keeps the editor shell usable and lets the user retry.
 */
function probeWebGL(): { ok: true } | { ok: false; reason: string } {
  if (typeof document === "undefined") return { ok: false, reason: "No document" };
  try {
    const probe = document.createElement("canvas");
    const gl =
      (probe.getContext("webgl2") as WebGLRenderingContext | null) ??
      (probe.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return { ok: false, reason: "WebGL is not supported by this browser context." };
    // Release the probe context immediately so we don't burn one of the
    // browser's per-page WebGL slots before R3F gets to allocate the real one.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? "Unknown WebGL error" };
  }
}

function WebGLUnavailable({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-background grid-pattern p-6">
      <div className="max-w-md text-center space-y-4 p-6 rounded-md bg-card/90 border border-card-border shadow-lg">
        <h3 className="text-base font-semibold text-destructive">3D viewport unavailable</h3>
        <p className="text-xs text-muted-foreground font-mono break-words">{reason}</p>
        <p className="text-xs text-muted-foreground">
          Your browser couldn't acquire a WebGL context. This usually clears up
          on its own — try the retry button. If it persists, close other tabs
          using 3D / video, or reload the page.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs rounded-md bg-accent text-accent-foreground hover:opacity-90"
          data-testid="button-webgl-retry"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export function Viewport() {
  const env = useEditor((s) => s.sceneData.environment);
  const isPlaying = useEditor((s) => s.isPlaying);
  const renderQuality = useEditor((s) => s.renderQuality);
  const showStats = useEditor((s) => s.showStats);
  const selectEntity = useEditor((s) => s.selectEntity);
  const cmdAddEntity = useEditor((s) => s.cmdAddEntity);
  const cmdAddEmptyChild = useEditor((s) => s.cmdAddEmptyChild);
  const projectId = useEditor((s) => s.projectId);
  const hotbar = useEditor((s) => s.hotbar);
  const spawnPrefabEntities = useEditor((s) => s.spawnPrefabEntities);
  const pushLog = useEditor((s) => s.pushLog);
  const cameraMode = env.cameraMode ?? "editor";

  // Bumping `viewportEpoch` after a crash forces React to discard the old
  // <Canvas> tree (with its broken WebGL context, dangling refs, half-mounted
  // post-processing passes, etc.) and rebuild it from scratch.
  const [viewportEpoch, setViewportEpoch] = useState(0);
  const [webgl, setWebgl] = useState(() => probeWebGL());

  const { data: prefabs = [] } = useListPrefabs(projectId ?? 0, {
    query: { queryKey: getListPrefabsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const prefabsById = useMemo(() => {
    const m = new Map<number, Prefab>();
    for (const p of prefabs) m.set(p.id, p);
    return m;
  }, [prefabs]);

  const hint = !isPlaying
    ? "Edit Mode — drag the gizmo · right-click for menu · F to focus selection"
    : cameraMode === "rts"
      ? "▶ RTS — WASD or edge of screen to pan · wheel to zoom"
      : cameraMode === "thirdPerson"
        ? "▶ Third-person — drag to orbit · WASD to move · Shift to sprint"
        : cameraMode === "firstPerson"
          ? "▶ First-person — click to lock pointer · WASD + mouselook · Shift to sprint · Esc to release"
          : "▶ PLAY MODE — physics & scripts running";

  const spawnFromHotbar = (slotIndex: number) => {
    const id = hotbar[slotIndex];
    if (id == null) return;
    const p = prefabsById.get(id);
    if (!p) return;
    const data = p.data as PrefabPayload;
    if (!data?.entities?.length) return;
    spawnPrefabEntities(data.entities, p.id);
    pushLog("info", `Spawned "${p.name}" via slot ${slotIndex + 1}.`);
  };

  if (!webgl.ok) {
    return (
      <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
        <WebGLUnavailable
          reason={webgl.reason}
          onRetry={() => {
            const next = probeWebGL();
            setWebgl(next);
            // If the retry succeeded, also bump the viewport epoch so any
            // stale boundary state from a prior crash is cleared.
            if (next.ok) setViewportEpoch((n) => n + 1);
          }}
        />
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative w-full h-full bg-background grid-pattern overflow-hidden">
          <ViewportErrorBoundary
            key={viewportEpoch}
            onReset={() => setViewportEpoch((n) => n + 1)}
          >
            <Canvas
              shadows
              camera={{ position: [8, 8, 12], fov: 45 }}
              onPointerMissed={isPlaying ? undefined : () => selectEntity(null)}
              gl={{
                antialias: false,
                powerPreference: "high-performance",
                toneMapping: THREE.NoToneMapping,
              }}
              dpr={[1, 2]}
            >
              <DevtoolsBridge label="Forge · Scene" />
              <color attach="background" args={[env.skyColor ?? "#0a0a14"]} />
              <fog attach="fog" args={[env.skyColor ?? "#0a0a14", 30, 80]} />
              <Lights />
              <Suspense fallback={null}>
                {isPlaying ? <ScenePlayMode /> : <SceneEditMode />}
              </Suspense>
              <EffectsRig highQuality={renderQuality === "high"} />
              {showStats && <Stats className="!left-auto !right-3 !top-3" />}
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
                  <FocusCameraController />
                </>
              )}
              <ClickToDeselect />
            </Canvas>
          </ViewportErrorBoundary>

          <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-card/80 backdrop-blur border border-card-border text-xs font-mono text-muted-foreground pointer-events-none">
            <span className={isPlaying ? "text-accent" : ""}>{hint}</span>
          </div>

          <Hotbar />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px]">
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Plus className="size-3.5 mr-2" /> Add primitive
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {VIEWPORT_PRIMITIVES.map((p) => (
              <ContextMenuItem key={p.type} onClick={() => cmdAddEntity(p.type)}>
                <p.Icon className="size-3.5 mr-2" /> {p.label}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => cmdAddEmptyChild(null)}>
              <SquareIcon className="size-3.5 mr-2 opacity-60" /> Empty
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={hotbar.every((s) => s == null)}>
            <Plus className="size-3.5 mr-2" /> Spawn from hotbar
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {hotbar.map((slotId, idx) => {
              const p = slotId != null ? prefabsById.get(slotId) : undefined;
              return (
                <ContextMenuItem
                  key={idx}
                  disabled={!p}
                  onClick={() => spawnFromHotbar(idx)}
                >
                  <span className="font-mono text-[10px] text-muted-foreground mr-2 w-4">
                    {idx + 1}
                  </span>
                  {p ? p.name : <span className="opacity-50">empty</span>}
                </ContextMenuItem>
              );
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!projectId}
          onClick={() => window.dispatchEvent(new CustomEvent("gameforge:openMapGen"))}
        >
          <Wand2 className="size-3.5 mr-2" /> Generate map…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <BestPracticesSubMenu context="viewport" label="Scene best practices" />
      </ContextMenuContent>
    </ContextMenu>
  );
}
