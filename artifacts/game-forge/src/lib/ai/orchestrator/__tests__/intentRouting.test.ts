import { describe, expect, it } from "vitest";
import { classifyIntent, roleForIntent, intentLabel } from "../intent";
import { packsForIntent, toolNameAllowlist } from "../packs";
import { buildFailoverChain, type RoutingProbe } from "../routing";

const emptyProbe: RoutingProbe = {
  puterSignedIn: false,
  grudgeSignedIn: false,
  grudgeAiOk: false,
  guestLegionKey: false,
  ollamaOk: false,
  fleet: {},
};

const fleetProbe: RoutingProbe = {
  puterSignedIn: false,
  grudgeSignedIn: false,
  grudgeAiOk: false,
  guestLegionKey: false,
  ollamaOk: false,
  fleet: { groq: true, together: true },
};

const settingsBase = {
  customSystemPrompt: "",
  forceOffline: false,
  autoStartOllama: false,
  preferOllamaWhenAvailable: false,
  ollamaBaseUrl: "http://localhost:11434",
  usageMode: "auto" as const,
  grudgeAiRole: "dev",
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

  it("detects character anim, terrain, identity", () => {
    // "fix" alone maps diagnose — use pack/bone language without fix/
    expect(classifyIntent("apply sword_shield bip001 idle walk")).toBe("character");
    expect(classifyIntent("raycast terrain heightfield feet")).toBe("terrain");
    expect(classifyIntent("sign in with grudge id sso")).toBe("identity");
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
  it("prefers grudge-ai when legion ok and guest key present", () => {
    const chain = buildFailoverChain("orchestrator", {
      ...fleetProbe,
      grudgeAiOk: true,
      guestLegionKey: true,
    });
    expect(chain[0]?.provider).toBe("grudge-ai");
  });

  it("prefers grudge-ai when signed in even without guest key", () => {
    const chain = buildFailoverChain("orchestrator", {
      ...fleetProbe,
      grudgeAiOk: true,
      grudgeSignedIn: true,
      guestLegionKey: false,
    });
    expect(chain[0]?.provider).toBe("grudge-ai");
  });

  it("skips grudge-ai when health ok but no JWT and no guest key", () => {
    const chain = buildFailoverChain("orchestrator", {
      ...fleetProbe,
      grudgeAiOk: true,
      guestLegionKey: false,
      grudgeSignedIn: false,
    });
    expect(chain[0]?.provider).toBe("groq");
    expect(chain.every((m) => m.provider !== "grudge-ai")).toBe(true);
  });

  it("prefers fleet groq when legion unavailable", () => {
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
        ...settingsBase,
        allowedProviders: ["ollama"],
      },
    });
    expect(chain.every((m) => m.provider === "ollama")).toBe(true);
  });

  it("prefers ollama first when preferOllamaWhenAvailable", () => {
    const chain = buildFailoverChain("orchestrator", {
      ...fleetProbe,
      ollamaOk: true,
      settings: {
        ...settingsBase,
        allowedProviders: [
          "grudge-ai",
          "groq",
          "together",
          "ollama",
          "puter",
          "openrouter",
          "gemini",
          "cerebras",
          "deepseek",
          "server-anthropic",
        ],
        preferOllamaWhenAvailable: true,
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
  it("returns string for known intent", () => {
    expect(typeof intentLabel("scene")).toBe("string");
  });
});
