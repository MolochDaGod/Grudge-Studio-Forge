import type { useViewportTabs } from "@/store/viewportTabs";

type OpenTab = ReturnType<typeof useViewportTabs.getState>["openTab"];

/**
 * Lowercase extension of a filename, with the dot stripped. Returns ""
 * for files without an extension.
 */
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Friendly file kinds the viewer + Convert tab know how to handle. */
const SUPPORTED_EXTS = new Set([
  "glb",
  "gltf",
  "obj",
  "fbx",
  "zip",
  "asset",
  "prefab",
  "gfscene",
]);

/** Returns true if our viewer / convert tab can usefully accept this
 *  filename (extension-based check; mime-types from the OS are unreliable
 *  for game-engine formats like .asset / .prefab). */
export function isSupportedModelFile(name: string): boolean {
  return SUPPORTED_EXTS.has(extOf(name));
}

/**
 * Open a File / Blob in a fresh model-viewer tab. The tab owns the blob
 * URL and revokes it on close (see `useViewportTabs`'s `closeTab`), so
 * callers can fire-and-forget.
 *
 * For obviously-incompatible extensions we route to a Convert tab
 * instead so the user gets feedback immediately rather than a dead "tab
 * shows nothing" state.
 */
export function openModelTabFromFile(
  file: File,
  openTab: OpenTab,
): string {
  const ext = extOf(file.name);
  const blobUrl = URL.createObjectURL(file);

  if (ext === "glb" || ext === "gltf" || ext === "obj") {
    return openTab({
      kind: "model",
      data: {
        name: file.name,
        blobUrl,
        ext,
        size: file.size,
      },
    });
  }

  // Anything else worth recognising goes to a Convert tab.
  return openTab({
    kind: "convert",
    data: {
      files: [{ name: file.name, ext, blobUrl, size: file.size }],
    },
  });
}

/**
 * Open an already-uploaded asset (object storage URL) in a fresh model
 * viewer tab. Dedupes by URL so re-opening the same asset focuses the
 * existing tab rather than spawning a duplicate Canvas.
 */
export function openModelTabFromAsset(
  args: { name: string; url: string },
  openTab: OpenTab,
): string {
  const ext = extOf(args.name);
  return openTab({
    kind: "model",
    data: {
      name: args.name,
      assetUrl: args.url,
      ext: ext || "glb",
    },
  });
}
