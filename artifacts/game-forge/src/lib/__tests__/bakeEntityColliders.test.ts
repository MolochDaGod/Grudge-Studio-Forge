/**
 * Verifies the worker → store → caller warning pipeline for
 * `bakeEntityConvexHulls`. We mock `buildHulls` so it can stream
 * warnings into the supplied `onWarn` sink and then reject — the
 * regression we care about is dropping the `onWarn` forward to the
 * progress store, or skipping the `finish("error", …)` call on the
 * rejection path.
 */
import { describe, expect, it, beforeEach, beforeAll, vi } from "vitest";
import * as THREE from "three";

vi.mock("@/lib/colliderBaker", () => ({
  buildHulls: vi.fn(),
  serializeHullSet: vi.fn(() => ({ hulls: [], totalVerts: 0 })),
}));

import { buildHulls } from "@/lib/colliderBaker";
import { useEditor } from "@/store/editor";
import { useBakeProgress } from "@/store/bakeProgress";
import { bakeEntityConvexHulls } from "@/lib/bakeEntityColliders";

beforeAll(() => {
  if (typeof (globalThis as { window?: unknown }).window === "undefined") {
    (globalThis as unknown as { window: typeof globalThis }).window =
      globalThis;
  }
});

beforeEach(() => {
  vi.mocked(buildHulls).mockReset();
  useBakeProgress.setState({ entries: [] });
  useEditor.setState({
    sceneData: {
      entities: [
        {
          id: "e1",
          name: "Crate",
          type: "box",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        },
      ],
      environment: {},
    },
    isDirty: false,
  });
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.userData.entityId = "e1";
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  root.add(g);
  const w = window as unknown as {
    __editorScene?: THREE.Object3D;
    __colliderHullSets?: Map<number, unknown>;
    __colliderAssetCounter?: number;
  };
  w.__editorScene = root;
  delete w.__colliderHullSets;
  delete w.__colliderAssetCounter;
});

describe("bakeEntityConvexHulls — warnings + error path", () => {
  it("forwards worker warnings to the progress store, the caller sink, and the returned warnings array, then transitions to error on rejection", async () => {
    vi.mocked(buildHulls).mockImplementation(async (_meshes, opts) => {
      opts?.onWarn?.("vhacd unavailable", "wasm load failed");
      opts?.onWarn?.("quickhull fallback");
      throw new Error("decomposition exploded");
    });

    const callerSink = vi.fn();
    // Capture the running entry before the await resolves so we can
    // assert the store actually transitioned through `running`.
    const runningSnapshots: string[] = [];
    const unsub = useBakeProgress.subscribe((s) => {
      const e = s.entries.find((x) => x.entityId === "e1");
      if (e) runningSnapshots.push(e.status);
    });

    const result = await bakeEntityConvexHulls("e1", { onWarn: callerSink });
    unsub();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("decomposition exploded");
    expect(result.warnings).toEqual([
      { message: "vhacd unavailable", detail: "wasm load failed" },
      { message: "quickhull fallback", detail: undefined },
    ]);

    expect(callerSink).toHaveBeenCalledTimes(2);
    expect(callerSink).toHaveBeenNthCalledWith(
      1,
      "vhacd unavailable",
      "wasm load failed",
    );
    expect(callerSink).toHaveBeenNthCalledWith(
      2,
      "quickhull fallback",
      undefined,
    );

    // Store must have flipped through running and ended in error
    // with both warnings recorded.
    expect(runningSnapshots).toContain("running");
    const entry = useBakeProgress
      .getState()
      .entries.find((e) => e.entityId === "e1");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("error");
    expect(entry!.summary).toBe("decomposition exploded");
    expect(entry!.warnings).toEqual([
      { message: "vhacd unavailable", detail: "wasm load failed" },
      { message: "quickhull fallback", detail: undefined },
    ]);
    expect(entry!.completedAt).toBeDefined();
  });

  it("a buggy caller onWarn that throws never derails the bake or the store warning forward", async () => {
    vi.mocked(buildHulls).mockImplementation(async (_meshes, opts) => {
      opts?.onWarn?.("warn-1");
      throw new Error("late boom");
    });
    const callerSink = vi.fn(() => {
      throw new Error("sink exploded");
    });
    const result = await bakeEntityConvexHulls("e1", { onWarn: callerSink });
    expect(result.ok).toBe(false);
    const entry = useBakeProgress
      .getState()
      .entries.find((e) => e.entityId === "e1");
    expect(entry?.status).toBe("error");
    expect(entry?.warnings).toEqual([
      { message: "warn-1", detail: undefined },
    ]);
  });
});
