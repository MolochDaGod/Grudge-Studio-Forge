---
name: threejs-asset-io
description: Reference for loading and exporting 3D assets in three.js — GLTFLoader, GLTFExporter, DRACOLoader, FBXLoader, OBJ+MTL, STL — and the Grudge Studio canonical pipeline (FBX/OBJ/STL/glTF → meshopt-compressed GLB + .meta.json sidecar). Use whenever importing user assets, exporting from the editor, choosing compression (Draco vs meshopt vs KTX2), or wiring the AssetDropZone / Library panel to new formats. Pegged to `artifacts/game-forge/src/lib/assetConverter.ts` and `artifacts/game-forge/src/editor/AssetDropZone.tsx`.
---

# Three.js Asset I/O — Grudge Studio Pipeline

The Forge editor has one canonical asset format: **binary GLB (glTF 2.0)** with `EXT_meshopt_compression`. Everything else is converted on the way in. This skill documents the loaders, the exporter, and the post-process compression layer that already exist in the repo.

Source of truth: `artifacts/game-forge/src/lib/assetConverter.ts`.

---

## 1. The canonical pipeline (already wired)

```
User drag-drop  ──►  AssetDropZone.tsx
                          │
                          ▼
                 convertFile() in assetConverter.ts
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   FBXLoader /        GLTFLoader /     passthrough
   OBJLoader+MTL /    STLLoader /        (.png/.jpg/.webp/.json)
   STLLoader          (in-memory)
        │                 │
        └────────►  GLTFExporter (binary, embedImages) ─►  raw GLB
                                                              │
                                                              ▼
                                                   optimizeAndMeasure()
                                                   = gltf-transform:
                                                       dedup() + prune()
                                                     + weld(0.0001)
                                                     + meshopt({level:"medium"})
                                                              │
                                                              ▼
                                                ConvertedAsset { data, metadata }
                                                              │
                                                              ▼
                                              R2 upload + sibling .meta.json
```

Output keying convention (`projectConventions.ts` + `r2Storage.ts`):
- Asset:    `user-assets/<projectId>/<sha256-12>-<slug>.glb`     `model/gltf-binary`
- Metadata: `user-assets/<projectId>/<sha256-12>-<slug>.glb.meta.json`  `application/json`
- Thumb:    `user-assets/<projectId>/<sha256-12>-<slug>.thumb.webp`     `image/webp`

---

## 2. Loaders — which to use

| Format | Loader | Source                                                          | Notes |
| ------ | ------ | --------------------------------------------------------------- | ----- |
| `.glb` / `.gltf` | `GLTFLoader`  | `three/addons/loaders/GLTFLoader.js` or `three-stdlib`      | Primary loader. Auto-handles Draco + meshopt if their decoders are registered. |
| `.fbx` | `FBXLoader`   | `three-stdlib`                                                | Heavyweight (binary or ASCII FBX). Already used in the converter. |
| `.obj` + `.mtl` | `OBJLoader` + `MTLLoader` | `three-stdlib`                                  | Use the `LoadingManager` + blob-URL resolver pattern in `assetConverter.ts` to attach sibling MTL/textures from a ZIP. |
| `.stl` | `STLLoader`   | `three-stdlib`                                                | Returns a `BufferGeometry` — wrap in a Mesh with a default material before exporting. |
| `.draco` (mesh extension) | `DRACOLoader` attached to GLTFLoader | `three/addons/loaders/DRACOLoader.js` | Decoder JS is ~300 KB; load on demand. |
| `.ktx2` (texture extension) | `KTX2Loader` attached to GLTFLoader | `three/addons/loaders/KTX2Loader.js`     | Decoder is ~600 KB + WebGL ext detection. |

Lazy-load loaders with dynamic `import()` so the editor cold-start doesn't pay for FBX support unless someone actually drops an FBX.

---

## 3. GLTFExporter — the only exporter

