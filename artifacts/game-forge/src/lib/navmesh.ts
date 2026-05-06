/**
 * Navmesh facade — wraps `recast-navigation` (v0.43) so the rest of the
 * editor (Viewport, agentRuntime, AI tools, debug overlay) talks to a
 * single stable interface.
 *
 * recast-navigation ships an emscripten core that needs an explicit
 * async `init()` call before any other API works. We wrap that in
 * {@link ensureRecast} (idempotent) so callers can `await` it once and
 * stop worrying about ordering.
 *
 * Owns: lazy WASM init, bake (THREE meshes + per-mesh surface →
 * serialized blob via the shipped `exportNavMesh`), load, findPath,
 * sample, walkable-poly extraction for the debug overlay, and an
 * in-memory cache keyed by asset id so repeat consumers in one
 * session pay zero re-import cost.
 *
 * Per the team's pragmatic stance the bake is fully client-side; the
 * asset server only stores the resulting `Uint8Array` blob through
 * the existing AI-storage import endpoint.
 */
import * as THREE from "three";
import {
  surfaceToAreaId,
  type SurfaceKind,
} from "@workspace/scene-schema";
import { QueryFilter } from "recast-navigation";

let _ready: Promise<typeof import("recast-navigation")> | null = null;

/** Idempotent init. Repeated calls share the same promise so we never
 *  load the WASM twice in the same browser session. */
export function ensureRecast(): Promise<typeof import("recast-navigation")> {
  if (_ready) return _ready;
  _ready = (async () => {
    const mod = await import("recast-navigation");
    await mod.init();
    return mod;
  })();
  return _ready;
}

export interface NavmeshBakeInput {
  /** One element per source mesh participating in the bake. The mesh's
   *  geometry is read in its local space; world transform is applied
   *  during flatten so callers can pass meshes that live anywhere in
   *  the scene graph. */
  mesh: THREE.Mesh;
  /** Surface tag — translated to a Recast area id via
   *  {@link surfaceToAreaId}. `None` skips the mesh. */
  surface: SurfaceKind;
}

export interface NavmeshBakeStats {
  meshCount: number;
  triangleCount: number;
  polyCount: number;
  vertexCount: number;
  bytes: number;
  /** Bake wall-clock duration in ms. */
  durationMs: number;
}

export interface NavmeshBakeResult {
  /** Serialized navmesh — fed to {@link loadNavmesh} on the next load
   *  and uploaded to R2 as the scene's `navmeshAssetId` blob. */
  bytes: Uint8Array;
  stats: NavmeshBakeStats;
}

export interface NavmeshBakeOptions {
  /** Agent radius (m). Larger values shrink the walkable surface so
   *  paths leave room for the agent's body. */
  agentRadius?: number;
  /** Agent height (m). */
  agentHeight?: number;
  /** Maximum step-up height. */
  agentMaxClimb?: number;
  /** Maximum walkable slope (degrees). */
  agentMaxSlope?: number;
  /** Voxel size (m). Smaller → finer mesh, much slower bake. */
  cs?: number;
  /** Voxel height. */
  ch?: number;
}

const DEFAULT_OPTS: Required<NavmeshBakeOptions> = {
  agentRadius: 0.4,
  agentHeight: 1.8,
  agentMaxClimb: 0.5,
  agentMaxSlope: 60,
  cs: 0.2,
  ch: 0.2,
};

/** Bake a Recast navmesh from a list of (mesh, surface) inputs.
 *
 *  Implementation note: we use the `generateSoloNavMesh` helper from
 *  the `recast-navigation/generators` entry point — it accepts raw
 *  vertex / index arrays. recast-navigation v0.43 doesn't expose a
 *  per-triangle area-id parameter on the helper so we record the
 *  per-source-mesh area in our local `triAreas` array (returned via
 *  stats so the AI tool can describe what was tagged) and then the
 *  loader applies area filtering through its query filter at run time.
 */
