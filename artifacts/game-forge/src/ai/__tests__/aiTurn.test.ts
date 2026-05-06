import { describe, expect, it } from "vitest";
import {
  countCompletedSteps,
  extractEntityIdsFromTool,
  makeAITurnCommand,
  parseNextActions,
  parsePlan,
  stripProtocolTags,
  type AIToolEvent,
  type AITurnStep,
} from "../aiTurn";
import type { SceneData, SceneEntity } from "@/scene/types";

describe("parsePlan", () => {
  it("extracts a JSON plan array from a <plan> tag", () => {
    const text = `<plan>[{"step":1,"intent":"Generate map"},{"step":2,"intent":"Spawn player"}]</plan>\nHere we go.`;
    expect(parsePlan(text)).toEqual([
      { step: 1, intent: "Generate map" },
      { step: 2, intent: "Spawn player" },
    ]);
  });

  it("accepts {plan:[...]} wrapper shape", () => {
    const text = `<plan>{"plan":[{"step":1,"intent":"Light it up"}]}</plan>`;
    expect(parsePlan(text)).toEqual([{ step: 1, intent: "Light it up" }]);
  });

  it("returns [] for missing or malformed plans", () => {
    expect(parsePlan("hello")).toEqual([]);
    expect(parsePlan("<plan>not json</plan>")).toEqual([]);
    expect(parsePlan("<plan>{}</plan>")).toEqual([]);
  });

  it("drops entries without an intent string", () => {
    const text = `<plan>[{"step":1},{"step":2,"intent":"   "},{"intent":"go"}]</plan>`;
    expect(parsePlan(text)).toEqual([{ step: 1, intent: "go" }]);
  });
});

describe("parseNextActions", () => {
  it("returns up to 3 short string suggestions", () => {
    const text = `<next_actions>["Add a light","Make it night","Spawn enemies","Way too many"]</next_actions>`;
    expect(parseNextActions(text)).toEqual([
      "Add a light",
      "Make it night",
      "Spawn enemies",
    ]);
  });

  it("ignores non-string and overlong entries", () => {
    const text = `<next_actions>["ok",42,"${"x".repeat(120)}","keep"]</next_actions>`;
    expect(parseNextActions(text)).toEqual(["ok", "keep"]);
  });

  it("returns [] when missing or malformed", () => {
    expect(parseNextActions("hello")).toEqual([]);
    expect(parseNextActions("<next_actions>nope</next_actions>")).toEqual([]);
  });
});

describe("stripProtocolTags", () => {
  it("removes both tag blocks and trims whitespace", () => {
    const text =
      "<plan>[{\"step\":1,\"intent\":\"a\"}]</plan>\n\nDid it.\n\n<next_actions>[\"do x\"]</next_actions>";
    expect(stripProtocolTags(text)).toBe("Did it.");
  });

  it("returns the original text when no tags are present", () => {
    expect(stripProtocolTags("just words")).toBe("just words");
  });
});

describe("countCompletedSteps", () => {
  const plan = [
    { step: 1, intent: "a" },
    { step: 2, intent: "b" },
    { step: 3, intent: "c" },
  ];
  const ok = (name: string): AIToolEvent => ({
    id: name,
    name,
    input: {},
    result: { ok: true },
  });
  const fail = (name: string): AIToolEvent => ({
    id: name,
    name,
    input: {},
    result: { ok: false, error: "boom" },
  });

  it("counts successful tool calls up to plan length", () => {
    expect(countCompletedSteps(plan, [ok("x"), ok("y")])).toBe(2);
    expect(countCompletedSteps(plan, [ok("x"), fail("y"), ok("z")])).toBe(2);
    expect(countCompletedSteps(plan, [ok("a"), ok("b"), ok("c"), ok("d")])).toBe(3);
  });

  it("returns 0 when no plan", () => {
    expect(countCompletedSteps([], [ok("x")])).toBe(0);
  });
});

