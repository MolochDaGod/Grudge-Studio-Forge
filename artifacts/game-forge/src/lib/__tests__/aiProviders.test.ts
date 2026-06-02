import { describe, it, expect } from "vitest";
import {
  MODELS,
  DEFAULT_MODEL_ID,
  findModel,
  getProvider,
} from "@/lib/ai/providers";

describe("AI provider catalog", () => {
  it("DEFAULT_MODEL_ID is the first entry of MODELS", () => {
    expect(DEFAULT_MODEL_ID).toBe(MODELS[0].id);
  });

  it("default model is a Puter-backed Claude (free via Puter)", () => {
    expect(MODELS[0].provider).toBe("puter");
    expect(MODELS[0].requiresPuterAuth).toBe(true);
    expect(MODELS[0].id.startsWith("puter:claude")).toBe(true);
  });

  it("includes Puter-backed models gated behind requiresPuterAuth", () => {
    const puters = MODELS.filter((m) => m.provider === "puter");
    expect(puters.length).toBeGreaterThanOrEqual(3);
    for (const m of puters) {
      expect(m.requiresPuterAuth).toBe(true);
    }
  });

  it("findModel falls back to default for unknown ids", () => {
    expect(findModel(null).id).toBe(DEFAULT_MODEL_ID);
    expect(findModel(undefined).id).toBe(DEFAULT_MODEL_ID);
    expect(findModel("does-not-exist").id).toBe(DEFAULT_MODEL_ID);
    expect(findModel(MODELS[1].id).id).toBe(MODELS[1].id);
  });

  it("getProvider returns a streaming provider for puter, ollama, and server-anthropic", () => {
    const a = getProvider("server-anthropic");
    const b = getProvider("puter");
    const c = getProvider("ollama");
    expect(typeof a.streamTurn).toBe("function");
    expect(typeof b.streamTurn).toBe("function");
    expect(typeof c.streamTurn).toBe("function");
    expect(a.id).toBe("server-anthropic");
    expect(b.id).toBe("puter");
  });

  it("getProvider falls back to anthropic for unknown ids", () => {
    const fallback = getProvider("does-not-exist");
    expect(fallback.id).toBe("server-anthropic");
  });

  it("model ids use stable provider-prefixed keys", () => {
    for (const m of MODELS) {
      if (m.provider === "puter") expect(m.id.startsWith("puter:")).toBe(true);
      if (m.provider === "ollama") expect(m.id.startsWith("ollama:")).toBe(true);
      if (m.provider === "server-anthropic") expect(m.id.startsWith("server:")).toBe(true);
    }
  });
});
