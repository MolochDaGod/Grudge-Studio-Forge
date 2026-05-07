import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  bakeNavmesh,
  loadNavmesh,
  findPath,
  sampleNavmesh,
  extractDebugTriangles,
} from "@/lib/navmesh";
import {
  surfaceToAreaId,
  areaIdToSurface,
  surfaceToLayer,
  layerToSurface,
  inferDefaultSurface,
  SURFACES,
} from "@workspace/scene-schema";
import {
  buildHulls,
  serializeHullSet,
  deserializeHullSet,
} from "@/lib/colliderBaker";

/** Tiny 10x10 ground quad — enough for Recast to produce > 0 polys. */
function groundMesh(size = 10): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(size, size, 1, 1);
  geom.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
  mesh.updateWorldMatrix(true, false);
  return mesh;
}

describe("scene-schema surface helpers", () => {
  it("maps every SurfaceKind to a stable area id and back", () => {
    for (const s of SURFACES) {
      const a = surfaceToAreaId(s);
      expect(a).toBeGreaterThanOrEqual(0);
      // None → 0; everything else round-trips through areaIdToSurface
      if (s === "None") {
        expect(a).toBe(0);
      } else {
        expect(areaIdToSurface(a)).toBe(s);
      }
    }
  });

  it("locks step Surface → Layer per the design contract", () => {
    expect(surfaceToLayer("Walk")).toBe("Terrain");
    expect(surfaceToLayer("Jump")).toBe("Terrain");
    expect(surfaceToLayer("Climb")).toBe("Terrain");
    expect(surfaceToLayer("Dig")).toBe("Terrain");
    expect(surfaceToLayer("Swim")).toBe("Water");
    expect(surfaceToLayer("None")).toBeUndefined();
  });

  it("infers a sensible default Surface from an existing layer", () => {
    expect(layerToSurface("Terrain")).toBe("Walk");
    expect(layerToSurface("Water")).toBe("Swim");
    expect(layerToSurface(undefined)).toBe("None");
    expect(inferDefaultSurface({ layer: "Water" })).toBe("Swim");
  });
});

describe("navmesh bake → load → query roundtrip", () => {
  it(
    "bakes a flat ground, serializes to bytes, reloads, and finds a straight path",
    async () => {
      const bake = await bakeNavmesh(
        [{ mesh: groundMesh(), surface: "Walk" }],
        {},
      );
      expect(bake.bytes).toBeInstanceOf(Uint8Array);
      expect(bake.bytes.byteLength).toBeGreaterThan(0);
      expect(bake.stats.polyCount).toBeGreaterThan(0);

      const loaded = await loadNavmesh(bake.bytes, "test-1");
      const path = findPath(loaded, [-3, 0, -3], [3, 0, 3]);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThanOrEqual(2);

      const snap = sampleNavmesh(loaded, [0, 5, 0]);
      expect(snap).not.toBeNull();
      expect(Math.abs(snap!.point[1])).toBeLessThan(1);

      const dbg = extractDebugTriangles(loaded);
      expect(dbg.positions.length % 9).toBe(0);
      expect(dbg.areaIds.length * 3).toBe(dbg.positions.length);
    },
    20_000,
  );
});

describe("collider baker (V-HACD)", () => {
  it(
    "builds at least one hull for a solid mesh and roundtrips JSON",
    async () => {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial(),
      );
      cube.updateWorldMatrix(true, false);
      const set = await buildHulls([cube]);
      expect(set.hulls.length).toBeGreaterThanOrEqual(1);
      expect(set.hulls[0].vertices.length).toBeGreaterThan(0);
      const json = serializeHullSet(set);
      const back = deserializeHullSet(json);
      expect(back.hulls[0].vertices.length).toBe(
        set.hulls[0].vertices.length,
      );
    },
    30_000,
  );

  it(
    "decomposes a non-convex mesh into multiple hulls",
    async () => {
      // Two disjoint boxes baked into a single BufferGeometry. The
      // convex hull of the union is a giant box that bridges the gap;
      // a real V-HACD bake should produce ~2 hulls instead.
      const a = new THREE.BoxGeometry(1, 1, 1).translate(-2, 0, 0);
      const b = new THREE.BoxGeometry(1, 1, 1).translate(2, 0, 0);
      const merged = mergeBoxes(a, b);
      const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      mesh.updateWorldMatrix(true, false);

      const set = await buildHulls([mesh], { maxHulls: 8 });
      expect(set.hulls.length).toBeGreaterThan(1);
      expect(set.totalVerts).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "honors minHullVolume strictly without falling back to a single quickhull",
    async () => {
      const a = new THREE.BoxGeometry(1, 1, 1).translate(-2, 0, 0);
      const b = new THREE.BoxGeometry(1, 1, 1).translate(2, 0, 0);
      const merged = mergeBoxes(a, b);
      const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      mesh.updateWorldMatrix(true, false);

      // Each unit-cube hull is ~1 m³. A 100 m³ threshold removes them
      // all; the result must be empty rather than the full ~5×1×1 = 5 m³
      // quickhull bridge that the fallback would produce.
      const filtered = await buildHulls([mesh], {
        maxHulls: 8,
        minHullVolume: 100,
      });
      expect(filtered.hulls.length).toBe(0);
      expect(filtered.totalVerts).toBe(0);

      // A tiny threshold should keep V-HACD's hulls intact.
      const kept = await buildHulls([mesh], {
        maxHulls: 8,
        minHullVolume: 0.001,
      });
      expect(kept.hulls.length).toBeGreaterThan(1);
    },
    60_000,
  );
});

/** Bake two BoxGeometries into a single non-indexed BufferGeometry by
 *  concatenating their position buffers. Avoids pulling in
 *  BufferGeometryUtils. */
function mergeBoxes(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const aPos = a.toNonIndexed().attributes.position
    .array as Float32Array;
  const bPos = b.toNonIndexed().attributes.position
    .array as Float32Array;
  const merged = new Float32Array(aPos.length + bPos.length);
  merged.set(aPos, 0);
  merged.set(bPos, aPos.length);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  return geom;
}