describe("extractEntityIdsFromTool", () => {
  it("harvests entityId / rootId / entityIds and entities[].id", () => {
    const ids = extractEntityIdsFromTool({
      id: "t1",
      name: "update_entity",
      input: { entityId: "ent_a" },
      result: {
        ok: true,
        data: {
          rootId: "ent_b",
          entityIds: ["ent_c", "ent_d"],
          entities: [{ id: "ent_e" }, { id: "ent_f" }],
          projectId: 99,
        },
      },
    });
    expect(ids.sort()).toEqual([
      "ent_a",
      "ent_b",
      "ent_c",
      "ent_d",
      "ent_e",
      "ent_f",
    ]);
  });

  it("does NOT pick up project / script / prefab ids", () => {
    const ids = extractEntityIdsFromTool({
      id: "t1",
      name: "create_script",
      input: {},
      result: { ok: true, data: { id: 7, projectId: 1, scriptId: 7, prefabId: 4 } },
    });
    expect(ids).toEqual([]);
  });
});

describe("makeAITurnCommand", () => {
  const makeEntity = (id: string, name: string): SceneEntity => ({
    id,
    name,
    type: "box",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  });
  const sky = (c: string): SceneData["environment"] =>
    ({ skyColor: c }) as SceneData["environment"];

  it("uses kind='ai_turn' and a meaningful label", () => {
    const cmd = makeAITurnCommand({
      label: "AI turn (2 steps)",
      steps: [],
      apply: () => undefined,
    });
    expect(cmd.kind).toBe("ai_turn");
    expect(cmd.label).toBe("AI turn (2 steps)");
  });

  it("do() replays each step's `next` in order; undo() walks `prev` in reverse", () => {
    const s0: SceneData = { entities: [makeEntity("a", "A")], environment: sky("#000") };
    const s1: SceneData = {
      entities: [makeEntity("a", "A"), makeEntity("b", "B")],
      environment: sky("#000"),
    };
    const s2: SceneData = {
      entities: [makeEntity("a", "A"), makeEntity("b", "B")],
      environment: sky("#fff"),
    };
    const steps: AITurnStep[] = [
      { name: "add_entity", prev: s0, next: s1 },
      { name: "set_environment", prev: s1, next: s2 },
    ];

    const writes: SceneData[] = [];
    const cmd = makeAITurnCommand({
      label: "AI turn (2 steps)",
      steps,
      apply: (d) => writes.push(d),
    });

    cmd.do();
    expect(writes.map((w) => w.environment.skyColor)).toEqual(["#000", "#fff"]);
    expect(writes[1].entities.map((e) => e.id)).toEqual(["a", "b"]);

    writes.length = 0;
    cmd.undo();
    // Reverse order: write s1.prev first (s1) then s0.prev (s0)
    expect(writes.map((w) => w.environment.skyColor)).toEqual(["#000", "#000"]);
    expect(writes[0].entities.map((e) => e.id)).toEqual(["a", "b"]);
    expect(writes[1].entities.map((e) => e.id)).toEqual(["a"]);
  });

  it("deep-clones snapshots so writes can't bleed back into stored steps", () => {
    const s0: SceneData = { entities: [makeEntity("a", "A")], environment: sky("#000") };
    const s1: SceneData = {
      entities: [makeEntity("a", "A"), makeEntity("b", "B")],
      environment: sky("#000"),
    };
    const steps: AITurnStep[] = [{ name: "add_entity", prev: s0, next: s1 }];

    let live: SceneData | null = null;
    const cmd = makeAITurnCommand({
      label: "x",
      steps,
      apply: (d) => {
        live = d;
      },
    });
    cmd.undo();
    // Mutate the live copy and ensure the stored snapshot is unaffected,
    // so a subsequent redo/undo cycle would still see the original state.
    live!.entities[0].name = "mutated";
    expect(s0.entities[0].name).toBe("A");
  });
});
