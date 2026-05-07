/**
 * Lazy navmesh hydration — `ensureNavmeshBlob` must return cached
 * bytes when present and otherwise re-fetch the persisted blob from
 * the server using `navmeshBlobKey`. This is the path that keeps
 * `bake_navmesh` results alive across a hard reload (Task #66): once
 * the bake has uploaded to R2, the AI nav tools / debug overlay can
 * pick up a fresh session without forcing the user to re-bake.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ensureNavmeshBlob, getCachedBlob } from "@/lib/navmeshBake";

beforeEach(() => {
  if (typeof (globalThis as { window?: unknown }).window === "undefined") {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  }
  delete (window as unknown as { __navmeshBlobs?: unknown }).__navmeshBlobs;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureNavmeshBlob", () => {
  it("returns the cached blob without touching the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("fetch should not be called when cached"),
    );
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const w = window as unknown as { __navmeshBlobs?: Map<number, Uint8Array> };
    w.__navmeshBlobs = new Map([[42, bytes]]);

    const out = await ensureNavmeshBlob(42, "deadbeefcafebabe", 7);
    expect(out).toBe(bytes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when the cache is empty and there is no blobKey to hydrate from", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await ensureNavmeshBlob(99, null, 7);
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches from /api/navmesh/blob/:key on a cache miss and re-populates the cache", async () => {
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(payload, { status: 200, headers: { "Content-Type": "application/octet-stream" } }),
      );
    // FNV-1a("abc123") — derived inside navmeshBake. We verify the
    // numeric id matches what the bake step would have stored on
    // Environment.navmeshAssetId so the find_path / overlay code
    // paths line up.
    const blobKey = "abc123";
    let h = 0x811c9dc5;
    for (let i = 0; i < blobKey.length; i++) {
      h ^= blobKey.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    const expectedAssetId = h >>> 0;

    const out = await ensureNavmeshBlob(expectedAssetId, blobKey, 17);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out!)).toEqual(Array.from(payload));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(`/api/navmesh/blob/${blobKey}`);
    expect(url).toContain("projectId=17");
    // Cache must have been re-populated under the same numeric id
    // the schema persists, so the next call short-circuits.
    expect(getCachedBlob(expectedAssetId)).toBeInstanceOf(Uint8Array);
  });

  it("returns null when the server says the blob is gone", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    const out = await ensureNavmeshBlob(123, "missingkey", 1);
    expect(out).toBeNull();
  });
});
