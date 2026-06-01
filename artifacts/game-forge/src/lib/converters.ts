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
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export { classifyDroppedFile, type DroppedFileKind } from "@/lib/fileKind";

const DEFAULT_COLOR = 0xd4af37;

/**
 * Serialize a three.js Object3D tree to a binary GLB `File`. Shared by
 * every `*ToGlb` converter so they all emit identical, editor-ready GLBs
 * (binary, embedded images, embedded animations).
 */
async function objectToGlbFile(
  root: THREE.Object3D,
  fileName: string,
  sourceExt: RegExp,
  animations: THREE.AnimationClip[] = [],
): Promise<File> {
  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer | Record<string, unknown>>(
    (resolve, reject) => {
      exporter.parse(
        root,
        (out) => resolve(out),
        (err) => reject(err),
        // `animations` carries skinned-mesh / rigid clips (FBX commonly
        // ships them) into the GLB so they survive the round-trip.
        { binary: true, embedImages: true, animations },
      );
    },
  );

  if (!(result instanceof ArrayBuffer)) {
    // Should not happen with binary: true, but handle gracefully
    throw new Error("GLTFExporter did not return a binary GLB buffer");
  }

  const glbName = fileName.replace(sourceExt, "") + ".glb";
  return new File([result], glbName, { type: "model/gltf-binary" });
}

/**
 * Replace non-PBR materials on a tree with `MeshStandardMaterial` so the
 * import lights/shades like other GLB content in the editor. Preserves an
 * existing `.color` when the source material exposes one; otherwise falls
 * back to the brand gold. Existing standard/physical materials are kept.
 */
function standardizeMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const old = mesh.material as THREE.Material | THREE.Material[];
    const materials = Array.isArray(old) ? old : [old];
    mesh.material = materials.map((m) => {
      if (
        (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
        (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial
      ) {
        return m;
      }
      // reason: three.js Material is a discriminated union; only the
      // standard/basic variants expose `.color`. Probing through unknown
      // is the standard escape hatch when normalizing arbitrary material
      // imports without listing every concrete subtype.
      const c = (m as unknown as { color?: THREE.Color }).color;
      const map = (m as unknown as { map?: THREE.Texture | null }).map ?? null;
      return new THREE.MeshStandardMaterial({
        color: c?.clone() ?? new THREE.Color(DEFAULT_COLOR),
        map,
        metalness: 0.1,
        roughness: 0.6,
      });
    });
    if (mesh.material.length === 1) mesh.material = mesh.material[0];
  });
}

/**
 * Parse an OBJ source (text) and re-encode it as a GLB blob. Materials
 * referenced via `mtllib` are not loaded — vertex colors / a default
 * standard material are used instead.
 */
export async function objToGlb(text: string, fileName: string): Promise<File> {
  const loader = new OBJLoader();
  const root = loader.parse(text);
  // OBJLoader produces meshes with MeshBasicMaterial by default.
  standardizeMaterials(root);
  return objectToGlbFile(root, fileName, /\.obj$/i);
}

/**
 * Parse a binary FBX (ArrayBuffer) and re-encode it as a GLB blob.
 * Embedded textures and animation clips are carried through. FBX is the
 * most common interchange format for rigged characters, so this unlocks
 * dropping Mixamo / Blender / Maya exports straight into the editor.
 */
export async function fbxToGlb(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<File> {
  const loader = new FBXLoader();
  // FBXLoader.parse needs a resource path for sibling textures; we have
  // none in a single-file drop, so pass "".
  const root = loader.parse(buffer, "");
  standardizeMaterials(root);
  // FBXLoader attaches clips to `root.animations`.
  const clips = (root.animations as THREE.AnimationClip[] | undefined) ?? [];
  return objectToGlbFile(root, fileName, /\.fbx$/i, clips);
}

/**
 * Parse a binary or ASCII STL (ArrayBuffer) and re-encode it as a GLB
 * blob. STL carries geometry only (no materials), so we wrap the parsed
 * geometry in a default gold standard material and compute normals when
 * the source omits them.
 */
export async function stlToGlb(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<File> {
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(DEFAULT_COLOR),
      metalness: 0.1,
      roughness: 0.6,
    }),
  );
  const root = new THREE.Group();
  root.add(mesh);
  return objectToGlbFile(root, fileName, /\.stl$/i);
}

// `classifyDroppedFile` and `DroppedFileKind` were moved to `lib/fileKind.ts`
// (re-exported at the top of this file) so importers that only need the
// classifier don't drag three.js into the initial bundle.
