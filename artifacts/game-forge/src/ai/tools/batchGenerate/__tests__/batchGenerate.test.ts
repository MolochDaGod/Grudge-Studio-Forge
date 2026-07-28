import { describe, expect, it } from "vitest";
import {
  BATCH_GENERATE_DEFAULT_CONCURRENCY,
  BATCH_GENERATE_MAX_CONCURRENCY,
  BATCH_GENERATE_MAX_JOBS,
  clampConcurrency,
  mapPool,
  normalizeBatchJobs,
} from "../index";

describe("normalizeBatchJobs", () => {
  it("rejects empty / non-array", () => {
    expect(normalizeBatchJobs(null).ok).toBe(false);
    expect(normalizeBatchJobs([]).ok).toBe(false);
  });

  it("caps job count", () => {
    const jobs = Array.from({ length: BATCH_GENERATE_MAX_JOBS + 1 }, () => ({
      kind: "lore",
      prompt: "x",
    }));
    const r = normalizeBatchJobs(jobs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Cap is/);
  });

  it("normalizes valid mixed jobs", () => {
    const r = normalizeBatchJobs([
      { kind: "texture", prompt: "stone", entityIds: ["a"] },
      { id: "sky-1", kind: "skybox", prompt: "sunset" },
      { kind: "primitives", type: "box", count: 4, pattern: "grid" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jobs).toHaveLength(3);
    expect(r.jobs[0].id).toBe("job-1");
    expect(r.jobs[1].id).toBe("sky-1");
    expect(r.jobs[2].kind).toBe("primitives");
    expect(r.jobs[0].payload.prompt).toBe("stone");
    expect(r.jobs[0].payload).not.toHaveProperty("kind");
  });

  it("rejects bad kind", () => {
    const r = normalizeBatchJobs([{ kind: "mesh", prompt: "nope" }]);
    expect(r.ok).toBe(false);
  });
});

describe("clampConcurrency", () => {
  it("defaults and clamps", () => {
    expect(clampConcurrency(undefined)).toBe(BATCH_GENERATE_DEFAULT_CONCURRENCY);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(99)).toBe(BATCH_GENERATE_MAX_CONCURRENCY);
    expect(clampConcurrency(3)).toBe(3);
  });
});

describe("mapPool", () => {
  it("preserves order under concurrency", async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await mapPool(items, 2, async (n) => {
      await new Promise((r) => setTimeout(r, 5 * (6 - n)));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });
});
