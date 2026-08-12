/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  localJsonGet,
  localJsonSet,
  localPayloadWrite,
  localPayloadRead,
  getProjectStorageStatus,
} from "../projectStorage";

describe("local storage backup plane", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* */
    }
  });

  it("writes and reads project index locally", () => {
    const key = "grudge:forge:projects:index";
    const items = [
      {
        id: 1,
        name: "Test",
        description: "",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
      },
    ];
    expect(localJsonSet(key, items)).toBe(true);
    expect(localJsonGet(key)).toEqual(items);
  });

  it("payload write returns local or idb", async () => {
    const data = { entities: [{ id: "a" }], environment: {} };
    const where = await localPayloadWrite("scenes", 42, data);
    expect(["local", "idb"]).toContain(where);
    const read = await localPayloadRead<{ entities: unknown[] }>("scenes", 42);
    expect(read?.entities?.length).toBe(1);
  });

  it("storage status always mentions dual-write", () => {
    const s = getProjectStorageStatus();
    expect(s.hints.some((h) => /dual-write/i.test(h))).toBe(true);
  });
});
