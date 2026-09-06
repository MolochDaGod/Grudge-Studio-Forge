import { describe, expect, it } from "vitest";
import { childCount, parentPath, wouldCycle } from "../hierarchy";
import type { SceneEntity } from "@/scene/types";
import { DEFAULT_TRANSFORM } from "@/scene/types";

function ent(id: string, name: string, parentId: string | null = null): SceneEntity {
  return {
    id,
    name,
    type: "empty",
    parentId,
    transform: DEFAULT_TRANSFORM(),
  };
}

describe("hierarchy identity", () => {
  const ents = [ent("a", "Island"), ent("b", "Dock", "a"), ent("c", "Crate", "b")];

  it("prints parent › child path", () => {
    expect(parentPath(ents, "c")).toBe("Island › Dock › Crate");
    expect(parentPath(ents, "a")).toBe("Island");
  });

  it("counts direct children", () => {
    expect(childCount(ents, "a")).toBe(1);
    expect(childCount(ents, "c")).toBe(0);
  });

  it("refuses cyclic reparent", () => {
    expect(wouldCycle(ents, "a", "c")).toBe(true);
    expect(wouldCycle(ents, "c", null)).toBe(false);
  });

  it("keeps pulled mesh parent › child identity", () => {
    const pack: SceneEntity = {
      id: "pack",
      name: "NatureKit",
      type: "model",
      parentId: null,
      transform: DEFAULT_TRANSFORM(),
      model: { url: "https://assets.grudge-studio.com/nature.glb", childrenOnly: true },
    };
    const crate: SceneEntity = {
      id: "crate",
      name: "Crate",
      type: "model",
      parentId: "pack",
      transform: DEFAULT_TRANSFORM(),
      model: { url: pack.model!.url, subNode: "Crate" },
    };
    const lid: SceneEntity = {
      id: "lid",
      name: "Lid",
      type: "model",
      parentId: "crate",
      transform: DEFAULT_TRANSFORM(),
      model: { url: pack.model!.url, subNode: "Lid" },
    };
    const pulled = [pack, crate, lid];
    expect(parentPath(pulled, "lid")).toBe("NatureKit › Crate › Lid");
    expect(childCount(pulled, "pack")).toBe(1);
    expect(childCount(pulled, "crate")).toBe(1);
  });
});
