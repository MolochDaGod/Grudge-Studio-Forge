import { describe, expect, it } from "vitest";
import { defs, handlers, destructiveToolNames } from "../index";

describe("knowledge tools module", () => {
  it("exports matching defs and handlers", () => {
    const names = defs.map((d) => d.name).sort();
    const handlerNames = Object.keys(handlers).sort();
    expect(names).toEqual(handlerNames);
  });

  it("registers the full brain surface", () => {
    const names = new Set(defs.map((d) => d.name));
    for (const n of [
      "list_r2_storage",
      "get_brain_catalog",
      "query_d1",
      "d1_status",
      "search_github",
      "list_docs",
      "fetch_doc_url",
      "list_forge_best_practices",
      "list_game_deployments",
      "knowledge_status",
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });

  it("list_forge_best_practices returns tips offline", async () => {
    const r = await handlers.list_forge_best_practices!({ context: "viewport" });
    expect(r.ok).toBe(true);
    expect((r.data as { count: number }).count).toBeGreaterThan(0);
  });

  it("list_game_deployments refuses purged channel", async () => {
    const r = await handlers.list_game_deployments!({ channel: "bundle_in_spa" });
    expect(r.ok).toBe(false);
  });

  it("list_game_deployments recommends save channels", async () => {
    const r = await handlers.list_game_deployments!({ goal: "save" });
    expect(r.ok).toBe(true);
    const rec = (r.data as { recommendedChannels: string[] }).recommendedChannels;
    expect(rec).toContain("forge_api_save");
    expect(rec).toContain("r2_user_assets");
  });

  it("is entirely non-destructive", () => {
    expect(destructiveToolNames).toEqual([]);
  });

  it("requires sql for query_d1", async () => {
    const r = await handlers.query_d1!({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sql/i);
  });

  it("requires url for fetch_doc_url", async () => {
    const r = await handlers.fetch_doc_url!({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/url/i);
  });

  it("requires q or topic for search_github", async () => {
    const r = await handlers.search_github!({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/q|topic/i);
  });
});
