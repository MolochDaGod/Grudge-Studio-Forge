/**
 * Unit tests for tool dispatcher (Groq 128-tool limit fix).
 */
import { describe, it, expect } from "vitest";
import {
  buildDispatcherTools,
  shouldUseDispatcher,
  executeListTools,
  executeCallTool,
} from "../toolDispatcher";
import { TOOL_DEFS } from "@/lib/aiTools";

describe("toolDispatcher", () => {
  it("should use dispatcher for Groq", () => {
    expect(shouldUseDispatcher("groq")).toBe(true);
    expect(shouldUseDispatcher("openrouter")).toBe(false);
    expect(shouldUseDispatcher("grudge-ai")).toBe(false);
  });

  it("should build dispatcher tools under 128", () => {
    const dispatcherTools = buildDispatcherTools();
    expect(dispatcherTools.length).toBeLessThanOrEqual(128);
    expect(dispatcherTools.length).toBeGreaterThan(0);

    // Verify core tools are present
    const names = dispatcherTools.map((t) => t.name);
    expect(names).toContain("list_tools");
    expect(names).toContain("call_tool");
    expect(names).toContain("get_scene_summary");
    expect(names).toContain("list_entities");
  });

  it("should not break full TOOL_DEFS catalog", () => {
    // Verify the full catalog still exists for non-Groq providers
    expect(TOOL_DEFS.length).toBeGreaterThan(100);
  });

  it("list_tools should return domain summary", async () => {
    const result = await executeListTools({});
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("totalTools");
    expect(result.data).toHaveProperty("domains");
    expect((result.data as any).totalTools).toBeGreaterThan(100);
  });

  it("list_tools should filter by domain", async () => {
    const result = await executeListTools({ domain: "scene" });
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("domain", "scene");
    expect(result.data).toHaveProperty("tools");
    expect(Array.isArray((result.data as any).tools)).toBe(true);
  });

  it("call_tool should reject missing name", async () => {
    const result = await executeCallTool({ name: "", arguments: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("requires 'name'");
  });

  it("call_tool should reject unknown tool", async () => {
    const result = await executeCallTool({
      name: "nonexistent_tool_xyz",
      arguments: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  it("call_tool should dispatch to real tool (list_builtin_models)", async () => {
    const result = await executeCallTool({
      name: "list_builtin_models",
      arguments: {},
    });
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });
});