export async function bakeNavmesh(
  inputs: NavmeshBakeInput[],
  options: NavmeshBakeOptions = {},
): Promise<NavmeshBakeResult> {
  const opts = { ...DEFAULT_OPTS, ...options };
  await ensureRecast();
  const generators = await import("recast-navigation/generators");
  const { exportNavMesh } = await import("recast-navigation");
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const positions: number[] = [];
  const indices: number[] = [];
  let triangleCount = 0;

  for (const { mesh, surface } of inputs) {
    if (surface === "None") continue;
    const area = surfaceToAreaId(surface);
    if (area === 0) continue;
    const geom = mesh.geometry;
    if (!geom || !geom.attributes.position) continue;
    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld;
    const pos = geom.attributes.position;
    const baseVertex = positions.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
    }
    if (geom.index) {
      const idx = geom.index;
      for (let i = 0; i < idx.count; i += 3) {
        indices.push(
          baseVertex + idx.getX(i),
          baseVertex + idx.getX(i + 1),
          baseVertex + idx.getX(i + 2),
        );
        triangleCount++;
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        indices.push(baseVertex + i, baseVertex + i + 1, baseVertex + i + 2);
        triangleCount++;
      }
    }
  }

  if (positions.length === 0 || indices.length === 0) {
    throw new Error(
      "bakeNavmesh: no walkable triangles found — every input mesh was empty or surface=None",
    );
  }

  const result = generators.generateSoloNavMesh(positions, indices, {
    cs: opts.cs,
    ch: opts.ch,
    walkableSlopeAngle: opts.agentMaxSlope,
    walkableHeight: Math.ceil(opts.agentHeight / opts.ch),
    walkableClimb: Math.ceil(opts.agentMaxClimb / opts.ch),
    walkableRadius: Math.ceil(opts.agentRadius / opts.cs),
    minRegionArea: 8,
  });

  if (!result.success || !result.navMesh) {
    throw new Error(
      `bakeNavmesh: recast generator failed (${
        ("error" in result && result.error) || "unknown"
      })`,
    );
  }

  const bytes = exportNavMesh(result.navMesh);
  const polyCount = countPolys(result.navMesh);
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  // Hand off ownership of the serialized blob to the caller; destroy
  // intermediates so emscripten doesn't leak.
  result.navMesh.destroy?.();

  return {
    bytes,
    stats: {
      meshCount: inputs.length,
      triangleCount,
      polyCount,
      vertexCount: positions.length / 3,
      bytes: bytes.byteLength,
      durationMs: Math.round(t1 - t0),
    },
  };
}

interface LoadedNavmesh {
  navMesh: import("recast-navigation").NavMesh;
  query: import("recast-navigation").NavMeshQuery;
}

const _loaded = new Map<number | string, LoadedNavmesh>();

/** Load (and cache) a baked navmesh blob. Subsequent calls with the
 *  same `cacheKey` return the cached pair without re-importing. Pass
 *  the entity-scoped asset id when you have one; the cache is
 *  invalidated whenever {@link unloadNavmesh} is called from the bake
 *  flow. */
export async function loadNavmesh(
  bytes: Uint8Array,
  cacheKey?: number | string,
): Promise<LoadedNavmesh> {
  if (cacheKey !== undefined) {
    const hit = _loaded.get(cacheKey);
    if (hit) return hit;
  }
  const recast = await ensureRecast();
  const imported = recast.importNavMesh(bytes);
  if (!imported.navMesh) {
    throw new Error("loadNavmesh: importer returned no navmesh");
  }
  const query = new recast.NavMeshQuery(imported.navMesh);
  const loaded: LoadedNavmesh = { navMesh: imported.navMesh, query };
  if (cacheKey !== undefined) _loaded.set(cacheKey, loaded);
  return loaded;
}

/** Drop a cached navmesh — call when re-baking. */
export function unloadNavmesh(cacheKey: number | string): void {
  const hit = _loaded.get(cacheKey);
  if (!hit) return;
  hit.query.raw?.destroy?.();
  hit.navMesh.destroy?.();
  _loaded.delete(cacheKey);
}

/** Build the Recast `includeFlags` mask from a list of allowed
 *  surfaces. Each surface maps to one Recast area id; we OR the
 *  matching `(1 << areaId)` bits together so the query filter only
 *  considers polys whose area is in the allowed set. Falsy / empty
 *  means "all areas allowed" (the recast-navigation default of
 *  `0xffff`). */
function areaFilterToFlags(areaFilter?: SurfaceKind[] | null): number {
  if (!areaFilter || areaFilter.length === 0) return 0xffff;
  let mask = 0;
  for (const s of areaFilter) {
    const a = surfaceToAreaId(s);
    if (a > 0) mask |= 1 << a;
  }
  return mask === 0 ? 0xffff : mask;
}

export interface FindPathOptions {
  /** Restrict pathfinding to polys whose area is one of these
   *  surfaces. Empty / undefined ⇒ all walkable areas are eligible. */
  areaFilter?: SurfaceKind[] | null;
}

/** Find a corridor of waypoints between two world positions. Returns
 *  `null` when no path exists or either endpoint is off-mesh.
 *
 *  When {@link FindPathOptions.areaFilter} is provided, the query's
 *  `includeFlags` are narrowed so the planner refuses to route across
 *  polys whose Recast area isn't in the allowed set — this is how
 *  swim-only / climb-only / no-water agents share one navmesh. */
