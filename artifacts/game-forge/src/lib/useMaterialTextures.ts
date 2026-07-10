/**
 * Load optional PBR texture maps for a MaterialComponent.
 *
 * Uses THREE.TextureLoader with CORS for R2 / CDN assets. Disposes textures
 * on unmount or URL change so materials never leak GPU memory across entity
 * edits / AI tool calls.
 */
import { useEffect, useState } from "react";
import * as THREE from "three";
import type { MaterialComponent } from "@workspace/scene-schema";

export interface MaterialTextures {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  metalnessMap: THREE.Texture | null;
  emissiveMap: THREE.Texture | null;
}

const EMPTY: MaterialTextures = {
  map: null,
  normalMap: null,
  roughnessMap: null,
  metalnessMap: null,
  emissiveMap: null,
};

function loadTex(
  url: string | undefined,
  srgb: boolean,
  repeat: [number, number] | undefined,
): Promise<THREE.Texture | null> {
  if (!url || typeof url !== "string" || !url.trim()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        if (repeat) t.repeat.set(repeat[0], repeat[1]);
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** Hook: returns loaded textures for the given material map URLs. */
export function useMaterialTextures(
  material: MaterialComponent | undefined | null,
): MaterialTextures {
  const mapUrl = material?.mapUrl;
  const normalMapUrl = material?.normalMapUrl;
  const roughnessMapUrl = material?.roughnessMapUrl;
  const metalnessMapUrl = material?.metalnessMapUrl;
  const emissiveMapUrl = material?.emissiveMapUrl;
  const rx = material?.mapRepeat?.[0];
  const ry = material?.mapRepeat?.[1];
  const repeatKey = `${rx ?? 1},${ry ?? 1}`;

  const [tex, setTex] = useState<MaterialTextures>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const repeat: [number, number] | undefined =
      rx != null && ry != null ? [rx, ry] : undefined;

    void (async () => {
      const [map, normalMap, roughnessMap, metalnessMap, emissiveMap] =
        await Promise.all([
          loadTex(mapUrl, true, repeat),
          loadTex(normalMapUrl, false, repeat),
          loadTex(roughnessMapUrl, false, repeat),
          loadTex(metalnessMapUrl, false, repeat),
          loadTex(emissiveMapUrl, true, repeat),
        ]);
      if (cancelled) {
        map?.dispose();
        normalMap?.dispose();
        roughnessMap?.dispose();
        metalnessMap?.dispose();
        emissiveMap?.dispose();
        return;
      }
      setTex({ map, normalMap, roughnessMap, metalnessMap, emissiveMap });
    })();

    return () => {
      cancelled = true;
      setTex((prev) => {
        prev.map?.dispose();
        prev.normalMap?.dispose();
        prev.roughnessMap?.dispose();
        prev.metalnessMap?.dispose();
        prev.emissiveMap?.dispose();
        return EMPTY;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key fields only
  }, [mapUrl, normalMapUrl, roughnessMapUrl, metalnessMapUrl, emissiveMapUrl, repeatKey]);

  return tex;
}

/** Apply loaded maps onto a MeshStandardMaterial (or Phong). */
export function applyMapsToMaterial(
  mat: THREE.Material,
  maps: MaterialTextures,
): void {
  if (!(mat instanceof THREE.MeshStandardMaterial)) return;
  if (maps.map) {
    mat.map = maps.map;
  }
  if (maps.normalMap) {
    mat.normalMap = maps.normalMap;
    mat.normalScale = new THREE.Vector2(1, 1);
  }
  if (maps.roughnessMap) mat.roughnessMap = maps.roughnessMap;
  if (maps.metalnessMap) mat.metalnessMap = maps.metalnessMap;
  if (maps.emissiveMap) {
    mat.emissiveMap = maps.emissiveMap;
    if (mat.emissive.r === 0 && mat.emissive.g === 0 && mat.emissive.b === 0) {
      mat.emissive.set("#ffffff");
      mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.4);
    }
  }
  mat.needsUpdate = true;
}
