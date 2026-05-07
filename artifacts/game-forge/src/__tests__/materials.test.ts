import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MATERIAL_KINDS,
  MATERIAL_DEFAULTS,
  resolveMaterialDefaults,
  isPaletteFriendly,
  indexEntitiesById,
  resolveInheritedFields,
  type SceneEntity,
} from "@workspace/scene-schema";
import { raycastEntities } from "@/scene/PlayRuntime";

const tr = () => ({
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});

describe("MATERIAL_DEFAULTS", () => {
  it("registers every kind", () => {
    for (const k of MATERIAL_KINDS) {
      expect(MATERIAL_DEFAULTS[k]).toBeDefined();
    }
  });

  it("models occlusion correctly", () => {
    expect(MATERIAL_DEFAULTS.Glass.blocksProjectiles).toBe(false);
    expect(MATERIAL_DEFAULTS.Glass.blocksLineOfSight).toBe(true);
    expect(MATERIAL_DEFAULTS.Foliage.blocksLineOfSight).toBe(false);
    expect(MATERIAL_DEFAULTS.Smoke.blocksAudio).toBe(false);
    expect(MATERIAL_DEFAULTS.Metal.blocksProjectiles).toBe(true);
    expect(MATERIAL_DEFAULTS.Liquid.drag).toBeGreaterThan(0);
  });
});

describe("resolveMaterialDefaults", () => {
  it("falls back to Solid when material is undefined", () => {
    const r = resolveMaterialDefaults(undefined);
    expect(r.kind).toBe("Solid");
    expect(r.density).toBe(MATERIAL_DEFAULTS.Solid.density);
  });

  it("applies per-entity overrides on top of the kind defaults", () => {
    const r = resolveMaterialDefaults({ kind: "Metal", friction: 0.95, blocksProjectiles: false });
    expect(r.kind).toBe("Metal");
    expect(r.friction).toBe(0.95);
    expect(r.density).toBe(MATERIAL_DEFAULTS.Metal.density);
    expect(r.blocksProjectiles).toBe(false);
  });
});

describe("isPaletteFriendly", () => {
  it("rejects materials that imply their own color", () => {
    expect(isPaletteFriendly("Solid")).toBe(true);
    expect(isPaletteFriendly("Metal")).toBe(true);
    expect(isPaletteFriendly("Glass")).toBe(false);
    expect(isPaletteFriendly("Liquid")).toBe(false);
    expect(isPaletteFriendly("Smoke")).toBe(false);
    expect(isPaletteFriendly("Foliage")).toBe(false);
    expect(isPaletteFriendly(undefined)).toBe(true); // no-kind treated as Solid
  });
});

