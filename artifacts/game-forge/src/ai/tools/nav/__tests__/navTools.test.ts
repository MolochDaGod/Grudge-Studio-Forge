/**
 * AI nav tools — batched semantics + bake_convex_hulls patching.
 *
 * Covers the contract pieces the code reviewer flagged on the previous
 * pass: `set_surface` and `set_nav_agent` must accept `entityIds[]`
 * (with `entityId` back-compat), and `bake_convex_hulls` must walk the
 * live editor scene, build hulls, and patch each entity's
 * `PhysicsComponent` to `convex-decomp` via the CommandStack.
 */
import { describe, expect, it, beforeEach, beforeAll } from "vitest";
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { handlers } from "../index";

// vitest config defaults to environment:"node" — shim a minimal
// `window` so the tools that read `window.__editorScene` /
// `window.__colliderHullSets` don't blow up on first access.
beforeAll(() => {
  if (typeof (globalThis as { window?: unknown }).window === "undefined") {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  }
});

beforeEach(() => {
  useEditor.setState({
    sceneData: {
      entities: [
        {
          id: "e1",
          name: "Floor",
          type: "box",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [10, 0.2, 10] },
        },
        {
          id: "e2",
          name: "Ramp",
          type: "box",
          transform: { position: [3, 0, 0], rotation: [0, 0, 0], scale: [4, 0.2, 4] },
        },
        {
          id: "e3",
          name: "Goblin",
          type: "box",
          transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      ],
      environment: {},
    },
    isDirty: false,
  });
  // Clean window-cached state between runs.
  const w = window as unknown as {
    __editorScene?: THREE.Object3D;
    __colliderHullSets?: Map<number, unknown>;
    __colliderAssetCounter?: number;
  };
  delete w.__editorScene;
  delete w.__colliderHullSets;
  delete w.__colliderAssetCounter;
});

describe("set_surface (batched)", () => {
  it("applies a surface to every entity in entityIds[]", async () => {
    const r = await handlers.set_surface!({
      entityIds: ["e1", "e2"],
      surface: "Walk",
    });
    expect(r.ok).toBe(true);
    const ents = useEditor.getState().sceneData.entities;
    expect(ents.find((e) => e.id === "e1")?.surface).toBe("Walk");
    expect(ents.find((e) => e.id === "e2")?.surface).toBe("Walk");
    expect(ents.find((e) => e.id === "e3")?.surface).toBeUndefined();
  });

  it("accepts the legacy single `entityId` form", async () => {
    const r = await handlers.set_surface!({
      entityId: "e1",
      surface: "Climb",
    });
    expect(r.ok).toBe(true);
    expect(useEditor.getState().sceneData.entities[0].surface).toBe("Climb");
  });

  it("rejects invalid surface kinds", async () => {
    const r = await handlers.set_surface!({
      entityIds: ["e1"],
      surface: "FlyAwayland",
    });
    expect(r.ok).toBe(false);
  });
});

describe("set_nav_agent (batched)", () => {
  it("installs a nav-agent on every id in entityIds[]", async () => {
    const r = await handlers.set_nav_agent!({
      entityIds: ["e2", "e3"],
      agent: { speed: 5, radius: 0.4, height: 1.8 },
    });
    expect(r.ok).toBe(true);
    const ents = useEditor.getState().sceneData.entities;
    expect(ents.find((e) => e.id === "e2")?.navAgent?.speed).toBe(5);
    expect(ents.find((e) => e.id === "e3")?.navAgent?.radius).toBe(0.4);
  });

  it("clears the nav-agent when agent is null", async () => {
    await handlers.set_nav_agent!({ entityIds: ["e3"], agent: { speed: 4 } });
    const r = await handlers.set_nav_agent!({ entityIds: ["e3"], agent: null });
    expect(r.ok).toBe(true);
    expect(useEditor.getState().sceneData.entities[2].navAgent).toBeUndefined();
  });
});

describe("bake_convex_hulls", () => {
  it("walks the live scene, builds hulls, and patches PhysicsComponent through the CommandStack", { timeout: 30000 }, async () => {
    // Stand up a fake editor scene graph: one Group per entity, each
    // carrying a single mesh under it. Mirrors the EntityRenderer
    // shape that bake_convex_hulls walks via `getObjectByProperty`.
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.userData.entityId = "e1";
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    g.add(new THREE.Mesh(geom, mat));
    root.add(g);
    (window as unknown as { __editorScene?: THREE.Object3D }).__editorScene = root;

    const r = await handlers.bake_convex_hulls!({ entityIds: ["e1"] });
    expect(r.ok).toBe(true);
    const data = r.data as {
      results: Array<{ entityId: string; collidersAssetId: number; hulls: number }>;
      errors: unknown[];
    };
    expect(data.errors).toEqual([]);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].hulls).toBeGreaterThan(0);
    expect(data.results[0].collidersAssetId).toBeGreaterThan(0);

    const ent = useEditor.getState().sceneData.entities.find((e) => e.id === "e1");
    expect(ent?.physics?.colliderType).toBe("convex-decomp");
    expect(ent?.physics?.collidersAssetId).toBe(data.results[0].collidersAssetId);

    // The patch must have gone through the CommandStack so it's
    // undoable. Pop a single undo and confirm we're back to no
    // physics component on e1.
    useEditor.getState().commandStack.undo();
    const afterUndo = useEditor
      .getState()
      .sceneData.entities.find((e) => e.id === "e1");
    expect(afterUndo?.physics?.colliderType).not.toBe("convex-decomp");
  });

  it("reports per-entity errors when an entity has no rendered geometry", async () => {
    // Editor scene exists but has no node for `e1`.
    (window as unknown as { __editorScene?: THREE.Object3D }).__editorScene = new THREE.Group();
    const r = await handlers.bake_convex_hulls!({ entityIds: ["e1"] });
    expect(r.ok).toBe(false);
    const data = r.data as { errors: Array<{ entityId: string; error: string }> };
    expect(data.errors[0].entityId).toBe("e1");
  });

  it("rejects empty entityIds[]", async () => {
    const r = await handlers.bake_convex_hulls!({ entityIds: [] });
    expect(r.ok).toBe(false);
  });
});
