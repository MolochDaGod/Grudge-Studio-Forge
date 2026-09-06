import { Group, type Object3D } from "three";
import { findPullableMesh } from "@/lib/glbHierarchy";

function isMesh(o: Object3D): boolean {
  return Boolean((o as { isMesh?: boolean }).isMesh);
}

/**
 * Exclusive visibility for grudge6 body / armor / weapon child meshes.
 * Main Panel admin writes `model.meshIds`. Empty / missing = show all.
 */
export function applyMeshIdsExclusive(root: Object3D, meshIds: string[]): void {
  const want = new Set(
    meshIds.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  root.traverse((o) => {
    if (!isMesh(o)) return;
    if (want.size === 0) {
      o.visible = true;
      return;
    }
    const n = (o.name || "").toLowerCase();
    o.visible =
      want.has(n) ||
      [...want].some((id) => n === id || n.includes(id) || id.includes(n));
  });
}

/**
 * Detach one named node from a cloned GLB and reset its local TRS so the
 * entity transform is the mesh origin (move / script / deploy independently).
 */
export function isolateNamedMeshAtOrigin(root: Object3D, meshName: string): Object3D | null {
  const want = meshName.trim();
  if (!want) return null;
  let hit = findPullableMesh(root, want);
  if (!hit) {
    root.traverse((o) => {
      if (hit) return;
      if (o.name === want) hit = o;
    });
  }
  if (!hit || hit === root) return null;
  hit.parent?.remove(hit);
  hit.position.set(0, 0, 0);
  hit.rotation.set(0, 0, 0);
  hit.quaternion.identity();
  hit.scale.set(1, 1, 1);
  hit.updateMatrix();
  const wrap = new Group();
  wrap.name = (hit.name || want).trim() || want;
  wrap.userData = { meshName: want, isolatedFrom: root.name };
  wrap.add(hit);
  return wrap;
}
