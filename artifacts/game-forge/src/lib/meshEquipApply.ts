import type { Object3D } from "three";

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
