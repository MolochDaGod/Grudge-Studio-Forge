// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  useMixamoRegistry,
  __resetMixamoRegistryForTests,
} from "../mixamoClipsRegistry";

afterEach(() => {
  __resetMixamoRegistryForTests();
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom — fine */
  }
});

describe("useMixamoRegistry", () => {
  it("ignores add/remove when no project is set (prevents phantom keys)", () => {
    // Defensive contract: React effects can mount before project
    // hydration; if the registry wrote to a `grudge.mixamo.null`
    // localStorage key those entries would never be cleaned up.
    useMixamoRegistry.getState().add("https://example.com/foo.glb");
    expect(useMixamoRegistry.getState().sources).toEqual([]);
  });

  it("persists sources to localStorage keyed by project", () => {
    useMixamoRegistry.getState().setProject(42);
    useMixamoRegistry.getState().add("https://example.com/rifle_idle.glb");
    expect(useMixamoRegistry.getState().sources).toEqual(["https://example.com/rifle_idle.glb"]);
    expect(window.localStorage.getItem("grudge.mixamo.42")).toBe(
      JSON.stringify(["https://example.com/rifle_idle.glb"]),
    );
  });

  it("dedupes — adding the same URL twice is a no-op", () => {
    // Hot-path correctness: AssetBrowser may double-fire add() on
    // rapid clicks; we MUST not let the same URL appear twice or
    // the runtime would retarget + concat the same clip set twice.
    useMixamoRegistry.getState().setProject(7);
    useMixamoRegistry.getState().add("https://example.com/aim.glb");
    useMixamoRegistry.getState().add("https://example.com/aim.glb");
    expect(useMixamoRegistry.getState().sources).toHaveLength(1);
  });

  it("remove() drops the URL and rewrites localStorage", () => {
    useMixamoRegistry.getState().setProject(7);
    useMixamoRegistry.getState().add("https://example.com/a.glb");
    useMixamoRegistry.getState().add("https://example.com/b.glb");
    useMixamoRegistry.getState().remove("https://example.com/a.glb");
    expect(useMixamoRegistry.getState().sources).toEqual(["https://example.com/b.glb"]);
    expect(window.localStorage.getItem("grudge.mixamo.7")).toBe(
      JSON.stringify(["https://example.com/b.glb"]),
    );
  });

  it("setProject hydrates from localStorage so reload restores state", () => {
    // Persistence end-to-end: simulate a reload by writing the
    // localStorage key directly then setting the project.
    window.localStorage.setItem(
      "grudge.mixamo.99",
      JSON.stringify(["https://example.com/persisted.glb"]),
    );
    useMixamoRegistry.getState().setProject(99);
    expect(useMixamoRegistry.getState().sources).toEqual(["https://example.com/persisted.glb"]);
  });

  it("bumps loadVersion on add/remove so consumers re-render", () => {
    // Regression for an architect-found bug: LoadedModel's memo
    // depends on loadVersion to recompute. If add/remove didn't
    // bump it, a same-length list change (e.g. swap one URL for
    // another) wouldn't trigger recomputation.
    useMixamoRegistry.getState().setProject(1);
    const v0 = useMixamoRegistry.getState().loadVersion;
    useMixamoRegistry.getState().add("https://example.com/a.glb");
    const v1 = useMixamoRegistry.getState().loadVersion;
    expect(v1).toBeGreaterThan(v0);
    useMixamoRegistry.getState().remove("https://example.com/a.glb");
    const v2 = useMixamoRegistry.getState().loadVersion;
    expect(v2).toBeGreaterThan(v1);
  });

  it("bumps loadVersion on setProject so identical-length project switches recompute", () => {
    // Regression: switching from project A → B where both had one
    // (different) registered URL would leave LoadedModel's memo
    // stale because sources.length didn't change. loadVersion must
    // bump on every setProject call regardless of length deltas.
    window.localStorage.setItem("grudge.mixamo.10", JSON.stringify(["https://a/one.glb"]));
    window.localStorage.setItem("grudge.mixamo.20", JSON.stringify(["https://b/two.glb"]));
    useMixamoRegistry.getState().setProject(10);
    const v0 = useMixamoRegistry.getState().loadVersion;
    useMixamoRegistry.getState().setProject(20);
    const v1 = useMixamoRegistry.getState().loadVersion;
    expect(v1).toBeGreaterThan(v0);
    expect(useMixamoRegistry.getState().sources).toEqual(["https://b/two.glb"]);
  });

  it("setProject(null) clears active sources without touching storage", () => {
    useMixamoRegistry.getState().setProject(1);
    useMixamoRegistry.getState().add("https://example.com/x.glb");
    useMixamoRegistry.getState().setProject(null);
    expect(useMixamoRegistry.getState().sources).toEqual([]);
    // Project 1's persisted list must survive — switching projects
    // should never delete data.
    expect(window.localStorage.getItem("grudge.mixamo.1")).toBe(
      JSON.stringify(["https://example.com/x.glb"]),
    );
  });
});
