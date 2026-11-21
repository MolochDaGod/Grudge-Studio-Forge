/**
 * Samples WebGLRenderer.info + scene graph into the Renderer Inspector store.
 * Mount inside every editor Canvas next to DevtoolsBridge.
 *
 * Physics live counts are published separately by RendererPhysicsSampler
 * (must sit under <Physics>).
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import {
  emptyRendererSnapshot,
  publishPhysicsStats,
  publishRendererSnapshot,
} from "@/lib/rendererInspector";

const SAMPLE_INTERVAL_MS = 250;

function readJsHeap(): { used: number | null; total: number | null } {
  const mem = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    }
  ).memory;
  if (!mem) return { used: null, total: null };
  return {
    used: Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10,
    total: Math.round((mem.totalJSHeapSize / (1024 * 1024)) * 10) / 10,
  };
}

function walkScene(root: THREE.Object3D) {
  let objects = 0;
  let meshes = 0;
  let lights = 0;
  let cameras = 0;
  let skinnedMeshes = 0;
  let bones = 0;
  root.traverse((o) => {
    objects += 1;
    if ((o as THREE.Mesh).isMesh) {
      meshes += 1;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes += 1;
    }
    if ((o as THREE.Light).isLight) lights += 1;
    if ((o as THREE.Camera).isCamera) cameras += 1;
    if ((o as THREE.Bone).isBone) bones += 1;
  });
  return { objects, meshes, lights, cameras, skinnedMeshes, bones };
}

export function RendererStatsSampler() {
  const { gl, scene } = useThree();
  const lastSample = useRef(0);
  const fpsAccum = useRef({ frames: 0, ms: 0 });
  // Keep last physics fields so GPU samples don't wipe them.
  const physicsHold = useRef({
    rapierBodies: null as number | null,
    rapierColliders: null as number | null,
    rapierStepMs: null as number | null,
  });

  useEffect(() => {
    return subscribePhysicsHold(physicsHold);
  }, []);

  useFrame((_, delta) => {
    fpsAccum.current.frames += 1;
    fpsAccum.current.ms += delta * 1000;
    const now = performance.now();
    if (now - lastSample.current < SAMPLE_INTERVAL_MS) return;
    lastSample.current = now;

    const frames = fpsAccum.current.frames || 1;
    const ms = fpsAccum.current.ms || 16.67;
    const avgMs = ms / frames;
    const fps = 1000 / avgMs;
    fpsAccum.current = { frames: 0, ms: 0 };

    const info = gl.info;
    // info.render.* accumulates until reset — convert the sample window
    // into approximate per-frame averages (matches how ops HUDs read draws).
    const perFrame = (n: number) => Math.round(n / frames);
    const walk = walkScene(scene);
    const heap = readJsHeap();
    const ed = useEditor.getState();
    const entities = ed.sceneData.entities;
    const withPhys = entities.filter((e) => !!e.physics).length;

    const ctx = gl.getContext();
    const backend =
      typeof (ctx as WebGL2RenderingContext).beginQuery === "function"
        ? "webgl2"
        : "webgl";

    publishRendererSnapshot(
      emptyRendererSnapshot({
        ts: Date.now(),
        fps,
        frameMs: avgMs,
        calls: perFrame(info.render.calls),
        triangles: perFrame(info.render.triangles),
        points: perFrame(info.render.points),
        lines: perFrame(info.render.lines),
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        ...walk,
        entities: entities.length,
        entitiesWithPhysics: withPhys,
        jsHeapUsedMb: heap.used,
        jsHeapTotalMb: heap.total,
        rapierBodies: physicsHold.current.rapierBodies,
        rapierColliders: physicsHold.current.rapierColliders,
        rapierStepMs: physicsHold.current.rapierStepMs,
        renderQuality: ed.renderQuality,
        isPlaying: ed.isPlaying,
        backend,
      }),
    );

    // Reset render counters for the next window (memory counts stay).
    info.reset();
  });

  return null;
}

type PhysicsHoldRef = MutableRefObject<{
  rapierBodies: number | null;
  rapierColliders: number | null;
  rapierStepMs: number | null;
}>;

const physicsHoldSubs = new Set<PhysicsHoldRef>();

function subscribePhysicsHold(ref: PhysicsHoldRef): () => void {
  physicsHoldSubs.add(ref);
  return () => {
    physicsHoldSubs.delete(ref);
  };
}

function mirrorPhysicsHold(partial: {
  rapierBodies: number | null;
  rapierColliders: number | null;
  rapierStepMs: number | null;
}) {
  for (const ref of physicsHoldSubs) {
    ref.current = partial;
  }
  publishPhysicsStats(partial);
}

/**
 * Mount inside `<Physics>` (play mode). Reads Rapier world body/collider
 * counts and a cheap step-time estimate.
 */
export function RendererPhysicsSampler() {
  const { world } = useRapier();
  const last = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (now - last.current < SAMPLE_INTERVAL_MS) return;
    last.current = now;

    let bodies = 0;
    let colliders = 0;
    try {
      const w = world as {
        bodies?: { len?: () => number };
        colliders?: { len?: () => number };
        forEachRigidBody?: (cb: (b: unknown) => void) => void;
        forEachCollider?: (cb: (c: unknown) => void) => void;
      };
      if (typeof w.bodies?.len === "function") bodies = w.bodies.len();
      else if (typeof w.forEachRigidBody === "function") {
        w.forEachRigidBody(() => {
          bodies += 1;
        });
      }
      if (typeof w.colliders?.len === "function") colliders = w.colliders.len();
      else if (typeof w.forEachCollider === "function") {
        w.forEachCollider(() => {
          colliders += 1;
        });
      }
    } catch {
      bodies = 0;
      colliders = 0;
    }

    // stepMs stays null until we instrument Rapier world.step (honest MVP).
    mirrorPhysicsHold({
      rapierBodies: bodies,
      rapierColliders: colliders,
      rapierStepMs: null,
    });
  });

  useEffect(() => {
    return () => {
      mirrorPhysicsHold({
        rapierBodies: null,
        rapierColliders: null,
        rapierStepMs: null,
      });
    };
  }, []);

  return null;
}
