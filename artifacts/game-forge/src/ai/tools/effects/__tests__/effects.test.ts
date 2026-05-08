import { describe, expect, it, beforeEach } from "vitest";
import { useEditor } from "@/store/editor";
import { defs, handlers, destructiveToolNames } from "../index";

const resetScene = () => {
  useEditor.setState({
    sceneData: {
      entities: [
        {
          id: "flag1",
          name: "Banner",
          type: "flag",
          transform: {
            position: [0, 1.5, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          softBody: { segmentsX: 12, segmentsY: 8 },
        },
        {
          id: "smoke1",
          name: "Smoke",
          type: "particles",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          softBody: { emitRate: 20, lifetime: 2, emitVelocity: 1.5 },
        },
        {
          id: "box1",
          name: "Box",
          type: "box",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        },
      ],
      environment: {},
    },
    isDirty: false,
  });
  useEditor.getState().commandStack.clear();
};

describe("effects AI tools", () => {
  beforeEach(resetScene);

  it("exports set_wind and set_soft_body as destructive tools", () => {
    expect(defs.map((d) => d.name).sort()).toEqual(["set_soft_body", "set_wind"]);
    expect(destructiveToolNames.sort()).toEqual(["set_soft_body", "set_wind"]);
  });

  it("set_wind writes the wind vector and is undoable", async () => {
    const r = await handlers.set_wind({ wind: [5, 0, 2] });
    expect(r.ok).toBe(true);
    expect(useEditor.getState().sceneData.environment.wind).toEqual([5, 0, 2]);
    expect(useEditor.getState().commandStack.canUndo()).toBe(true);
    useEditor.getState().commandStack.undo();
    expect(useEditor.getState().sceneData.environment.wind).toBeUndefined();
  });

  it("set_wind rejects non-vector input", async () => {
    const a = await handlers.set_wind({ wind: [1, 2] });
    expect(a.ok).toBe(false);
    const b = await handlers.set_wind({ wind: "breezy" });
    expect(b.ok).toBe(false);
    const c = await handlers.set_wind({});
    expect(c.ok).toBe(false);
  });

  it("set_soft_body patches a flag and preserves untouched fields", async () => {
    const r = await handlers.set_soft_body({
      entityIds: ["flag1"],
      damping: 0.2,
      segmentsX: 20,
    });
    expect(r.ok).toBe(true);
    const flag = useEditor.getState().sceneData.entities.find((e) => e.id === "flag1");
    expect(flag?.softBody?.damping).toBe(0.2);
    expect(flag?.softBody?.segmentsX).toBe(20);
    expect(flag?.softBody?.segmentsY).toBe(8);
  });

  it("set_soft_body clamps damping to [0,1] and segments to [2,64]", async () => {
    const r = await handlers.set_soft_body({
      entityIds: ["flag1"],
      damping: 9,
      segmentsX: 1000,
      segmentsY: 0,
    });
    expect(r.ok).toBe(true);
    const flag = useEditor.getState().sceneData.entities.find((e) => e.id === "flag1");
    expect(flag?.softBody?.damping).toBe(1);
    expect(flag?.softBody?.segmentsX).toBe(64);
    expect(flag?.softBody?.segmentsY).toBe(2);
  });

  it("set_soft_body rejects negative emitRate and non-positive lifetime / burstInterval", async () => {
    const a = await handlers.set_soft_body({ entityIds: ["smoke1"], emitRate: -1 });
    expect(a.ok).toBe(false);
    const b = await handlers.set_soft_body({ entityIds: ["smoke1"], lifetime: 0 });
    expect(b.ok).toBe(false);
    const c = await handlers.set_soft_body({ entityIds: ["smoke1"], burstInterval: 0 });
    expect(c.ok).toBe(false);
  });

  it("set_soft_body refuses non-soft entity types and reports them", async () => {
    const r = await handlers.set_soft_body({ entityIds: ["box1"], damping: 0.5 });
    expect(r.ok).toBe(false);
  });

  it("set_soft_body undo restores previous softBody", async () => {
    await handlers.set_soft_body({
      entityIds: ["smoke1"],
      emitRate: 99,
      mode: "burst",
      burstCount: 50,
      burstInterval: 2,
    });
    const after = useEditor.getState().sceneData.entities.find((e) => e.id === "smoke1");
    expect(after?.softBody?.emitRate).toBe(99);
    expect(after?.softBody?.mode).toBe("burst");
    useEditor.getState().commandStack.undo();
    const reverted = useEditor.getState().sceneData.entities.find((e) => e.id === "smoke1");
    expect(reverted?.softBody?.emitRate).toBe(20);
    expect(reverted?.softBody?.mode).toBeUndefined();
  });

  it("set_soft_body requires entityIds and at least one tunable field", async () => {
    const a = await handlers.set_soft_body({ entityIds: [] });
    expect(a.ok).toBe(false);
    const b = await handlers.set_soft_body({ entityIds: ["flag1"] });
    expect(b.ok).toBe(false);
  });

  it("set_soft_body validates pin and mode enums", async () => {
    const a = await handlers.set_soft_body({ entityIds: ["flag1"], pin: "middle" });
    expect(a.ok).toBe(false);
    const b = await handlers.set_soft_body({ entityIds: ["smoke1"], mode: "spray" });
    expect(b.ok).toBe(false);
  });
});
