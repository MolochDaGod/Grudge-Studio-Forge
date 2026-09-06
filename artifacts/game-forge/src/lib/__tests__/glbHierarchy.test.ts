import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  collectPullableMeshes,
  collectPullableMeshesResult,
  findPullableMesh,
  isMapShellUrl,
  isPullableMesh,
  isSkinnedPlayKit,
  MAX_PULL_MESHES,
  subNodeRefFor,
} from "../glbHierarchy";
import { isolateNamedMeshAtOrigin } from "../meshEquipApply";

function mesh(name: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  m.name = name;
  m.position.set(x, y, z);
  return m;
}

describe("isMapShellUrl", () => {
  it("keeps lobby / chicken-gun plates fused", () => {
    expect(isMapShellUrl("https://assets.grudge-studio.com/models/lobby/pirate-islands/scene.glb")).toBe(
      true,
    );
    expect(isMapShellUrl("builtin:map-mistytown")).toBe(true);
    expect(isMapShellUrl("models/nature/tree_pine.glb")).toBe(false);
  });
});

describe("collectPullableMeshes", () => {
  it("pulls parent and nested child meshes, including unnamed", () => {
    const root = new THREE.Group();
    root.name = "Pack";
    const crate = mesh("Crate", 2, 0, 0);
    const lid = mesh("Lid", 0, 1, 0);
    crate.add(lid);
    const anon = mesh("", 4, 0, 0);
    root.add(crate);
    root.add(anon);

    const nodes = collectPullableMeshes(root);
    expect(nodes.map((n) => n.name)).toEqual(["Crate", "Lid", "Mesh_3"]);
    expect(nodes[0]!.parentOrdinal).toBeNull();
    expect(nodes[0]!.position[0]).toBeCloseTo(2);
    expect(nodes[1]!.parentOrdinal).toBe(0);
    expect(nodes[1]!.position[0]).toBeCloseTo(0);
    expect(nodes[1]!.position[1]).toBeCloseTo(1);
    expect(nodes[2]!.parentOrdinal).toBeNull();
    expect(nodes[2]!.subNode).toBe("#2");
    expect(nodes[0]!.subNode).toBe("Crate");
  });

  it("encodes duplicate names as ordinals so isolate can tell them apart", () => {
    const root = new THREE.Group();
    root.add(mesh("Rock", 0, 0, 0));
    root.add(mesh("Rock", 3, 0, 0));
    const nodes = collectPullableMeshes(root);
    expect(nodes[0]!.name).toBe("Rock");
    expect(nodes[1]!.name).toBe("Rock_2");
    expect(nodes[0]!.subNode).toBe("#0");
    expect(nodes[1]!.subNode).toBe("#1");
    expect(findPullableMesh(root, "#1")?.position.x).toBeCloseTo(3);
  });

  it("skips bones and skinned play-kit meshes", () => {
    const root = new THREE.Group();
    root.add(mesh("Stone", 1, 0, 0));
    const bone = new THREE.Bone();
    bone.name = "Bip001";
    root.add(bone);
    expect(collectPullableMeshes(root).map((n) => n.name)).toEqual(["Stone"]);
    expect(isPullableMesh(bone)).toBe(false);
  });

  it("flags truncation instead of hiding leftover meshes", () => {
    const root = new THREE.Group();
    for (let i = 0; i < MAX_PULL_MESHES + 2; i++) root.add(mesh(`M${i}`));
    const { nodes, truncated } = collectPullableMeshesResult(root);
    expect(truncated).toBe(true);
    expect(nodes).toHaveLength(MAX_PULL_MESHES);
  });
});

describe("isSkinnedPlayKit", () => {
  it("detects a rigged body (skinned + ≥8 bones)", () => {
    const root = new THREE.Group();
    const bones: THREE.Bone[] = [];
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Bone();
      b.name = `Bip001_${i}`;
      bones.push(b);
      root.add(b);
    }
    const sm = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1.8, 0.4), new THREE.MeshBasicMaterial());
    sm.name = "WK_Body";
    sm.bind(new THREE.Skeleton(bones));
    root.add(sm);
    expect(isSkinnedPlayKit(root)).toBe(true);
    expect(isSkinnedPlayKit(new THREE.Group().add(mesh("Crate")))).toBe(false);
  });
});

describe("isolateNamedMeshAtOrigin", () => {
  it("detaches the named mesh and resets local TRS to the entity origin", () => {
    const root = new THREE.Group();
    root.add(mesh("Barrel", 5, 2, -1));
    root.add(mesh("Crate", -2, 0, 0));
    const isolated = isolateNamedMeshAtOrigin(root, "Barrel");
    expect(isolated).not.toBeNull();
    expect(isolated!.name).toBe("Barrel");
    const inner = isolated!.children[0]!;
    expect(inner.name).toBe("Barrel");
    expect(inner.position.x).toBe(0);
    expect(inner.position.y).toBe(0);
    expect(root.children.some((c) => c.name === "Barrel")).toBe(false);
    expect(root.children.some((c) => c.name === "Crate")).toBe(true);
  });

  it("isolates duplicate names via #ordinal", () => {
    const root = new THREE.Group();
    root.add(mesh("Rock", 0, 0, 0));
    root.add(mesh("Rock", 8, 0, 0));
    const isolated = isolateNamedMeshAtOrigin(root, "#1");
    expect(isolated).not.toBeNull();
    expect(isolated!.children[0]!.name).toBe("Rock");
  });
});

describe("subNodeRefFor", () => {
  it("keeps unique names readable and uses ordinals for collisions", () => {
    expect(subNodeRefFor("Door", 0, 1)).toBe("Door");
    expect(subNodeRefFor("Door", 1, 2)).toBe("#1");
    expect(subNodeRefFor("", 3, 0)).toBe("#3");
  });
});
