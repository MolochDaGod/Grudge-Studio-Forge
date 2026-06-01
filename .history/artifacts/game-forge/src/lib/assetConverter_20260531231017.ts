/**
 * Browser-side asset conversion pipeline.
 *
 * Converts FBX, OBJ, STL, glTF → GLB using three.js + GLTFExporter via the
 * already-installed `three-stdlib` loaders. ZIP files are extracted with
 * `fflate` and each contained 3D file is converted individually; sibling
 * MTL / texture files in the same archive are auto-attached to OBJ
 * conversions through an in-memory blob: URL resolver.
 *
 * Supported input → output:
 *   .fbx  → .glb   (three-stdlib FBXLoader → GLTFExporter)
 *   .obj  → .glb   (three-stdlib OBJLoader + MTLLoader → GLTFExporter)
 *   .stl  → .glb   (three-stdlib STLLoader → GLTFExporter)
 *   .gltf → .glb   (three-stdlib GLTFLoader → GLTFExporter, embeds textures)
 *   .glb  → .glb   (passthrough)
 *   .zip  → .glb[] (extract + convert each 3D file found inside)
 *   .png/.jpg/.webp/.json → passthrough (direct upload, no conversion)
 *
 * Usage:
 *   import { convertFile, isSupportedFile, SUPPORTED_EXTENSIONS } from "@/lib/assetConverter";
 *   const result = await convertFile(file, (progress, message) => { ... });
 */
import { unzipSync } from "fflate";

// ── Types ────────────────────────────────────────────────────────────

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

// ── Assimp WASM loader (lazy, cached) ────────────────────────────────

interface AssimpFile {
  GetPath(): string;
  GetContent(): Uint8Array;
}
interface AssimpResult {
  IsSuccess(): boolean;
  GetErrorCode(): string;
  FileCount(): number;
  GetFile(i: number): AssimpFile;
}
interface AssimpFileList {
  AddFile(name: string, data: Uint8Array): void;
}
interface AssimpModule {
  FileList: new () => AssimpFileList;
  ConvertFileList(list: AssimpFileList, fmt: string): AssimpResult;
}

let _assimpPromise: Promise<AssimpModule> | null = null;

async function loadAssimp(): Promise<AssimpModule> {
  if (!_assimpPromise) {
    _assimpPromise = (async () => {
      // Dynamic import — assimpjs ships a UMD factory that returns a Promise.
      // No @types/assimpjs exists; we cast through `unknown`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await (import("assimpjs" as string) as Promise<unknown>);
      const factory = mod.default ?? mod;
      return (await factory()) as AssimpModule;
    })();
  }
  return _assimpPromise;
}

// ── Core conversion ──────────────────────────────────────────────────

/** Convert a single 3D file (FBX/OBJ/STL) → GLB using assimpjs WASM. */
async function convertToGlb(
  filename: string,
  data: Uint8Array,
  siblings?: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  const ajs = await loadAssimp();
  const list = new ajs.FileList();
  list.AddFile(filename, data);

  // For OBJ files, add sibling MTL + texture files if available
  if (getExtension(filename) === "obj" && siblings) {
    for (const [name, buf] of siblings) {
      if (name === filename) continue;
      const ext = getExtension(name);
      if (ext === "mtl" || IMAGE_EXTENSIONS.has(ext)) {
        list.AddFile(name, buf);
      }
    }
  }

  const result = ajs.ConvertFileList(list, "glb2");
  if (!result.IsSuccess()) {
    throw new Error(`Conversion failed: ${result.GetErrorCode()}`);
  }
  if (result.FileCount() === 0) {
    throw new Error("Conversion produced no output");
  }
  return result.GetFile(0).GetContent();
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
          const glb = await convertToGlb(name, data, siblings);
          results.push({
            originalName: name,
            outputName: `${baseName(name)}.glb`,
            data: glb,
            contentType: "model/gltf-binary",
            converted: true,
          });
        } catch (e) {
          console.warn(`[AssetConverter] Skipping ${name}:`, e);
        }
      } else if (entryExt === "glb") {
        results.push({
          originalName: name,
          outputName: name,
          data,
          contentType: "model/gltf-binary",
          converted: false,
        });
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
    const glb = await convertToGlb(file.name, data);
    progress(1, "Conversion complete");
    return [{
      originalName: file.name,
      outputName: `${baseName(file.name)}.glb`,
      data: glb,
      contentType: "model/gltf-binary",
      converted: true,
    }];
  }

  // ── GLB/GLTF: passthrough ──
  if (ext === "glb" || ext === "gltf") {
    progress(1, "Ready to upload");
    const data = new Uint8Array(await file.arrayBuffer());
    return [{
      originalName: file.name,
      outputName: file.name,
      data,
      contentType: ext === "glb" ? "model/gltf-binary" : "model/gltf+json",
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
