/**
 * Autonomous scene repair — applies safe fixes for diagnose_scene rules.
 * Called by the AI Worker (`auto_fix_scene`) or after a human diagnose.
 */

import type { SceneEntity } from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";
import { diagnoseScene, type Issue } from "./diagnose";

const GRUDGE6_HUMAN =
  "https://assets.grudge-studio.com/models/grudge6/races/WK_Characters.glb";
const GRUDGE6_ORC =
  "https://assets.grudge-studio.com/models/grudge6/races/ORC_Characters.glb";

export interface AutoFixAction {
  rule: string;
  action: string;
  entityIds?: string[];
}

export function autoFixScene(opts?: {
  deathmatch?: boolean;
  onlyRules?: string[];
}): { actions: AutoFixAction[]; remaining: Issue[]; before: number; after: number } {
  const snap = useEditor.getState();
  const beforeIssues = diagnoseScene({
    entities: snap.sceneData.entities,
    environment: snap.sceneData.environment,
    deathmatch: opts?.deathmatch === true,
  });
  const before = beforeIssues.length;
  const actions: AutoFixAction[] = [];
  const allow = opts?.onlyRules ? new Set(opts.onlyRules) : null;
  const want = (rule: string) => !allow || allow.has(rule);
  const ruleSet = new Set(beforeIssues.map((i) => i.rule));

  // Work on a mutable copy of entities + env
  let entities: SceneEntity[] = snap.sceneData.entities.map((e) => ({
    ...e,
    transform: { ...e.transform, position: [...e.transform.position] as [number, number, number], rotation: [...e.transform.rotation] as [number, number, number], scale: [...e.transform.scale] as [number, number, number] },
  }));
  let env = { ...snap.sceneData.environment };

  const t = (pos: [number, number, number] = [0, 0, 0]): SceneEntity["transform"] => ({
    position: pos,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });

  const mkId = (p: string) =>
    `${p}_${Math.random().toString(36).slice(2, 9)}`;

  if (want("no-lights") && ruleSet.has("no-lights")) {
    const id = mkId("sun");
    entities = [
      ...entities,
      {
        id,
        name: "Sun (auto-fix)",
        type: "light",
        transform: t([10, 18, 8]),
        light: { kind: "directional", intensity: 1.25, color: "#fff4e0" },
      },
    ];
    actions.push({ rule: "no-lights", action: "added directional sun", entityIds: [id] });
  } else if (want("no-directional-light") && ruleSet.has("no-directional-light")) {
    const id = mkId("sun");
    entities = [
      ...entities,
      {
        id,
        name: "Sun (auto-fix)",
        type: "light",
        transform: t([10, 18, 8]),
        light: { kind: "directional", intensity: 1.1, color: "#fff4e0" },
      },
    ];
    actions.push({ rule: "no-directional-light", action: "added directional sun", entityIds: [id] });
  }

  if (want("zero-intensity-light") && ruleSet.has("zero-intensity-light")) {
    const fixed: string[] = [];
    entities = entities.map((e) => {
      if (e.light && typeof e.light.intensity === "number" && e.light.intensity <= 0) {
        fixed.push(e.id);
        return { ...e, light: { ...e.light, intensity: 1 } };
      }
      return e;
    });
    if (fixed.length) {
      actions.push({ rule: "zero-intensity-light", action: "set intensity=1", entityIds: fixed });
    }
  }

  if (want("no-ground") && ruleSet.has("no-ground")) {
    const id = mkId("ground");
    entities = [
      ...entities,
      {
        id,
        name: "Ground (auto-fix)",
        type: "plane",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [50, 1, 50] },
        physics: {
          bodyType: "fixed",
          colliderType: "cuboid",
        },
      },
    ];
    actions.push({ rule: "no-ground", action: "added fixed ground plane", entityIds: [id] });
  }

  if (want("no-player") && ruleSet.has("no-player")) {
    const models = entities.filter((e) => e.type === "model");
    if (models[0]) {
      const pid = models[0].id;
      entities = entities.map((e) =>
        e.id === pid ? { ...e, controllerKind: "thirdPerson" as const } : e,
      );
      env = {
        ...env,
        cameraMode:
          env.cameraMode === "editor" || !env.cameraMode ? "thirdPerson" : env.cameraMode,
        cameraTargetEntityId: env.cameraTargetEntityId ?? pid,
      };
      actions.push({
        rule: "no-player",
        action: "set thirdPerson controller on existing model",
        entityIds: [pid],
      });
    } else {
      const id = mkId("player");
      entities = [
        ...entities,
        {
          id,
          name: "Player (Grudge6)",
          type: "model",
          transform: t([0, 0, 0]),
          model: { url: GRUDGE6_HUMAN },
          controllerKind: "thirdPerson",
        },
      ];
      env = { ...env, cameraMode: "thirdPerson", cameraTargetEntityId: id };
      actions.push({
        rule: "no-player",
        action: "spawned Grudge6 human player",
        entityIds: [id],
      });
    }
  }

  // Rewrite placeholder / broken model URLs to Grudge6
  {
    const rewritten: string[] = [];
    entities = entities.map((e) => {
      const url = e.model?.url;
      if (!url) return e;
      const bad =
        /toon-shooter|mutant\.glb|placeholder|example\.com|localhost:\d+\/missing/i.test(url);
      if (!bad) return e;
      rewritten.push(e.id);
      const orcish = /orc|enemy|boss/i.test(e.name || "") || /orc/i.test(url);
      return {
        ...e,
        model: { ...e.model!, url: orcish ? GRUDGE6_ORC : GRUDGE6_HUMAN },
      };
    });
    if (rewritten.length) {
      actions.push({
        rule: "placeholder-model",
        action: "rewrote model.url to Grudge6 race kit",
        entityIds: rewritten,
      });
    }
  }

  if (actions.length > 0) {
    const st = useEditor.getState();
    useEditor.setState({
      sceneData: { ...st.sceneData, entities, environment: env },
      isDirty: true,
    });
    try {
      st.pushLog("info", `Auto-fix applied ${actions.length} fixes`);
    } catch { /* */ }
  }

  const remaining = diagnoseScene({
    entities: useEditor.getState().sceneData.entities,
    environment: useEditor.getState().sceneData.environment,
    deathmatch: opts?.deathmatch === true,
  });

  return {
    actions,
    remaining,
    before,
    after: remaining.length,
  };
}
