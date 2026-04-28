/**
 * In-browser asset converters.
 *
 * The editor can ingest formats that aren't natively renderable by R3F's
 * GLTF loader — we transcode them to GLB on the client using three.js
 * loaders + GLTFExporter, then upload the resulting blob like any other
 * GLB asset. Conversion happens entirely in the browser; no server round
 * trip required.
 *
 * IMPORTANT: This module pulls in `three` + JSM loaders/exporters and is
 * therefore lazy-imported by `AssetDropZone` only when an OBJ file is
 * actually dropped. The cheap, dependency-free `classifyDroppedFile`
 * lives in `lib/fileKind.ts` so the drop zone can run without dragging
 * three.js into the initial bundle. Re-exported here too for any callers
 * that were importing the original location.
 */
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export { classifyDroppedFile, type DroppedFileKind } from "@/lib/fileKind";

/**
 * Parse an OBJ source (text) and re-encode it as a GLB blob. Materials
 * referenced via `mtllib` are not loaded — vertex colors / a default
 * standard material are used instead.
 */
export async function objToGlb(text: string, fileName: string): Promise<File> {
  const loader = new OBJLoader();
  const root = loader.parse(text);

  // OBJLoader produces meshes with MeshBasicMaterial by default. Replace with
  // a MeshStandardMaterial so it lights/shades like other GLB content in the
  // editor.
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const old = mesh.material as THREE.Material | THREE.Material[];
      const materials = Array.isArray(old) ? old : [old];
      mesh.material = materials.map((m) => {
        const c = (m as unknown as { color?: THREE.Color }).color;
        return new THREE.MeshStandardMaterial({
          color: c?.clone() ?? new THREE.Color(0xd4af37),
          metalness: 0.1,
          roughness: 0.6,
        });
      });
      if (mesh.material.length === 1) mesh.material = mesh.material[0];
    }
  });

  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer | Record<string, unknown>>((resolve, reject) => {
    exporter.parse(
      root,
      (out) => resolve(out),
      (err) => reject(err),
      { binary: true, embedImages: true },
    );
  });

  if (!(result instanceof ArrayBuffer)) {
    // Should not happen with binary: true, but handle gracefully
    throw new Error("GLTFExporter did not return a binary GLB buffer");
  }

  const glbName = fileName.replace(/\.obj$/i, "") + ".glb";
  return new File([result], glbName, { type: "model/gltf-binary" });
}

// `classifyDroppedFile` and `DroppedFileKind` were moved to `lib/fileKind.ts`
// (re-exported at the top of this file) so importers that only need the
// classifier don't drag three.js into the initial bundle.
