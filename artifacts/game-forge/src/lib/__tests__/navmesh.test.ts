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

describe("collider baker (quickhull stub)", () => {
  it("builds at least one hull for a solid mesh and roundtrips JSON", async () => {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    cube.updateWorldMatrix(true, false);
    const set = await buildHulls([cube]);
    expect(set.hulls.length).toBe(1);
    expect(set.hulls[0].vertices.length).toBeGreaterThan(0);
    const json = serializeHullSet(set);
    const back = deserializeHullSet(json);
    expect(back.hulls[0].vertices.length).toBe(set.hulls[0].vertices.length);
  });
});
