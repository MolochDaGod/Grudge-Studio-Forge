/**
 * GLB binary container decoder.
 *
 * GLB layout (glTF 2.0 binary):
 *   12-byte header: magic ("glTF" = 0x46546C67), version (uint32), length (uint32)
 *   one or more chunks:
 *     chunkLength (uint32)
 *     chunkType   (uint32) — "JSON" = 0x4E4F534A, "BIN\0" = 0x004E4942
 *     chunkData   (chunkLength bytes)
 *
 * This module decodes the container in pure JS (no three.js) so we can show a
 * file-inspector dialog before deciding to add the asset to the scene.
 */

export interface GlbInfo {
  magic: string;
  version: number;
  totalLength: number;
  json: {
    size: number;
    keys: string[];
    counts: {
      nodes: number;
      meshes: number;
      primitives: number;
      materials: number;
      textures: number;
      images: number;
      animations: number;
      scenes: number;
      buffers: number;
      bufferViews: number;
      accessors: number;
      skins: number;
    };
    asset?: { version?: string; generator?: string; copyright?: string };
    /** First 24 bytes of the raw JSON, useful for a "preview" line. */
    preview: string;
  };
  bin: { size: number } | null;
  /** Hex dump of the first 16 bytes of the file header, for the inspector UI. */
  headerHex: string;
}

const MAGIC_GLTF = 0x46546c67; // "glTF" (little-endian read)
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

function fourCC(n: number): string {
  return String.fromCharCode(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
}

function hexDump(buf: ArrayBuffer, max = 16): string {
  const view = new Uint8Array(buf, 0, Math.min(max, buf.byteLength));
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/**
 * Inspect a GLB file. Throws a descriptive Error if the file is not a valid GLB.
 */
export function inspectGlb(buffer: ArrayBuffer): GlbInfo {
  if (buffer.byteLength < 12) {
    throw new Error(`File too short (${buffer.byteLength} bytes) to be a GLB`);
  }
  const dv = new DataView(buffer);
  const magic = dv.getUint32(0, true);
  if (magic !== MAGIC_GLTF) {
    throw new Error(
      `Not a GLB file — magic was 0x${magic.toString(16)} ("${fourCC(magic)}"), expected "glTF"`,
    );
  }
  const version = dv.getUint32(4, true);
  const totalLength = dv.getUint32(8, true);

  // Walk chunks
  let offset = 12;
  let jsonChunk: { size: number; data: Uint8Array } | null = null;
  let binChunk: { size: number } | null = null;

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > buffer.byteLength) {
      throw new Error(
        `Chunk overruns file (chunk @${offset} length=${chunkLength}, file=${buffer.byteLength})`,
      );
    }
    if (chunkType === CHUNK_JSON && !jsonChunk) {
      jsonChunk = {
        size: chunkLength,
        data: new Uint8Array(buffer, dataStart, chunkLength),
      };
    } else if (chunkType === CHUNK_BIN && !binChunk) {
      binChunk = { size: chunkLength };
    }
    offset = dataEnd;
  }

  if (!jsonChunk) throw new Error("GLB has no JSON chunk");

  // Decode JSON chunk (UTF-8, may be padded with 0x20 spaces)
  const text = new TextDecoder("utf-8").decode(jsonChunk.data).replace(/\0+$/g, "").trim();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `JSON chunk did not parse: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const arrLen = (k: string): number => {
    const v = parsed[k];
    return Array.isArray(v) ? v.length : 0;
  };

  // Count primitives across all meshes (a single mesh can have many submeshes)
  let primitives = 0;
  if (Array.isArray(parsed.meshes)) {
    for (const m of parsed.meshes as Array<{ primitives?: unknown[] }>) {
      if (Array.isArray(m?.primitives)) primitives += m.primitives.length;
    }
  }

  const asset = (parsed.asset ?? {}) as { version?: string; generator?: string; copyright?: string };

  return {
    magic: fourCC(magic),
    version,
    totalLength,
    json: {
      size: jsonChunk.size,
      keys: Object.keys(parsed),
      counts: {
        nodes: arrLen("nodes"),
        meshes: arrLen("meshes"),
        primitives,
        materials: arrLen("materials"),
        textures: arrLen("textures"),
        images: arrLen("images"),
        animations: arrLen("animations"),
        scenes: arrLen("scenes"),
        buffers: arrLen("buffers"),
        bufferViews: arrLen("bufferViews"),
        accessors: arrLen("accessors"),
        skins: arrLen("skins"),
      },
      asset: {
        version: asset.version,
        generator: asset.generator,
        copyright: asset.copyright,
      },
      preview: text.slice(0, 96),
    },
    bin: binChunk,
    headerHex: hexDump(buffer, 16),
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
