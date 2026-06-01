/**
 * Legacy converter facade — superseded by `lib/assetConverter.ts`.
 *
 * Historically this module owned the OBJ→GLB path while FBX/STL/ZIP went
 * through a separate `assetConverter.ts` (which previously used an
 * `assimpjs` WASM module). The two paths have now been unified behind
 * `assetConverter.convertFile`, which uses `three-stdlib` loaders +
 * `GLTFExporter` for every supported 3D format.
 *
 * This file is kept as a thin facade so the existing
 * `import { objToGlb } from "@/lib/converters"` callsite in
 * `AssetDropZone.tsx` (and any other downstream consumer) keeps compiling.
 * New code should call `convertFile` from `@/lib/assetConverter` directly.
 */
import { convertFile } from "@/lib/assetConverter";

export { classifyDroppedFile, type DroppedFileKind } from "@/lib/fileKind";

/**
 * Parse an OBJ source (text) and re-encode it as a GLB blob. Delegates to
 * the unified `convertFile` pipeline so MTL + textures shipped alongside
 * the OBJ (via a ZIP drop) are honoured. When called with raw text the
 * caller is responsible for picking up any siblings separately.
 */
export async function objToGlb(text: string, fileName: string): Promise<File> {
  const file = new File([new TextEncoder().encode(text)], fileName, {
    type: "model/obj",
  });
  const [result] = await convertFile(file);
  if (!result) throw new Error("OBJ conversion produced no output");
  return new File([result.data as BlobPart], result.outputName, {
    type: result.contentType,
  });
}