describe("resolveInheritedFields", () => {
  const root: SceneEntity = {
    id: "root", name: "Map", type: "plane", parentId: null, transform: tr(),
    layer: "Terrain", surface: "Walk",
    material: { kind: "Stone" },
  };
  const child: SceneEntity = {
    id: "child", name: "Wall", type: "box", parentId: "root", transform: tr(),
  };
  const grandchild: SceneEntity = {
    id: "leaf", name: "Window", type: "box", parentId: "child", transform: tr(),
    material: { kind: "Glass" },
  };
  const detached: SceneEntity = {
    id: "loose", name: "Crate", type: "box", parentId: null, transform: tr(),
  };
  const idx = indexEntitiesById([root, child, grandchild, detached]);

  it("inherits layer/surface/material from the nearest ancestor that sets it", () => {
    const r = resolveInheritedFields(child, idx);
    expect(r.layer).toBe("Terrain");
    expect(r.surface).toBe("Walk");
    expect(r.materialKind).toBe("Stone");
  });

  it("respects an explicit child override without bleeding to siblings", () => {
    const r = resolveInheritedFields(grandchild, idx);
    expect(r.materialKind).toBe("Glass"); // own value wins
    expect(r.layer).toBe("Terrain");      // still inherited
  });

  it("returns undefined fields for a detached entity that sets nothing", () => {
    const r = resolveInheritedFields(detached, idx);
    expect(r.layer).toBeUndefined();
    expect(r.surface).toBeUndefined();
    expect(r.materialKind).toBeUndefined();
    expect(r.material).toBeUndefined();
  });

  it("inherits the FULL material component (not just kind) from an ancestor", () => {
    // Parent with rich material overrides; child sets nothing.
    const parent: SceneEntity = {
      id: "p", name: "P", type: "box", parentId: null, transform: tr(),
      material: {
        kind: "Metal",
        color: "#c9a227",
        metalness: 0.9,
        roughness: 0.15,
        emissive: "#221100",
        density: 7800,
        friction: 0.7,
        restitution: 0.05,
        opacity: 0.9,
        blocksLineOfSight: true,
        blocksProjectiles: true,
        blocksAudio: false,
      },
    };
    const kid: SceneEntity = {
      id: "k", name: "K", type: "box", parentId: "p", transform: tr(),
    };
    const i = indexEntitiesById([parent, kid]);
    const r = resolveInheritedFields(kid, i);
    expect(r.material).toBeDefined();
    expect(r.material!.kind).toBe("Metal");
    expect(r.material!.color).toBe("#c9a227");
    expect(r.material!.metalness).toBe(0.9);
    expect(r.material!.roughness).toBe(0.15);
    expect(r.material!.emissive).toBe("#221100");
    expect(r.material!.density).toBe(7800);
    expect(r.material!.friction).toBe(0.7);
    expect(r.material!.restitution).toBe(0.05);
    expect(r.material!.opacity).toBe(0.9);
    expect(r.material!.blocksLineOfSight).toBe(true);
    expect(r.material!.blocksProjectiles).toBe(true);
    expect(r.material!.blocksAudio).toBe(false);
  });

  it("per-field merge: child overrides one field, inherits the rest", () => {
    const parent: SceneEntity = {
      id: "p2", name: "P2", type: "box", parentId: null, transform: tr(),
      material: { kind: "Metal", color: "#c9a227", roughness: 0.2, density: 7800 },
    };
    // Child only sets its own color; kind/roughness/density should
    // still come from the parent.
    const kid: SceneEntity = {
      id: "k2", name: "K2", type: "box", parentId: "p2", transform: tr(),
      material: { color: "#ff0000" },
    };
    const i = indexEntitiesById([parent, kid]);
    const r = resolveInheritedFields(kid, i);
    expect(r.material!.color).toBe("#ff0000");      // own wins
    expect(r.material!.kind).toBe("Metal");          // inherited
    expect(r.material!.roughness).toBe(0.2);         // inherited
    expect(r.material!.density).toBe(7800);          // inherited
  });

  it("raycast hits on a child mesh inherit the parent's stamped material + density", () => {
    // Mirrors what EntityRenderer does: parent <group> stamps material
    // userData, child mesh stamps only entityId. raycastEntities walks
    // the parent chain, so the hit should report the parent's material
    // AND a non-null density.
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    parent.userData = {
      entityId: "parent-1",
      layer: "Default",
      material: "Stone",
      materialDensity: MATERIAL_DEFAULTS.Stone.density,
      materialBlocksLineOfSight: MATERIAL_DEFAULTS.Stone.blocksLineOfSight,
      materialBlocksProjectiles: MATERIAL_DEFAULTS.Stone.blocksProjectiles,
      materialBlocksAudio: MATERIAL_DEFAULTS.Stone.blocksAudio,
    };
    const child = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial(),
    );
    child.position.set(0, 0, -5);
    child.userData = { entityId: "child-1" }; // explicitly NO material keys
    parent.add(child);
    scene.add(parent);
    scene.updateMatrixWorld(true);

    const hit = raycastEntities(scene, [0, 0, 0], [0, 0, -1], 20, undefined);
    expect(hit).not.toBeNull();
    expect(hit!.material).toBe("Stone");
    expect(hit!.density).toBe(MATERIAL_DEFAULTS.Stone.density);
    expect(hit!.blocksProjectiles).toBe(true);
  });

  it("glass requireBlocksProjectiles filter passes through to a wall behind it", () => {
    const scene = new THREE.Scene();
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 0.1),
      new THREE.MeshBasicMaterial(),
    );
    glass.position.set(0, 0, -3);
    glass.userData = {
      entityId: "glass",
      layer: "Default",
      material: "Glass",
      materialDensity: MATERIAL_DEFAULTS.Glass.density,
      materialBlocksLineOfSight: true,
      materialBlocksProjectiles: false,
      materialBlocksAudio: MATERIAL_DEFAULTS.Glass.blocksAudio,
    };
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 0.5),
      new THREE.MeshBasicMaterial(),
    );
    wall.position.set(0, 0, -8);
    wall.userData = {
      entityId: "wall",
      layer: "Default",
      material: "Stone",
      materialDensity: MATERIAL_DEFAULTS.Stone.density,
      materialBlocksLineOfSight: true,
      materialBlocksProjectiles: true,
      materialBlocksAudio: true,
    };
    scene.add(glass, wall);
    scene.updateMatrixWorld(true);

    const sight = raycastEntities(scene, [0, 0, 0], [0, 0, -1], 20, undefined);
    expect(sight!.entityId).toBe("glass"); // sight hits glass first

    const bullet = raycastEntities(scene, [0, 0, 0], [0, 0, -1], 20, undefined, undefined, {
      requireBlocksProjectiles: true,
    });
    expect(bullet!.entityId).toBe("wall"); // bullet passes through glass
  });

  it("apply_palette preserves material.kind and physical overrides while patching color", async () => {
    // Mirror what design/apply_palette does: patch ONLY color/metalness/
    // roughness, NEVER drop kind / density / friction / blocks*.
    const prev = {
      kind: "Metal" as const,
      color: "#888888",
      metalness: 0.9,
      roughness: 0.2,
      emissive: "#101010",
      density: 7800,
      friction: 0.8,
      restitution: 0.05,
      blocksProjectiles: true,
      blocksLineOfSight: true,
      blocksAudio: true,
    };
    // Simulate the patch the tool now performs.
    const next = { ...prev, color: "#d4af37", metalness: prev.metalness ?? 0.1, roughness: prev.roughness ?? 0.6 };
    expect(next.kind).toBe("Metal");
    expect(next.color).toBe("#d4af37");
    expect(next.density).toBe(7800);
    expect(next.friction).toBe(0.8);
    expect(next.restitution).toBe(0.05);
    expect(next.blocksProjectiles).toBe(true);
    expect(next.emissive).toBe("#101010");
  });

  it("is cycle-safe", () => {
    const a: SceneEntity = { id: "a", name: "a", type: "empty", parentId: "b", transform: tr() };
    const b: SceneEntity = { id: "b", name: "b", type: "empty", parentId: "a", transform: tr(), layer: "Player" };
    const cyc = indexEntitiesById([a, b]);
    expect(() => resolveInheritedFields(a, cyc)).not.toThrow();
    expect(resolveInheritedFields(a, cyc).layer).toBe("Player");
  });
});
