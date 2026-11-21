/**
 * Forge Renderer Inspector — live runtime telemetry for the editor viewport.
 *
 * Extends the three.js DevTools bridge (`threeDevtools.ts`) with an in-app
 * ops HUD: FPS / draws / tris / scene counts / WebGL memory / Rapier / log
 * copy-out. This is Forge-native (R3F + Rapier + .gfscene) — not a Spawn
 * Tome/ECS port.
 *
 * SSOT: docs/THREEJS_EDITOR_PARITY.md § Renderer Inspector
 */

export type RendererInspectorTab =
  | "performance"
  | "scene"
  | "memory"
  | "physics"
  | "log";

export interface RendererSnapshot {
  ts: number;
  /** Rolling FPS over the last sample window. */
  fps: number;
  /** Frame time in milliseconds (1000 / fps). */
  frameMs: number;
  /** WebGLRenderer.info.render */
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  /** WebGLRenderer.info.memory */
  geometries: number;
  textures: number;
  /** Scene graph walk */
  objects: number;
  meshes: number;
  lights: number;
  cameras: number;
  skinnedMeshes: number;
  bones: number;
  /** Forge entity graph (from store), not Three Object3D count. */
  entities: number;
  entitiesWithPhysics: number;
  /** Chromium `performance.memory` when available (MB). */
  jsHeapUsedMb: number | null;
  jsHeapTotalMb: number | null;
  /** Live Rapier world (play mode only). null when Physics is not mounted. */
  rapierBodies: number | null;
  rapierColliders: number | null;
  /** Last measured world.step wall time in ms (play mode). */
  rapierStepMs: number | null;
  /** Active render quality preset from the editor store. */
  renderQuality: "high" | "perf" | string;
  /** Whether play mode is active. */
  isPlaying: boolean;
  /** WebGL / WebGPU hint from the canvas. */
  backend: string;
}

export function emptyRendererSnapshot(
  partial?: Partial<RendererSnapshot>,
): RendererSnapshot {
  return {
    ts: 0,
    fps: 0,
    frameMs: 0,
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    objects: 0,
    meshes: 0,
    lights: 0,
    cameras: 0,
    skinnedMeshes: 0,
    bones: 0,
    entities: 0,
    entitiesWithPhysics: 0,
    jsHeapUsedMb: null,
    jsHeapTotalMb: null,
    rapierBodies: null,
    rapierColliders: null,
    rapierStepMs: null,
    renderQuality: "high",
    isPlaying: false,
    backend: "webgl",
    ...partial,
  };
}

type Listener = (snap: RendererSnapshot) => void;

let current = emptyRendererSnapshot();
const listeners = new Set<Listener>();

export function getRendererSnapshot(): RendererSnapshot {
  return current;
}

export function publishRendererSnapshot(next: RendererSnapshot): void {
  current = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      /* panel must not break the sampler */
    }
  }
}

/** Merge physics-only fields without clobbering the latest GPU sample. */
export function publishPhysicsStats(partial: {
  rapierBodies: number | null;
  rapierColliders: number | null;
  rapierStepMs: number | null;
}): void {
  publishRendererSnapshot({
    ...current,
    ts: Date.now(),
    rapierBodies: partial.rapierBodies,
    rapierColliders: partial.rapierColliders,
    rapierStepMs: partial.rapierStepMs,
  });
}

export function subscribeRendererSnapshot(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

/** Plain-text dump for clipboard / Discord / issue reports. */
export function formatSnapshotForCopy(
  snap: RendererSnapshot,
  logs?: Array<{ level: string; text: string; ts: number }>,
): string {
  const lines = [
    "=== Forge Renderer Inspector ===",
    `ts: ${new Date(snap.ts || Date.now()).toISOString()}`,
    `backend: ${snap.backend}`,
    `quality: ${snap.renderQuality}`,
    `playing: ${snap.isPlaying}`,
    "",
    "-- Performance --",
    `fps: ${snap.fps.toFixed(1)}`,
    `frameMs: ${snap.frameMs.toFixed(2)}`,
    `drawCalls: ${snap.calls}`,
    `triangles: ${snap.triangles}`,
    `points: ${snap.points}`,
    `lines: ${snap.lines}`,
    "",
    "-- Scene --",
    `entities: ${snap.entities}`,
    `entitiesWithPhysics: ${snap.entitiesWithPhysics}`,
    `objects: ${snap.objects}`,
    `meshes: ${snap.meshes}`,
    `skinnedMeshes: ${snap.skinnedMeshes}`,
    `bones: ${snap.bones}`,
    `lights: ${snap.lights}`,
    `cameras: ${snap.cameras}`,
    "",
    "-- Memory --",
    `geometries: ${snap.geometries}`,
    `textures: ${snap.textures}`,
    `jsHeapUsedMb: ${snap.jsHeapUsedMb ?? "n/a"}`,
    `jsHeapTotalMb: ${snap.jsHeapTotalMb ?? "n/a"}`,
    "",
    "-- Physics (Rapier) --",
    `bodies: ${snap.rapierBodies ?? "n/a (edit mode)"}`,
    `colliders: ${snap.rapierColliders ?? "n/a (edit mode)"}`,
    `stepMs: ${snap.rapierStepMs != null ? snap.rapierStepMs.toFixed(2) : "n/a"}`,
  ];

  if (logs && logs.length > 0) {
    lines.push("", "-- Log (tail) --");
    for (const m of logs.slice(-40)) {
      const t = new Date(m.ts).toISOString().slice(11, 19);
      lines.push(`[${t}] ${m.level.toUpperCase()} ${m.text}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
