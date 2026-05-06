/**
 * Wireframe / translucent overlay of the currently baked navmesh.
 *
 * Mounts inside the editor `<Canvas>` (see Viewport.tsx) when the
 * "Show navmesh" switch in the Layers panel is on. Reads the raw
 * Recast bytes from the `window.__navmeshBlobs` slot the bake tool
 * stashes, calls `loadNavmesh` + `extractDebugTriangles`, and renders
 * the polys as a translucent mesh tinted by Recast area id.
 *
 * The component is intentionally read-only — it never mutates store
 * state, so it can flicker on/off without a CommandStack entry.
 */
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { create } from "zustand";
import { useEditor } from "@/store/editor";
import { loadNavmesh, extractDebugTriangles } from "@/lib/navmesh";

type LoadedNavmesh = Awaited<ReturnType<typeof loadNavmesh>>;

interface NavmeshDebugState {
  show: boolean;
  setShow: (v: boolean) => void;
}

/** Tiny standalone store so toggling the overlay does NOT push an entry
 *  onto the CommandStack — it's a pure UI flip. */
export const useNavmeshDebug = create<NavmeshDebugState>((set) => ({
  show: false,
  setShow: (show) => set({ show }),
}));

const AREA_COLORS: Record<number, string> = {
  1: "#4ade80", // Walk — green
  2: "#fbbf24", // Jump — amber
  3: "#a78bfa", // Climb — violet
  4: "#38bdf8", // Swim — sky
  5: "#f87171", // Dig — red
};

export function NavmeshDebugOverlay() {
  const show = useNavmeshDebug((s) => s.show);
  const assetId = useEditor((s) => s.sceneData.environment.navmeshAssetId);
  const [loaded, setLoaded] = useState<LoadedNavmesh | null>(null);

  useEffect(() => {
    if (!show || assetId === undefined) {
      setLoaded(null);
      return;
    }
    const blob = (
      window as unknown as { __navmeshBlobs?: Map<number, Uint8Array> }
    ).__navmeshBlobs?.get(assetId);
    if (!blob) return;
    let cancelled = false;
    loadNavmesh(blob, assetId)
      .then((l) => {
        if (!cancelled) setLoaded(l);
      })
      .catch(() => {
        // Swallow: overlay is best-effort, we don't want to crash the
        // editor if Recast fails to deserialize a stale blob.
      });
    return () => {
      cancelled = true;
    };
  }, [show, assetId]);

  const geom = useMemo(() => {
    if (!loaded) return null;
    const { positions, areaIds } = extractDebugTriangles(loaded);
    if (positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // Per-vertex color from area id so the overlay also reads as a
    // surface map (green walk, blue swim, etc.).
    const colors = new Float32Array(areaIds.length * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < areaIds.length; i++) {
      tmp.set(AREA_COLORS[areaIds[i]] ?? "#9ca3af");
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [loaded]);

  useEffect(() => {
    return () => {
      geom?.dispose();
    };
  }, [geom]);

  if (!show || !geom) return null;
  return (
    <group userData={{ __navmeshDebug: true }}>
      <mesh geometry={geom} renderOrder={999}>
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={new THREE.WireframeGeometry(geom)}>
        <lineBasicMaterial color="#0f172a" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}