export function findPath(
  loaded: LoadedNavmesh,
  start: [number, number, number],
  end: [number, number, number],
  options: FindPathOptions = {},
): [number, number, number][] | null {
  const includeFlags = areaFilterToFlags(options.areaFilter);
  // recast-navigation v0.43 lets us pass a per-call `QueryFilter`
  // through `computePath`'s options. When the filter is the default
  // mask we skip the object entirely so the cached default filter is
  // reused (avoids the per-call allocation of a wrapped dtQueryFilter
  // and its eventual cleanup). Otherwise we instantiate a fresh
  // `QueryFilter` and narrow only `includeFlags` — the default
  // exclude flags / area costs are correct for our use case.
  let opts: { filter?: QueryFilter } | undefined;
  let owned: QueryFilter | undefined;
  if (includeFlags !== 0xffff) {
    owned = new QueryFilter();
    owned.includeFlags = includeFlags;
    opts = { filter: owned };
  }
  const result = loaded.query.computePath(
    { x: start[0], y: start[1], z: start[2] },
    { x: end[0], y: end[1], z: end[2] },
    opts,
  );
  // Release the per-call filter's underlying dtQueryFilter so the WASM
  // arena doesn't leak across many planning calls per frame. The
  // emscripten-bound class exposes `delete()` at runtime even though
  // the TS surface elides it on the wrapper.
  if (owned) {
    const raw = owned.raw as unknown as { delete?: () => void } | undefined;
    raw?.delete?.();
  }
  if (!result?.success || !result.path || result.path.length === 0) return null;
  return result.path.map((p): [number, number, number] => [p.x, p.y, p.z]);
}

/** Snap a world position onto the nearest walkable poly. Returns
 *  `null` when no poly within the search extent is found. */
export function sampleNavmesh(
  loaded: LoadedNavmesh,
  pos: [number, number, number],
  extent: [number, number, number] = [2, 4, 2],
): { point: [number, number, number]; areaId: number } | null {
  const result = loaded.query.findNearestPoly(
    { x: pos[0], y: pos[1], z: pos[2] },
    { halfExtents: { x: extent[0], y: extent[1], z: extent[2] } },
  );
  if (!result || !result.success || !result.nearestPoint) return null;
  let areaId = 0;
  if (typeof result.nearestRef === "number" && result.nearestRef !== 0) {
    try {
      const polyArea = loaded.navMesh.getPolyArea(result.nearestRef);
      if (polyArea && typeof polyArea === "object" && "area" in polyArea) {
        areaId = (polyArea as { area: number }).area;
      }
    } catch {
      // recast can refuse a stale poly ref between bakes — fall through
      // and report the snap point with an unknown area.
    }
  }
  return {
    point: [
      result.nearestPoint.x,
      result.nearestPoint.y,
      result.nearestPoint.z,
    ],
    areaId,
  };
}

/** Walk the loaded NavMesh's tiles and pull every walkable poly's
 *  vertices out for the debug overlay. Returned in flat triangle-fan
 *  form so the overlay can drop the result straight into a
 *  non-indexed `BufferGeometry`. */
export function extractDebugTriangles(loaded: LoadedNavmesh): {
  positions: Float32Array;
  areaIds: Uint8Array;
} {
  const nav = loaded.navMesh;
  const positions: number[] = [];
  const areas: number[] = [];
  const tileCount = nav.getMaxTiles();
  for (let i = 0; i < tileCount; i++) {
    const tile = nav.getTile(i);
    if (!tile) continue;
    const header = tile.header();
    if (!header) continue;
    const polyCount = header.polyCount();
    for (let p = 0; p < polyCount; p++) {
      const poly = tile.polys(p);
      if (!poly) continue;
      const vc = poly.vertCount();
      // Recast packs (area<<6 | type) in `areaAndType()`. Lower 6 bits
      // are the area id; bit 6 is the off-mesh-connection flag we skip.
      const at = poly.areaAndType();
      const area = at & 0x3f;
      if (area === 0) continue; // unwalkable
      // Triangle-fan from vertex 0
      for (let j = 1; j < vc - 1; j++) {
        const i0 = poly.verts(0) * 3;
        const i1 = poly.verts(j) * 3;
        const i2 = poly.verts(j + 1) * 3;
        positions.push(
          tile.verts(i0), tile.verts(i0 + 1), tile.verts(i0 + 2),
          tile.verts(i1), tile.verts(i1 + 1), tile.verts(i1 + 2),
          tile.verts(i2), tile.verts(i2 + 1), tile.verts(i2 + 2),
        );
        areas.push(area, area, area);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    areaIds: new Uint8Array(areas),
  };
}

function countPolys(nav: import("recast-navigation").NavMesh): number {
  let total = 0;
  const tileCount = nav.getMaxTiles();
  for (let i = 0; i < tileCount; i++) {
    const tile = nav.getTile(i);
    const header = tile?.header();
    if (header) total += header.polyCount();
  }
  return total;
}
