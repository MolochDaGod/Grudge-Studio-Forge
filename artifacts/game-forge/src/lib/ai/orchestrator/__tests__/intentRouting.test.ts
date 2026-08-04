import { describe, expect, it } from "vitest";
import { classifyIntent, roleForIntent, intentLabel } from "../intent";
import { packsForIntent, toolNameAllowlist } from "../packs";
import { buildFailoverChain, type RoutingProbe } from "../routing";

const emptyProbe: RoutingProbe = {
  puterSignedIn: false,
  ollamaOk: false,
  fleet: {},
};

const fleetProbe: RoutingProbe = {
  puterSignedIn: false,
  ollamaOk: false,
  fleet: { groq: true, together: true },
};

describe("classifyIntent", () => {
  it("detects diagnose from shapes/fix language", () => {
    expect(classifyIntent("why are my assets shapes")).toBe("diagnose");
    expect(classifyIntent("fix floating character")).toBe("diagnose");
  });

  it("detects deploy and physics", () => {
    expect(classifyIntent("deploy forge spa smoke")).toBe("deploy");
    expect(classifyIntent("add rapier colliders")).toBe("physics");
  });

  it("honors override", () => {
    expect(classifyIntent("hello", "scene")).toBe("scene");
  });
});

describe("roleForIntent", () => {
  it("maps script to code and deploy to deploy", () => {
    expect(roleForIntent("script")).toBe("code");
    expect(roleForIntent("deploy")).toBe("deploy");
    expect(roleForIntent("scene")).toBe("scene_builder");
  });
});

describe("packsForIntent", () => {
  it("always includes core and caps extras", () => {
    const packs = packsForIntent("physics");
    expect(packs[0]).toBe("core");
    expect(packs.length).toBeLessThanOrEqual(3);
    expect(packs).toContain("rapier");
  });
});

describe("toolNameAllowlist", () => {
  it("restricts deploy tools", () => {
    const allow = toolNameAllowlist("deploy");
    expect(allow).toBeTruthy();
    expect(allow).toContain("list_game_deployments");
    expect(allow).not.toContain("spawn_fast_asset");
  });

  it("leaves general unrestricted", () => {
    expect(toolNameAllowlist("general")).toBeNull();
  });
});

describe("buildFailoverChain", () => {
  it("prefers fleet groq when available", () => {
    const chain = buildFailoverChain("orchestrator", fleetProbe);
    expect(chain[0]?.provider).toBe("groq");
  });

  it("uses ollama when forceOffline", () => {
    const chain = buildFailoverChain("orchestrator", {
      ...emptyProbe,
      ollamaOk: true,
      forceOffline: true,
    });
    expect(chain.every((m) => m.provider === "ollama")).toBe(true);
  });

  it("respects allowedProviders allowlist", () => {
    const chain = buildFailoverChain("orchestrator", {
      ...fleetProbe,
      ollamaOk: true,
      settings: {
        customSystemPrompt: "",
        allowedProviders: ["ollama"],
        forceOffline: false,
        autoStartOllama: false,
        preferOllamaWhenAvailable: false,
        ollamaBaseUrl: "http://localhost:11434",
      },
    });
    expect(chain.every((m) => m.provider === "ollama")).toBe(true);
  });

  it("prefers ollama first when preferOllamaWhenAvailable", () => {
    const chain = buildFailoverChain("orchestrator", {
      ...fleetProbe,
      ollamaOk: true,
      settings: {
        customSystemPrompt: "",
        allowedProviders: ["groq", "together", "ollama", "puter", "openrouter", "gemini", "cerebras", "deepseek", "server-anthropic"],
        forceOffline: false,
        autoStartOllama: false,
        preferOllamaWhenAvailable: true,
        ollamaBaseUrl: "http://localhost:11434",
      },
    });
    expect(chain[0]?.provider).toBe("ollama");
  });

  it("always returns at least one model", () => {
    const chain = buildFailoverChain("diagnose", emptyProbe);
    expect(chain.length).toBeGreaterThan(0);
  });
});

describe("intentLabel", () => {
  it("labels diagnose", () => {
    expect(intentLabel("diagnose")).toMatch(/Diagnose/i);
  });
});
