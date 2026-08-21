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
  aoMap: THREE.Texture | null;
  displacementMap: THREE.Texture | null;
}

const EMPTY: MaterialTextures = {
  map: null,
  normalMap: null,
  roughnessMap: null,
  metalnessMap: null,
  emissiveMap: null,
  aoMap: null,
  displacementMap: null,
};

function loadTex(
  url: string | undefined,
  srgb: boolean,
  repeat: [number, number] | undefined,
): Promise<THREE.Texture | null> {
  if (!url || typeof url !== "string" || !url.trim()) return Promise.resolve(null);
  const src = url.trim();

  // data: / blob: URLs — TextureLoader works but some browsers need Image()
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const t = new THREE.Texture(img);
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.flipY = true;
        if (repeat) t.repeat.set(repeat[0], repeat[1]);
        t.needsUpdate = true;
        resolve(t);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      src,
      (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.flipY = true;
        if (repeat) t.repeat.set(repeat[0], repeat[1]);
        t.needsUpdate = true;
        t.anisotropy = 8;
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
  const aoMapUrl = material?.aoMapUrl;
  const displacementMapUrl = material?.displacementMapUrl;
  const rx = material?.mapRepeat?.[0];
  const ry = material?.mapRepeat?.[1];
  const repeatKey = `${rx ?? 1},${ry ?? 1}`;

  const [tex, setTex] = useState<MaterialTextures>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const repeat: [number, number] | undefined =
      rx != null && ry != null ? [rx, ry] : undefined;

    void (async () => {
      const [map, normalMap, roughnessMap, metalnessMap, emissiveMap, aoMap, displacementMap] =
        await Promise.all([
          loadTex(mapUrl, true, repeat),
          loadTex(normalMapUrl, false, repeat),
          loadTex(roughnessMapUrl, false, repeat),
          loadTex(metalnessMapUrl, false, repeat),
          loadTex(emissiveMapUrl, true, repeat),
          loadTex(aoMapUrl, false, repeat),
          loadTex(displacementMapUrl, false, repeat),
        ]);
      if (cancelled) {
        map?.dispose();
        normalMap?.dispose();
        roughnessMap?.dispose();
        metalnessMap?.dispose();
        emissiveMap?.dispose();
        aoMap?.dispose();
        displacementMap?.dispose();
        return;
      }
      setTex({ map, normalMap, roughnessMap, metalnessMap, emissiveMap, aoMap, displacementMap });
    })();

    return () => {
      cancelled = true;
      setTex((prev) => {
        prev.map?.dispose();
        prev.normalMap?.dispose();
        prev.roughnessMap?.dispose();
        prev.metalnessMap?.dispose();
        prev.emissiveMap?.dispose();
        prev.aoMap?.dispose();
        prev.displacementMap?.dispose();
        return EMPTY;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key fields only
  }, [
    mapUrl,
    normalMapUrl,
    roughnessMapUrl,
    metalnessMapUrl,
    emissiveMapUrl,
    aoMapUrl,
    displacementMapUrl,
    repeatKey,
  ]);

  return tex;
}

/** Apply loaded maps onto MeshStandard / MeshPhysical (Poly Haven PBR). */
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
  if (maps.aoMap) {
    mat.aoMap = maps.aoMap;
    mat.aoMapIntensity = 1;
  }
  if (maps.displacementMap && mat instanceof THREE.MeshPhysicalMaterial) {
    mat.displacementMap = maps.displacementMap;
    mat.displacementScale = 0.04;
  } else if (maps.displacementMap) {
    mat.bumpMap = maps.displacementMap;
    mat.bumpScale = 0.04;
  }
  if (maps.emissiveMap) {
    mat.emissiveMap = maps.emissiveMap;
    if (mat.emissive.r === 0 && mat.emissive.g === 0 && mat.emissive.b === 0) {
      mat.emissive.set("#ffffff");
      mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.4);
    }
  }
  mat.needsUpdate = true;
}
