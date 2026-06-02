/**
 * Browser-side asset conversion pipeline.
 *
 * Converts FBX, OBJ, STL, glTF → GLB using three.js + GLTFExporter via the
 * already-installed `three-stdlib` loaders. ZIP files are extracted with
 * `fflate` and each contained 3D file is converted individually; sibling
 * MTL / texture files in the same archive are auto-attached to OBJ
 * conversions through an in-memory blob: URL resolver.
 *
 * Every emitted GLB (converted or passthrough) is also run through a
 * gltf-transform post-process pass that dedups / prunes / welds geometry
 * and applies `EXT_meshopt_compression` for ~5–10× smaller meshes. KTX2
 * texture compression is intentionally NOT applied client-side because
 * the basis-encoder WASM (~3 MB) is too heavy for the editor bundle — the
 * desktop bridge handles it on the heavy path.
 *
 * Supported input → output:
 *   .fbx  → .glb   (three-stdlib FBXLoader → GLTFExporter → meshopt)
 *   .obj  → .glb   (three-stdlib OBJLoader + MTLLoader → GLTFExporter → meshopt)
 *   .stl  → .glb   (three-stdlib STLLoader → GLTFExporter → meshopt)
 *   .gltf → .glb   (three-stdlib GLTFLoader → GLTFExporter → meshopt)
 *   .glb  → .glb   (re-optimized through meshopt; falls back to passthrough on failure)
 *   .zip  → .glb[] (extract + convert each 3D file found inside)
 *   .png/.jpg/.webp/.json → passthrough (direct upload, no conversion)
 *
 * Usage:
 *   import { convertFile, isSupportedFile, SUPPORTED_EXTENSIONS } from "@/lib/assetConverter";
 *   const result = await convertFile(file, (progress, message) => { ... });
 */
import { unzipSync } from "fflate";
import type * as THREE_NS from "three";
import type { Document } from "@gltf-transform/core";

// ── Types ────────────────────────────────────────────────────────────

/** Lightweight summary the Library panel can render without re-parsing the GLB. */
export interface AssetMetadata {
  triangles: number;
  vertices: number;
  meshes: number;
  /** Number of unique bones across all skinned meshes. */
  bones: number;
  /** Animation clip names (empty when the asset has no animations). */
  animations: string[];
  /** Distinct material names referenced by the meshes. */
  materials: string[];
  /** World-space AABB of the merged root after import. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** True when at least one material references a texture map. */
  hasTextures: boolean;
}

export interface ConvertedAsset {
  /** Original filename (or extracted filename from ZIP). */
  originalName: string;
  /** Output filename (always .glb for 3D, original ext for images/JSON). */
  outputName: string;
  /** Converted file data. */
  data: Uint8Array;
  /** MIME type for upload. */
  contentType: string;
  /** Whether this was a 3D conversion or a passthrough. */
  converted: boolean;
  /** Optional summary of the GLB's contents (only set for 3D assets). */
  metadata?: AssetMetadata;
}

export type ProgressCallback = (progress: number, message: string) => void;

// ── Constants ────────────────────────────────────────────────────────

const THREE_D_EXTENSIONS = new Set(["fbx", "obj", "stl", "gltf", "glb"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]);
const DATA_EXTENSIONS = new Set(["json"]);
const ZIP_EXTENSIONS = new Set(["zip"]);

export const SUPPORTED_EXTENSIONS = new Set([
  ...THREE_D_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...DATA_EXTENSIONS,
  ...ZIP_EXTENSIONS,
]);

export function isSupportedFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.has(ext);
}

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

// ── Core conversion (three-stdlib, lazy-loaded) ──────────────────────

function mimeForExt(ext: string): string {
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "avif": return "image/avif";
    default: return "application/octet-stream";
  }
}

/** Get an ArrayBuffer view that owns its memory (loaders mutate input). */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

/** Serialize an Object3D root to a binary GLB Uint8Array. */
async function exportToGlb(
  root: THREE_NS.Object3D,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GLTFExporterCtor: any,
): Promise<Uint8Array> {
  const exporter = new GLTFExporterCtor();
  const result = await new Promise<ArrayBuffer | Record<string, unknown>>((resolve, reject) => {
    exporter.parse(
      root,
      (out: ArrayBuffer | Record<string, unknown>) => resolve(out),
      (err: unknown) => reject(err),
      { binary: true, embedImages: true },
    );
  });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return a binary GLB buffer");
  }
  return new Uint8Array(result);
}

