import { describe, expect, it } from "vitest";
import {
  emptyRendererSnapshot,
  formatSnapshotForCopy,
  getRendererSnapshot,
  publishPhysicsStats,
  publishRendererSnapshot,
  subscribeRendererSnapshot,
} from "@/lib/rendererInspector";

describe("rendererInspector", () => {
  it("publishes and notifies subscribers", () => {
    const seen: number[] = [];
    const unsub = subscribeRendererSnapshot((s) => seen.push(s.calls));
    publishRendererSnapshot(emptyRendererSnapshot({ calls: 42, ts: 1 }));
    expect(getRendererSnapshot().calls).toBe(42);
    expect(seen.at(-1)).toBe(42);
    unsub();
  });

  it("merges physics without wiping GPU fields", () => {
    publishRendererSnapshot(
      emptyRendererSnapshot({ calls: 7, triangles: 1000, ts: 2 }),
    );
    publishPhysicsStats({
      rapierBodies: 3,
      rapierColliders: 5,
      rapierStepMs: null,
    });
    const s = getRendererSnapshot();
    expect(s.calls).toBe(7);
    expect(s.triangles).toBe(1000);
    expect(s.rapierBodies).toBe(3);
    expect(s.rapierColliders).toBe(5);
  });

  it("formats a copy-friendly dump", () => {
    const text = formatSnapshotForCopy(
      emptyRendererSnapshot({
        fps: 60,
        frameMs: 16.6,
        calls: 12,
        triangles: 999,
        entities: 4,
        backend: "webgl2",
        renderQuality: "perf",
      }),
      [{ level: "warn", text: "hello", ts: 1_700_000_000_000 }],
    );
    expect(text).toContain("Forge Renderer Inspector");
    expect(text).toContain("drawCalls: 12");
    expect(text).toContain("entities: 4");
    expect(text).toContain("WARN hello");
  });
});
