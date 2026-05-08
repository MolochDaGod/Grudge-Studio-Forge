/**
 * Unit tests for the in-flight bake progress store. Locks down the
 * begin/warn/finish/remove transitions and the "second bake of the
 * same entity replaces the entry" rule that BakeProgressToasts and
 * `bakeEntityConvexHulls` depend on.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useBakeProgress } from "@/store/bakeProgress";

beforeEach(() => {
  useBakeProgress.setState({ entries: [] });
});

describe("useBakeProgress", () => {
  it("begin() pushes a running entry with empty warnings", () => {
    useBakeProgress.getState().begin("e1", "Floor");
    const [entry] = useBakeProgress.getState().entries;
    expect(entry.entityId).toBe("e1");
    expect(entry.entityName).toBe("Floor");
    expect(entry.status).toBe("running");
    expect(entry.warnings).toEqual([]);
    expect(entry.completedAt).toBeUndefined();
    expect(typeof entry.startedAt).toBe("number");
  });

  it("warn() appends warnings to the matching entry only", () => {
    useBakeProgress.getState().begin("e1", "Floor");
    useBakeProgress.getState().begin("e2", "Wall");
    useBakeProgress.getState().warn("e1", "vhacd-fallback", "quickhull instead");
    useBakeProgress.getState().warn("e1", "second");
    const entries = useBakeProgress.getState().entries;
    const e1 = entries.find((e) => e.entityId === "e1")!;
    const e2 = entries.find((e) => e.entityId === "e2")!;
    expect(e1.warnings).toEqual([
      { message: "vhacd-fallback", detail: "quickhull instead" },
      { message: "second", detail: undefined },
    ]);
    expect(e2.warnings).toEqual([]);
  });

  it("finish() flips status, stamps summary + completedAt, keeps warnings", () => {
    useBakeProgress.getState().begin("e1", "Floor");
    useBakeProgress.getState().warn("e1", "uh oh");
    useBakeProgress.getState().finish("e1", "ok", "3 hulls · 42 verts");
    const [entry] = useBakeProgress.getState().entries;
    expect(entry.status).toBe("ok");
    expect(entry.summary).toBe("3 hulls · 42 verts");
    expect(typeof entry.completedAt).toBe("number");
    expect(entry.warnings).toHaveLength(1);
  });

  it("finish() with status='error' is also recorded", () => {
    useBakeProgress.getState().begin("e1", "Floor");
    useBakeProgress.getState().finish("e1", "error", "boom");
    expect(useBakeProgress.getState().entries[0].status).toBe("error");
    expect(useBakeProgress.getState().entries[0].summary).toBe("boom");
  });

  it("remove() drops only the targeted entry", () => {
    useBakeProgress.getState().begin("e1", "Floor");
    useBakeProgress.getState().begin("e2", "Wall");
    useBakeProgress.getState().remove("e1");
    const entries = useBakeProgress.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].entityId).toBe("e2");
  });

  it("a second begin() for the same entity replaces the previous entry", () => {
    useBakeProgress.getState().begin("e1", "Floor");
    useBakeProgress.getState().warn("e1", "old warning");
    useBakeProgress.getState().finish("e1", "ok", "old summary");

    useBakeProgress.getState().begin("e1", "Floor v2");
    const entries = useBakeProgress.getState().entries;
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.entityName).toBe("Floor v2");
    expect(entry.status).toBe("running");
    expect(entry.warnings).toEqual([]);
    expect(entry.summary).toBeUndefined();
    expect(entry.completedAt).toBeUndefined();
  });
});