// ── Meshopt optimize + metadata extraction (gltf-transform) ─────────

/**
 * Run a GLB through gltf-transform: dedup duplicate accessors / textures,
 * prune unused nodes, weld near-duplicate vertices, then apply
 * `EXT_meshopt_compression` for ~5–10× smaller meshes. Falls back to the
 * input bytes if any step fails so an unusual GLB never blocks an upload.
 *
 * Also extracts an `AssetMetadata` summary from the same Document so the
 * Library panel can render anim/bone/triangle counts without re-parsing
 * the binary.
 */
async function optimizeAndMeasure(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; metadata: AssetMetadata }> {
  const { WebIO } = await import("@gltf-transform/core");
  const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
  const { dedup, prune, weld, meshopt } = await import(
    "@gltf-transform/functions"
  );
  const { MeshoptEncoder } = await import("meshoptimizer");

  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  let doc: Document;
  try {
    doc = await io.readBinary(bytes);
  } catch (err) {
    console.warn("[AssetConverter] gltf-transform read failed:", err);
    return { bytes, metadata: emptyMetadata() };
  }

  try {
    await MeshoptEncoder.ready;
    await doc.transform(
      dedup(),
      prune(),
      weld({ tolerance: 0.0001 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
  } catch (err) {
    console.warn("[AssetConverter] meshopt transform failed; keeping unoptimized doc:", err);
  }

  const metadata = extractMetadata(doc);

  let outBytes: Uint8Array;
  try {
    outBytes = await io.writeBinary(doc);
  } catch (err) {
    console.warn("[AssetConverter] gltf-transform write failed; using input bytes:", err);
    outBytes = bytes;
  }

  return { bytes: outBytes, metadata };
}

function emptyMetadata(): AssetMetadata {
  return {
    triangles: 0,
    vertices: 0,
    meshes: 0,
    bones: 0,
    animations: [],
    materials: [],
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    hasTextures: false,
  };
}

function extractMetadata(doc: Document): AssetMetadata {
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  let triangles = 0;
  let vertices = 0;
  let hasTextures = false;
  const bboxMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const bboxMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (pos) {
        vertices += pos.getCount();
        const lo = pos.getMin([0, 0, 0]) as number[];
        const hi = pos.getMax([0, 0, 0]) as number[];
        for (let i = 0; i < 3; i++) {
          if (lo[i] < bboxMin[i]) bboxMin[i] = lo[i];
          if (hi[i] > bboxMax[i]) bboxMax[i] = hi[i];
        }
      }
      const indices = prim.getIndices();
      if (indices) triangles += Math.floor(indices.getCount() / 3);
      else if (pos) triangles += Math.floor(pos.getCount() / 3);
    }
  }

  let bones = 0;
  for (const skin of root.listSkins()) bones += skin.listJoints().length;

  const materials: string[] = [];
  for (const mat of root.listMaterials()) {
    materials.push(mat.getName() || "(unnamed)");
    if (
      mat.getBaseColorTexture() ||
      mat.getMetallicRoughnessTexture() ||
      mat.getNormalTexture() ||
      mat.getEmissiveTexture() ||
      mat.getOcclusionTexture()
    ) {
      hasTextures = true;
    }
  }

  const animations = root
    .listAnimations()
    .map((a) => a.getName() || "(unnamed)");

  if (!Number.isFinite(bboxMin[0])) {
    bboxMin[0] = bboxMin[1] = bboxMin[2] = 0;
    bboxMax[0] = bboxMax[1] = bboxMax[2] = 0;
  }

  return {
    triangles,
    vertices,
    meshes: meshes.length,
    bones,
    animations,
    materials,
    bbox: { min: bboxMin, max: bboxMax },
    hasTextures,
  };
}



/** Convert a single 3D file (FBX/OBJ/STL/GLTF) → GLB. */
async function convertToGlb(
  filename: string,
  data: Uint8Array,
  siblings?: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  const ext = getExtension(filename);
  // Lazy-load the heavy three.js graph only when an actual conversion runs.
  const THREE = (await import("three")) as typeof THREE_NS;
  const { GLTFExporter } = await import("three-stdlib");

  let root: THREE_NS.Object3D;

  if (ext === "fbx") {
    const { FBXLoader } = await import("three-stdlib");
    const loader = new FBXLoader();
    root = loader.parse(toArrayBuffer(data), "");
  } else if (ext === "stl") {
    const { STLLoader } = await import("three-stdlib");
    const loader = new STLLoader();
    const geometry = loader.parse(toArrayBuffer(data));
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.1,
      roughness: 0.6,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    const group = new THREE.Group();
    group.add(mesh);
    root = group;
  } else if (ext === "obj") {
    const { OBJLoader } = await import("three-stdlib");
    const objText = new TextDecoder().decode(data);
    const loader = new OBJLoader();
    // Wire sibling MTL + textures from a ZIP via in-memory blob: URLs so
    // `mtllib foo.mtl` and `map_Kd bar.png` references resolve client-side.
    const createdUrls: string[] = [];
    if (siblings) {
      const mtlMatch = objText.match(/^\s*mtllib\s+(.+?)\s*$/m);
      if (mtlMatch) {
        const mtlName = mtlMatch[1].trim();
        const mtlBuf =
          siblings.get(mtlName) ??
          [...siblings.entries()].find(([k]) =>
            k.toLowerCase().endsWith(`/${mtlName.toLowerCase()}`) ||
            k.toLowerCase() === mtlName.toLowerCase(),
          )?.[1];
        if (mtlBuf) {
          const { MTLLoader } = await import("three-stdlib");
          const mtlLoader = new MTLLoader();
          const mtlText = new TextDecoder().decode(mtlBuf);
          const blobUrls = new Map<string, string>();
          for (const [sName, sBuf] of siblings) {
            const sExt = getExtension(sName);
            if (IMAGE_EXTENSIONS.has(sExt)) {
              const url = URL.createObjectURL(
                new Blob([toArrayBuffer(sBuf)], { type: mimeForExt(sExt) }),
              );
              blobUrls.set(sName.split("/").pop()!.toLowerCase(), url);
              createdUrls.push(url);
            }
          }
          mtlLoader.manager.setURLModifier((url) => {
            const key = url.split("/").pop()?.toLowerCase() ?? url;
            return blobUrls.get(key) ?? url;
          });
          const materials = mtlLoader.parse(mtlText, "");
          materials.preload();
          loader.setMaterials(materials);
        }
      }
    }
    try {
      root = loader.parse(objText);
    } finally {
      // Revoke blob URLs after the OBJ parse + texture upload latches them
      // into Textures (which keep their own references). Defer one tick so
      // the loader's async image loads can grab the URL first.
      if (createdUrls.length > 0) {
        setTimeout(() => createdUrls.forEach((u) => URL.revokeObjectURL(u)), 5000);
      }
    }
  } else if (ext === "gltf" || ext === "glb") {
    const { GLTFLoader } = await import("three-stdlib");
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(toArrayBuffer(data), "");
    root = gltf.scene;
  } else {
    throw new Error(`Unsupported 3D extension: .${ext}`);
  }

  return await exportToGlb(root, GLTFExporter);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Convert a file (or ZIP of files) into uploadable assets.
 * Returns an array because ZIPs can contain multiple 3D files.
 */
export async function convertFile(
  file: File,
  onProgress?: ProgressCallback,
): Promise<ConvertedAsset[]> {
  const ext = getExtension(file.name);
  const progress = onProgress ?? (() => {});

  // ── ZIP: extract and convert each 3D file ──
  if (ext === "zip") {
    progress(0.1, "Extracting ZIP...");
    const zipData = new Uint8Array(await file.arrayBuffer());
    const entries = unzipSync(zipData);

    const results: ConvertedAsset[] = [];
    const entryNames = Object.keys(entries);
    const siblings = new Map(Object.entries(entries));

    let processed = 0;
    for (const [name, data] of Object.entries(entries)) {
      const entryExt = getExtension(name);
      processed++;
      const pct = 0.1 + (processed / entryNames.length) * 0.85;

      if (THREE_D_EXTENSIONS.has(entryExt) && entryExt !== "glb") {
        progress(pct, `Converting ${name}...`);
        try {
          const rawGlb = await convertToGlb(name, data, siblings);
          const optimized = await optimizeAndMeasure(rawGlb);
          results.push({
            originalName: name,
            outputName: `${baseName(name)}.glb`,
            data: optimized.bytes,
            contentType: "model/gltf-binary",
            converted: true,
            metadata: optimized.metadata,
          });
        } catch (e) {
          console.warn(`[AssetConverter] Skipping ${name}:`, e);
        }
      } else if (entryExt === "glb") {
        try {
          const optimized = await optimizeAndMeasure(data);
          results.push({
            originalName: name,
            outputName: name,
            data: optimized.bytes,
            contentType: "model/gltf-binary",
            converted: optimized.bytes.byteLength !== data.byteLength,
            metadata: optimized.metadata,
          });
        } catch (e) {
          console.warn(`[AssetConverter] GLB optimize failed for ${name}; passing through:`, e);
          results.push({
            originalName: name,
            outputName: name,
            data,
            contentType: "model/gltf-binary",
            converted: false,
          });
        }
      } else if (IMAGE_EXTENSIONS.has(entryExt)) {
        const mimeMap: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
          avif: "image/avif",
        };
        results.push({
          originalName: name,
          outputName: name,
          data,
          contentType: mimeMap[entryExt] ?? "application/octet-stream",
          converted: false,
        });
      } else if (entryExt === "json") {
        results.push({
          originalName: name,
          outputName: name,
          data,
          contentType: "application/json",
          converted: false,
        });
      }
      // Skip MTL, textures already processed, directories, etc.
    }

    progress(1, `Extracted ${results.length} assets`);
    return results;
  }

  // ── 3D file: convert to GLB ──
  if (THREE_D_EXTENSIONS.has(ext) && ext !== "glb" && ext !== "gltf") {
    progress(0.2, "Loading converter...");
    const data = new Uint8Array(await file.arrayBuffer());
    progress(0.5, `Converting ${file.name}...`);
    const rawGlb = await convertToGlb(file.name, data);
    progress(0.8, "Optimizing mesh...");
    const optimized = await optimizeAndMeasure(rawGlb);
    progress(1, "Conversion complete");
    return [{
      originalName: file.name,
      outputName: `${baseName(file.name)}.glb`,
      data: optimized.bytes,
      contentType: "model/gltf-binary",
      converted: true,
      metadata: optimized.metadata,
    }];
  }

  // ── GLB: optimize + measure (compressed re-export). GLTF: passthrough. ──
  if (ext === "glb") {
    progress(0.3, "Reading GLB...");
    const data = new Uint8Array(await file.arrayBuffer());
    progress(0.6, "Optimizing mesh...");
    try {
      const optimized = await optimizeAndMeasure(data);
      progress(1, "Ready to upload");
      return [{
        originalName: file.name,
        outputName: file.name,
        data: optimized.bytes,
        contentType: "model/gltf-binary",
        converted: optimized.bytes.byteLength !== data.byteLength,
        metadata: optimized.metadata,
      }];
    } catch (e) {
      console.warn(`[AssetConverter] GLB optimize failed; passing through:`, e);
      progress(1, "Ready to upload");
      return [{
        originalName: file.name,
        outputName: file.name,
        data,
        contentType: "model/gltf-binary",
        converted: false,
      }];
    }
  }
  if (ext === "gltf") {
    progress(1, "Ready to upload");
    const data = new Uint8Array(await file.arrayBuffer());
    return [{
      originalName: file.name,
      outputName: file.name,
      data,
      contentType: "model/gltf+json",
      converted: false,
    }];
  }

  // ── Images: passthrough ──
  if (IMAGE_EXTENSIONS.has(ext)) {
    progress(1, "Ready to upload");
    const data = new Uint8Array(await file.arrayBuffer());
    return [{
      originalName: file.name,
      outputName: file.name,
      data,
      contentType: file.type || "application/octet-stream",
      converted: false,
    }];
  }

  // ── JSON: passthrough ──
  if (ext === "json") {
    progress(1, "Ready to upload");
    const data = new Uint8Array(await file.arrayBuffer());
    return [{
      originalName: file.name,
      outputName: file.name,
      data,
      contentType: "application/json",
      converted: false,
    }];
  }

  throw new Error(`Unsupported file type: .${ext}`);
}
