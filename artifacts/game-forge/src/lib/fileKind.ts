/**
 * File-kind classifier for the asset drop zone.
 *
 * Lives in its own tiny, dependency-free module so the eagerly-loaded
 * `AssetDropZone` doesn't pull in `three.js` (via `lib/assetConverter.ts`'s
 * loaders / `GLTFExporter`) just to know what extension was dropped. The
 * actual conversion code is lazy-loaded only when a 3D file lands.
 *
 * Parity with three.js editor loaders + Forge pipeline:
 *   docs/THREEJS_EDITOR_PARITY.md §4 · skill threejs-asset-io
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
  | "scene-json"
  /** Planned converters — classified for UX messaging until loaders ship. */
  | "ply"
  | "dae"
  | "usdz";

/** Source-3D kinds that need converting to GLB before upload (implemented). */
export const CONVERTIBLE_3D_KINDS: ReadonlySet<DroppedFileKind> = new Set([
  "obj",
  "fbx",
  "stl",
]);

/** Formats we recognize but do not convert in-browser yet. */
export const PLANNED_3D_KINDS: ReadonlySet<DroppedFileKind> = new Set([
  "ply",
  "dae",
  "usdz",
]);

/** Human-readable pipeline notes for UI / AI. */
export const FILE_KIND_PIPELINE: Record<
  DroppedFileKind,
  { label: string; pipeline: string; implemented: boolean }
> = {
  glb: {
    label: "glTF Binary",
    pipeline: "meshopt optimize → R2 + .meta.json",
    implemented: true,
  },
  gltf: {
    label: "glTF JSON",
    pipeline: "GLTFLoader → GLTFExporter binary → meshopt → R2",
    implemented: true,
  },
  obj: {
    label: "Wavefront OBJ",
    pipeline: "OBJ+MTL → GLB → meshopt (ZIP for textures)",
    implemented: true,
  },
  fbx: {
    label: "Autodesk FBX",
    pipeline: "FBXLoader → GLB → meshopt",
    implemented: true,
  },
  stl: {
    label: "STL mesh",
    pipeline: "STLLoader + default material → GLB → meshopt",
    implemented: true,
  },
  zip: {
    label: "Archive",
    pipeline: "Extract → convert each 3D file / attach MTL siblings",
    implemented: true,
  },
  image: {
    label: "Texture / image",
    pipeline: "Passthrough upload (png/jpg/webp/ktx2)",
    implemented: true,
  },
  audio: {
    label: "Audio",
    pipeline: "Passthrough upload",
    implemented: true,
  },
  "scene-json": {
    label: "Forge scene",
    pipeline: "Parse SceneData (.gfscene.json) → replace live scene",
    implemented: true,
  },
  ply: {
    label: "Stanford PLY",
    pipeline: "Planned: PLYLoader → GLB (use desktop Assimp interim)",
    implemented: false,
  },
  dae: {
    label: "Collada DAE",
    pipeline: "Planned: ColladaLoader → GLB",
    implemented: false,
  },
  usdz: {
    label: "Apple USDZ",
    pipeline: "Planned: desktop convert → GLB",
    implemented: false,
  },
};

export function classifyDroppedFile(file: File): DroppedFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".glb")) return "glb";
  if (name.endsWith(".gltf")) return "gltf";
  if (name.endsWith(".obj")) return "obj";
  if (name.endsWith(".fbx")) return "fbx";
  if (name.endsWith(".stl")) return "stl";
  if (name.endsWith(".ply")) return "ply";
  if (name.endsWith(".dae")) return "dae";
  if (name.endsWith(".usdz")) return "usdz";
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
