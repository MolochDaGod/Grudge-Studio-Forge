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
      "knowledge_status",
    ]) {
      expect(names.has(n)).toBe(true);
    }
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