```ts
const exporter = new GLTFExporter();
exporter.parse(
  root,
  (out) => { /* out is ArrayBuffer when binary:true */ },
  (err) => reject(err),
  { binary: true, embedImages: true, onlyVisible: false },
);
```

Options that matter for our pipeline:
- `binary: true` → emit `.glb` (one file, fewer round-trips than `.gltf`+`.bin`+textures).
- `embedImages: true` → textures live inside the GLB. Required for our object-storage flow.
- `onlyVisible: false` → export hidden helpers too **only if** they carry game data (rare; default `true` is right for normal models).
- `animations: [...]` → if you cloned a skinned mesh and want to preserve clips, pass them explicitly (they aren't auto-discovered from a detached scene root).

Strip Three.js-only properties (helpers, gizmos, debug overlays) before exporting — they bloat the GLB and confuse downstream consumers (Babylon runtime, model-viewer).

---

## 4. Compression: meshopt vs Draco vs KTX2

| Layer    | Codec               | Ratio | Bundle cost | Where applied |
| -------- | ------------------- | ----- | ----------- | ------------- |
| Geometry | `EXT_meshopt_compression` | 5–10× | ~50 KB encoder (already imported) | **Browser, on import** — `optimizeAndMeasure()` |
| Geometry | `KHR_draco_mesh_compression` | 10–15× | ~300 KB decoder | Not in browser path; desktop bridge or offline only |
| Textures | `KHR_texture_basisu` (KTX2) | 4–6× | ~3 MB WASM encoder | Desktop bridge only (Electron) |

**Rule:** in the browser, only `meshopt` runs. KTX2 / Draco are too heavy to ship in the editor bundle. Desktop builds (`artifacts/game-forge-desktop/`) can layer them on later.

Loaders consuming the GLB must register the decoders if you ever opt into Draco or KTX2:

```ts
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);    // for our meshopt-encoded GLBs
// gltfLoader.setDRACOLoader(dracoLoader);       // only if desktop pipeline added it
// gltfLoader.setKTX2Loader(ktx2Loader);
```

The Forge already calls `setMeshoptDecoder` in its scene loader path; check `EntityRenderer.tsx` / model surface code before adding a second registration.

---

## 5. AssetMetadata — what the Library panel needs

`optimizeAndMeasure()` extracts and returns this alongside the bytes:

```ts
interface AssetMetadata {
  triangles: number;        // sum of indexed-tri counts across all primitives
  vertices: number;         // sum of position-accessor counts
  meshes: number;           // distinct Mesh nodes
  bones: number;            // unique Bone count across SkinnedMeshes
  animations: string[];     // clip names (empty if none)
  materials: string[];      // unique material names
  bbox: { min: [x,y,z]; max: [x,y,z] };
  hasTextures: boolean;
}
```

Write it as a sibling `.meta.json` next to the GLB so the Library panel can show counts without re-parsing the binary. `AssetDropZone.tsx` already has the `uploadMetaSidecar` helper for this.

---

## 6. Gotchas

- **Animations and detached scenes**: `GLTFExporter` does **not** auto-find clips on a detached scene root. If you `SkeletonUtils.clone()` and then export, pass `animations: gltf.animations` explicitly.
- **Embedded textures get re-encoded** as PNG by default. Pre-resize before export if you care about size; the desktop bridge can KTX2 them.
- **OBJ + MTL + textures need a LoadingManager** with a URL resolver — see `assetConverter.ts` for the blob-URL pattern that makes ZIP imports work.
- **GLB validator**: when something breaks, drop the file into <https://github.khronos.org/glTF-Validator/> before debugging our code.
- **Big files (>200 MB)**: stream the upload (`r2Storage.ts` does multi-part) — don't try to base64 a 200 MB GLB into a JSON request.

---

## See also

- `forge-editor` — where AssetDropZone, Library, R2 wiring all live.
- `animation-and-skinned-meshes` — for what to do *after* a skinned GLB is loaded.
- `puter` — for the alt path (Puter cloud) where user-pays storage replaces R2.
