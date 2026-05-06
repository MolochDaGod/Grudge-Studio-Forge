import { describe, expect, it, beforeEach } from "vitest";
import {
  clearAiAuditLog,
  getRecentAiCalls,
  recordAiToolCall,
} from "../aiAuditLog";

beforeEach(() => clearAiAuditLog());

describe("aiAuditLog", () => {
  it("records a mutating call and surfaces it under changesOnly", () => {
    recordAiToolCall({
      name: "add_entity",
      input: { entityId: "abc123" },
      result: { ok: true, data: { id: "abc123" } },
    });
    const entries = getRecentAiCalls();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("add_entity");
    expect(entries[0].error).toBe(false);
    expect(entries[0].affectedEntityIds).toContain("abc123");
  });

  it("hides read-only tools by default and includes them with changesOnly:false", () => {
    recordAiToolCall({
      name: "get_active_scene_meta",
      input: {},
      result: { ok: true, data: {} },
    });
    expect(getRecentAiCalls()).toHaveLength(0);
    const all = getRecentAiCalls({ changesOnly: false });
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("get_active_scene_meta");
  });

  it("does NOT capture project/script/prefab ids as affected entities", () => {
    recordAiToolCall({
      name: "create_script",
      input: { name: "Spin", code: "/* … */" },
      result: { ok: true, data: { id: 17, projectId: 3, scriptId: 17, prefabId: 9 } },
    });
    const [entry] = getRecentAiCalls();
    expect(entry.affectedEntityIds).toEqual([]);
  });

  it("captures entityId / rootId / entities[].id keys", () => {
    recordAiToolCall({
      name: "spawn_vfx_prefab",
      input: { name: "smoke" },
      result: {
        ok: true,
        data: {
          rootId: "rootA",
          entities: [{ id: "child1" }, { id: "child2" }],
        },
      },
    });
    const [entry] = getRecentAiCalls();
    expect(entry.affectedEntityIds.sort()).toEqual(["child1", "child2", "rootA"]);
  });

  it("flags errors when result.ok is false", () => {
    recordAiToolCall({
      name: "add_entity",
      input: {},
      result: { ok: false, error: "no project" },
    });
    expect(getRecentAiCalls()[0].error).toBe(true);
  });

  it("returns newest entries first up to limit", () => {
    for (let i = 0; i < 5; i++) {
      recordAiToolCall({
        name: "add_entity",
        input: { entityId: `e${i}` },
        result: { ok: true },
      });
    }
    const recent = getRecentAiCalls({ limit: 3 });
    expect(recent.map((e) => e.affectedEntityIds[0])).toEqual(["e4", "e3", "e2"]);
  });
});
