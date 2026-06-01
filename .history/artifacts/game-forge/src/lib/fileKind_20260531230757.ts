/**
 * File-kind classifier for the asset drop zone.
 *
 * Lives in its own tiny, dependency-free module so the eagerly-loaded
 * `AssetDropZone` doesn't pull in `three.js` (via `lib/assetConverter.ts`'s
 * loaders / `GLTFExporter`) just to know what extension was dropped. The
 * actual conversion code is lazy-loaded only when a 3D file lands.
 */
export type DroppedFileKind =
  | "glb"
  | "gltf"
  | "obj"
  | "fbx"
  | "stl"
  | "zip"
  | "image"
  | "audio"
  | "scene-json";

/** Source-3D kinds that need converting to GLB before upload. */
export const CONVERTIBLE_3D_KINDS: ReadonlySet<DroppedFileKind> = new Set([
  "obj",
  "fbx",
  "stl",
]);

export function classifyDroppedFile(file: File): DroppedFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".glb")) return "glb";
  if (name.endsWith(".gltf")) return "gltf";
  if (name.endsWith(".obj")) return "obj";
  if (name.endsWith(".fbx")) return "fbx";
  if (name.endsWith(".stl")) return "stl";
  if (name.endsWith(".zip")) return "zip";
  if (/\.(png|jpe?g|webp|gif|bmp|ktx2)$/.test(name)) return "image";
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(name)) return "audio";
  if (
    name.endsWith(".json") ||
    name.endsWith(".gfscene") ||
    name.endsWith(".gfscene.json")
  )
    return "scene-json";
  return null;
}
