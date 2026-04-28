/**
 * File-kind classifier for the asset drop zone.
 *
 * Lives in its own tiny, dependency-free module so the eagerly-loaded
 * `AssetDropZone` doesn't pull in `three.js` (via `lib/converters.ts`'s
 * `OBJLoader` / `GLTFExporter`) just to know what extension was dropped.
 * The actual conversion code is lazy-loaded only when an .obj file lands.
 */
export type DroppedFileKind =
  | "glb"
  | "gltf"
  | "obj"
  | "image"
  | "audio"
  | "scene-json";

export function classifyDroppedFile(file: File): DroppedFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".glb")) return "glb";
  if (name.endsWith(".gltf")) return "gltf";
  if (name.endsWith(".obj")) return "obj";
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
