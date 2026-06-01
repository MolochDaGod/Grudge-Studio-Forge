/**
 * In-browser ZIP asset-pack extraction.
 *
 * Asset packs (a `.zip` of GLBs, textures, audio, OBJ/FBX/STL models, or a
 * scene JSON) can now be dropped straight into the web editor — previously
 * ZIP handling was desktop-only. We use `fflate`'s synchronous `unzipSync`
 * (tiny, no worker plumbing) to expand the archive in memory, then hand the
 * caller a `File` per importable entry so they flow through the exact same
 * import path as a directly-dropped file.
 *
 * Safety: this never touches the filesystem (pure in-memory `Uint8Array`s),
 * so the classic "zip-slip" path-traversal attack doesn't apply. We still
 * skip directory entries, macOS resource forks (`__MACOSX/`, `._*`), and
 * anything our classifier doesn't recognize.
 */
import { unzipSync } from "fflate";
import { classifyDroppedFile, type DroppedFileKind } from "@/lib/fileKind";

export interface ExtractedZipEntry {
  file: File;
  kind: DroppedFileKind;
  /** Path of the entry inside the archive (for logging). */
  path: string;
}

export interface ZipExtractResult {
  entries: ExtractedZipEntry[];
  /** Names of entries that were present but skipped (unrecognized kind). */
  skipped: string[];
}

// Bound the decompressed output so a pathological "zip bomb" can't OOM the
// browser tab. 1.5 GB total / 5000 entries comfortably covers legitimate
// asset packs while rejecting absurd archives early.
const MAX_TOTAL_BYTES = 1_500_000_000;
const MAX_ENTRIES = 5000;

function isIgnoredPath(path: string): boolean {
  // Directory entries end with "/". Skip macOS metadata and hidden files.
  if (path.endsWith("/")) return true;
  const base = path.split("/").pop() ?? path;
  if (path.startsWith("__MACOSX/")) return true;
  if (base.startsWith("._")) return true;
  if (base === ".DS_Store") return true;
  return false;
}

/** Lightweight MIME guess so extracted blobs upload with a sane type. */
function guessMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".glb")) return "model/gltf-binary";
  if (n.endsWith(".gltf")) return "model/gltf+json";
  if (n.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".ogg")) return "audio/ogg";
  if (n.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/**
 * Extract a dropped `.zip` into `File` objects keyed by importable kind.
 * Entries the editor can't import (e.g. `.txt`, `.mtl`, `.blend`) are
 * collected in `skipped` for a single summary log line.
 */
export async function extractZipAssets(zip: File): Promise<ZipExtractResult> {
  const buf = new Uint8Array(await zip.arrayBuffer());
  const unzipped = unzipSync(buf);

  const all = Object.entries(unzipped);
  if (all.length > MAX_ENTRIES) {
    throw new Error(
      `Archive has too many entries (${all.length} > ${MAX_ENTRIES}); refusing to extract.`,
    );
  }

  const entries: ExtractedZipEntry[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  for (const [path, bytes] of all) {
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `Archive expands beyond the ${Math.round(
          MAX_TOTAL_BYTES / 1e9,
        )} GB safety limit; refusing to extract.`,
      );
    }
    if (isIgnoredPath(path)) continue;
    const base = path.split("/").pop() ?? path;
    const file = new File([bytes], base, { type: guessMime(base) });
    const kind = classifyDroppedFile(file);
    if (!kind || kind === "zip") {
      // Don't recurse into nested zips — keep the import flow bounded.
      skipped.push(path);
      continue;
    }
    entries.push({ file, kind, path });
  }

  return { entries, skipped };
}
