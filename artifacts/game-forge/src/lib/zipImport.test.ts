import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractZipAssets } from "./zipImport";

function makeZip(files: Record<string, Uint8Array>): File {
  const bytes = zipSync(files);
  return new File([bytes], "pack.zip", { type: "application/zip" });
}

describe("extractZipAssets", () => {
  it("extracts importable assets and skips the rest", async () => {
    const zip = makeZip({
      "models/hero.glb": new Uint8Array([1, 2, 3]),
      "textures/skin.png": new Uint8Array([4, 5, 6]),
      "audio/step.mp3": new Uint8Array([7, 8, 9]),
      "readme.txt": strToU8("hello"),
      "notes.blend": new Uint8Array([0]),
    });

    const { entries, skipped } = await extractZipAssets(zip);

    const kinds = entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(["audio", "glb", "image"]);
    // entries get flattened to their basename
    expect(entries.find((e) => e.kind === "glb")?.file.name).toBe("hero.glb");
    expect(skipped).toContain("readme.txt");
    expect(skipped).toContain("notes.blend");
  });

  it("rejects archives with too many entries", async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5001; i++) files[`f${i}.txt`] = new Uint8Array([1]);
    await expect(extractZipAssets(makeZip(files))).rejects.toThrow(
      /too many entries/,
    );
  });

  it("ignores macOS metadata and nested zips", async () => {
    const zip = makeZip({
      "__MACOSX/._hero.glb": new Uint8Array([1]),
      ".DS_Store": new Uint8Array([1]),
      "real.glb": new Uint8Array([1, 2]),
      "inner.zip": new Uint8Array([3, 4]),
    });

    const { entries, skipped } = await extractZipAssets(zip);

    expect(entries).toHaveLength(1);
    expect(entries[0].file.name).toBe("real.glb");
    // nested zip is skipped (we don't recurse), macOS junk is dropped silently
    expect(skipped).toContain("inner.zip");
    expect(skipped.some((s) => s.includes("__MACOSX"))).toBe(false);
  });
});
