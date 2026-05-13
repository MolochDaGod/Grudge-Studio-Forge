import { describe, expect, it } from "vitest";
import { buildPrefabPayloadFromModelAsset } from "../forgeFromAsset";

describe("buildPrefabPayloadFromModelAsset", () => {
  it("builds a single-entity prefab whose root references the asset url", () => {
    const { name, payload } = buildPrefabPayloadFromModelAsset({
      assetName: "Hero.glb",
      url: "https://cdn.example/hero.glb",
    });
    expect(name).toBe("Forge: Hero.glb");
    expect(payload.entities).toHaveLength(1);
    const root = payload.entities![0]!;
    expect(root.type).toBe("model");
    expect(root.name).toBe("Hero.glb");
    expect(root.model?.url).toBe("https://cdn.example/hero.glb");
    // `rootId` MUST point at the entity we just created — the prefab
    // editor uses this to identify the boundary of the prefab. A
    // mismatched rootId would render the buffer headless.
    expect(payload.rootId).toBe(root.id);
  });

  it("places the root at the origin with identity rotation / unit scale", () => {
    // A "Forge"d model should land in a predictable spot so the user
    // sees their model immediately. Off-origin or non-identity rotation
    // would force the user to fix the transform before doing anything.
    const { payload } = buildPrefabPayloadFromModelAsset({
      assetName: "Crate.glb",
      url: "/u/crate.glb",
    });
    const root = payload.entities![0]!;
    expect(root.transform.position).toEqual([0, 0, 0]);
    expect(root.transform.rotation).toEqual([0, 0, 0]);
    expect(root.transform.scale).toEqual([1, 1, 1]);
  });

  it("never silently flags the new prefab as the project's player", () => {
    // Regression guard: a freshly-forged glb must NOT inherit the
    // 'isPlayerPrefab' flag, otherwise `togglePlay()` would auto-spawn
    // an arbitrary visual model in place of the user's actual player
    // prefab the next time they press Play.
    const { payload } = buildPrefabPayloadFromModelAsset({
      assetName: "Foo",
      url: "/u/foo.glb",
    });
    expect(payload.isPlayerPrefab).toBe(false);
  });

  it("falls back to a placeholder name when the asset name is blank or whitespace", () => {
    // Avoids rendering `Forge: ` (trailing space) in the list — looks
    // broken and is hard to find via the search box.
    for (const blank of ["", "   ", "\n\t"]) {
      const { name, payload } = buildPrefabPayloadFromModelAsset({
        assetName: blank,
        url: "/u/x.glb",
      });
      expect(name).toBe("Forge: Model");
      expect(payload.entities![0]!.name).toBe("Model");
    }
  });

  it("gives every invocation a unique root id", () => {
    // Two `Forge` actions in a row must not collide — otherwise
    // mutating one prefab in the sub-scene would silently mutate the
    // other in any caller that joins them on `entity.id`.
    const a = buildPrefabPayloadFromModelAsset({ assetName: "A", url: "/a.glb" });
    const b = buildPrefabPayloadFromModelAsset({ assetName: "B", url: "/b.glb" });
    expect(a.payload.rootId).not.toBe(b.payload.rootId);
  });
});
