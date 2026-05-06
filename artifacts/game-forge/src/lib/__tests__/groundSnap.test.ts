import { describe, it, expect } from "vitest";
import { Object3D } from "three";
import {
  applyGroundSnap,
  getEntitySurfaceTag,
  getObjectSurfaceTag,
  isGroundSnapModifierHeld,
  shouldGroundSnap,
} from "../groundSnap";

describe("isGroundSnapModifierHeld", () => {
  it("requires Shift AND (Ctrl or Meta)", () => {
    expect(isGroundSnapModifierHeld({ shiftKey: true, ctrlKey: true })).toBe(true);
    expect(isGroundSnapModifierHeld({ shiftKey: true, metaKey: true })).toBe(true);
  });

  it("returns false when shift is missing", () => {
    expect(isGroundSnapModifierHeld({ shiftKey: false, ctrlKey: true })).toBe(false);
    expect(isGroundSnapModifierHeld({ ctrlKey: true })).toBe(false);
  });

  it("returns false when neither Ctrl nor Meta is held", () => {
    expect(isGroundSnapModifierHeld({ shiftKey: true })).toBe(false);
    expect(isGroundSnapModifierHeld({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isGroundSnapModifierHeld({})).toBe(false);
  });
});

describe("applyGroundSnap", () => {
  it("overrides Y with the hit's Y, leaving X and Z untouched", () => {
    const o = new Object3D();
    o.position.set(5, 12, -3);
    const ok = applyGroundSnap(o, { point: [99, 0.5, 99] });
    expect(ok).toBe(true);
    expect(o.position.y).toBeCloseTo(0.5);
    expect(o.position.x).toBe(5);
    expect(o.position.z).toBe(-3);
  });

  it("supports negative ground heights (snap below origin)", () => {
    const o = new Object3D();
    o.position.set(0, 4, 0);
    applyGroundSnap(o, { point: [0, -2.5, 0] });
    expect(o.position.y).toBeCloseTo(-2.5);
  });

  it("is a no-op when hit is null", () => {
    const o = new Object3D();
    o.position.set(0, 7, 0);
    const ok = applyGroundSnap(o, null);
    expect(ok).toBe(false);
    expect(o.position.y).toBe(7);
  });
});

describe("shouldGroundSnap", () => {
  it("returns false when there is no hit", () => {
    expect(
      shouldGroundSnap({ hit: null, draggedEntitySurface: null }),
    ).toBe(false);
  });

  it("snaps an untagged prop onto walkable ground", () => {
    expect(
      shouldGroundSnap({
        hit: { point: [0, 0, 0], surface: "walk" },
        draggedEntitySurface: null,
      }),
    ).toBe(true);
  });

  it("treats untagged hits as walkable (mirrors groundProbe default)", () => {
    expect(
      shouldGroundSnap({
        hit: { point: [0, 0, 0] },
        draggedEntitySurface: null,
      }),
    ).toBe(true);
  });

  it("does NOT snap when the hit is on a non-walkable surface", () => {
    for (const s of ["climb", "swim", "slip", "damage", "nojump", "wall"]) {
      expect(
        shouldGroundSnap({
          hit: { point: [0, 0, 0], surface: s },
          draggedEntitySurface: null,
        }),
      ).toBe(false);
    }
  });

  it("does NOT snap when the dragged entity is itself walkable terrain", () => {
    expect(
      shouldGroundSnap({
        hit: { point: [0, 0, 0], surface: "walk" },
        draggedEntitySurface: "walk",
      }),
    ).toBe(false);
    expect(
      shouldGroundSnap({
        hit: { point: [0, 0, 0], surface: "terrain" },
        draggedEntitySurface: "terrain",
      }),
    ).toBe(false);
  });

  it("respects a custom walkable allow-list", () => {
    expect(
      shouldGroundSnap({
        hit: { point: [0, 0, 0], surface: "platform" },
        draggedEntitySurface: null,
        walkableSurfaces: ["platform"],
      }),
    ).toBe(true);
    expect(
      shouldGroundSnap({
        hit: { point: [0, 0, 0], surface: "walk" },
        draggedEntitySurface: null,
        walkableSurfaces: ["platform"],
      }),
    ).toBe(false);
  });
});

describe("getObjectSurfaceTag", () => {
  it("returns null for an empty/missing object", () => {
    expect(getObjectSurfaceTag(null)).toBe(null);
    expect(getObjectSurfaceTag(undefined)).toBe(null);
    expect(getObjectSurfaceTag(new Object3D())).toBe(null);
  });

  it("returns the tag stamped on the object itself", () => {
    const o = new Object3D();
    o.userData.surface = "walk";
    expect(getObjectSurfaceTag(o)).toBe("walk");
  });

  it("walks up the parent chain to find an ancestor's tag", () => {
    const root = new Object3D();
    root.userData.surface = "terrain";
    const mid = new Object3D();
    const leaf = new Object3D();
    root.add(mid);
    mid.add(leaf);
    expect(getObjectSurfaceTag(leaf)).toBe("terrain");
  });

  it("returns the nearest ancestor's tag when multiple exist", () => {
    const root = new Object3D();
    root.userData.surface = "terrain";
    const mid = new Object3D();
    mid.userData.surface = "walk";
    const leaf = new Object3D();
    root.add(mid);
    mid.add(leaf);
    expect(getObjectSurfaceTag(leaf)).toBe("walk");
  });
});

describe("getEntitySurfaceTag", () => {
  it("returns null for empty / missing objects", () => {
    expect(getEntitySurfaceTag(null)).toBe(null);
    expect(getEntitySurfaceTag(undefined)).toBe(null);
    expect(getEntitySurfaceTag(new Object3D())).toBe(null);
  });

  it("finds a tag stamped on a DESCENDANT (mirrors EntityRenderer's Map case)", () => {
    // EntityRenderer stamps `entityId` on the entity group but stamps
    // `surface` on the cloned model root that lives INSIDE that group.
    // ancestor-only lookup misses this; entity lookup must catch it.
    const entityGroup = new Object3D();
    entityGroup.userData.entityId = "map-1";
    const modelRoot = new Object3D();
    modelRoot.userData.surface = "walk";
    entityGroup.add(modelRoot);
    expect(getObjectSurfaceTag(entityGroup)).toBe(null);
    expect(getEntitySurfaceTag(entityGroup)).toBe("walk");
  });

  it("prefers the ancestor tag over a descendant tag (closer to the dragged object)", () => {
    const entityGroup = new Object3D();
    entityGroup.userData.surface = "terrain";
    const child = new Object3D();
    child.userData.surface = "walk";
    entityGroup.add(child);
    expect(getEntitySurfaceTag(entityGroup)).toBe("terrain");
  });

  it("integrates with shouldGroundSnap to block terrain-onto-terrain", () => {
    // Acceptance gate from the task: a dragged terrain entity with a
    // separate walkable surface beneath it must NOT snap.
    const entityGroup = new Object3D();
    entityGroup.userData.entityId = "map-1";
    const modelRoot = new Object3D();
    modelRoot.userData.surface = "walk";
    entityGroup.add(modelRoot);

    const draggedSurface = getEntitySurfaceTag(entityGroup);
    expect(draggedSurface).toBe("walk");
    const decision = shouldGroundSnap({
      hit: { point: [0, 0, 0], surface: "walk" }, // separate ground below
      draggedEntitySurface: draggedSurface,
    });
    expect(decision).toBe(false);
  });
});
