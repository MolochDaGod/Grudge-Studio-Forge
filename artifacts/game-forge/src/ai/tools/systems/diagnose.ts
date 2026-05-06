/**
 * Pure diagnostic rules for `diagnose_scene`.
 *
 * Each rule inspects a snapshot (entities, environment, etc.) and yields
 * zero or more `Issue`s. The set is intentionally *opinionated and small*
 * — these are the gotchas that bite a user the first time they play a
 * scene the AI built. Stays side-effect free for testability.
 */

import type { SceneEntity, BehaviorKind } from "@workspace/scene-schema";

export type IssueSeverity = "error" | "warn" | "info";

export interface Issue {
  /** Stable rule id (used in tests + for the AI to dedupe across runs). */
  rule: string;
  severity: IssueSeverity;
  message: string;
  /** Optional id(s) the issue refers to. */
  entityIds?: string[];
  /** Optional one-line hint suggesting a fix. */
  hint?: string;
}

export interface DiagnoseSceneInput {
  entities: readonly SceneEntity[];
  environment: {
    cameraMode?: "editor" | "follow" | "first-person" | string;
    cameraTargetEntityId?: string | null;
    gravity?: readonly [number, number, number];
  };
  /** When true, treat the scene as a deathmatch room — extra checks fire. */
  deathmatch?: boolean;
}

const TYPES_NEEDING_GROUND = new Set(["box", "sphere", "cylinder", "model"]);

export function diagnoseScene(input: DiagnoseSceneInput): Issue[] {
  const issues: Issue[] = [];
  const ents = input.entities;
  const env = input.environment ?? {};

  // ── Lighting ────────────────────────────────────────────────────────
  const lights = ents.filter((e) => e.type === "light" || e.light);
  if (lights.length === 0) {
    issues.push({
      rule: "no-lights",
      severity: "warn",
      message: "Scene has no light entities — everything will render dark.",
      hint: "Add a directional light (sun) or set environment.skyColor.",
    });
  }
  const hasDirectional = lights.some((l) => l.light?.kind === "directional");
  if (lights.length > 0 && !hasDirectional) {
    issues.push({
      rule: "no-directional-light",
      severity: "info",
      message:
        "No directional light found — point/spot lights only will give a flat look.",
      hint: "Add one directional light to act as the sun.",
    });
  }

  // ── Ground / floor ──────────────────────────────────────────────────
  const planes = ents.filter((e) => e.type === "plane");
  const fixedBodies = ents.filter(
    (e) => e.physics?.bodyType === "fixed" && TYPES_NEEDING_GROUND.has(e.type),
  );
  if (planes.length === 0 && fixedBodies.length === 0) {
    issues.push({
      rule: "no-ground",
      severity: "warn",
      message:
        "No plane or fixed-body collider in the scene — dynamic bodies will fall forever.",
      hint: "Add a plane entity, or give a large box/cylinder physics.bodyType='fixed'.",
    });
  }

  // ── Camera / player ─────────────────────────────────────────────────
  const controllers = ents.filter(
    (e) => e.controllerKind && e.controllerKind !== "none",
  );
  if (controllers.length === 0) {
    issues.push({
      rule: "no-player",
      severity: "info",
      message:
        "No player entity (controllerKind set). Pressing Play will auto-spawn the default prefab if registered.",
      hint: "Use set_player to mark an entity as the player.",
    });
  } else if (controllers.length > 1) {
    issues.push({
      rule: "multiple-players",
      severity: "warn",
      message: `${controllers.length} entities have a controller — only one is supported per scene.`,
      entityIds: controllers.map((e) => e.id),
      hint: "Set controllerKind='none' on all but the intended player.",
    });
  }

  if (env.cameraMode === "follow" && !env.cameraTargetEntityId) {
    issues.push({
      rule: "follow-without-target",
      severity: "error",
      message: "cameraMode is 'follow' but no cameraTargetEntityId is set.",
      hint: "Set environment.cameraTargetEntityId or call set_player.",
    });
  }
  if (env.cameraTargetEntityId) {
    const target = ents.find((e) => e.id === env.cameraTargetEntityId);
    if (!target) {
      issues.push({
        rule: "camera-target-missing",
        severity: "error",
        message: `cameraTargetEntityId points at "${env.cameraTargetEntityId}" but no such entity exists.`,
        hint: "Clear the field or pick a real entity id.",
      });
    }
  }

  // ── Hierarchy integrity ─────────────────────────────────────────────
  const seenIds = new Set<string>();
  const dupIds: string[] = [];
  for (const e of ents) {
    if (seenIds.has(e.id)) dupIds.push(e.id);
    seenIds.add(e.id);
  }
  if (dupIds.length > 0) {
    issues.push({
      rule: "duplicate-ids",
      severity: "error",
      message: `Duplicate entity ids found (${dupIds.length}). The hierarchy will mis-render.`,
      entityIds: Array.from(new Set(dupIds)),
      hint: "Reload the scene to trigger sanitizeEntities, or recreate the duplicates.",
    });
  }

  const orphanParents: string[] = [];
  for (const e of ents) {
    if (e.parentId && !seenIds.has(e.parentId)) orphanParents.push(e.id);
  }
  if (orphanParents.length > 0) {
    issues.push({
      rule: "orphan-parent",
      severity: "warn",
      message: `${orphanParents.length} entities reference a missing parentId.`,
      entityIds: orphanParents,
      hint: "Reparent to null or a real entity, or reload to repair automatically.",
    });
  }

  // ── Physics sanity ──────────────────────────────────────────────────
  const dynamicWithoutCollider = ents.filter(
    (e) =>
      e.physics?.bodyType === "dynamic" && !e.physics?.colliderType,
  );
  if (dynamicWithoutCollider.length > 0) {
    issues.push({
      rule: "dynamic-without-collider",
      severity: "warn",
      message: `${dynamicWithoutCollider.length} dynamic bodies have no colliderType set.`,
      entityIds: dynamicWithoutCollider.map((e) => e.id),
      hint: "Set physics.colliderType to 'cuboid', 'ball', 'cylinder', or 'trimesh'.",
    });
  }

  // ── Scripts ─────────────────────────────────────────────────────────
  // Detect entities tagged with a controller but no script AND no behavior —
  // they'll have a body but no logic, which is rarely intentional.
  for (const e of ents) {
    if (
      e.controllerKind &&
      e.controllerKind !== "none" &&
      e.scriptId == null &&
      !e.behavior
    ) {
      // The built-in WASD controller still works without a script, so this
      // is informational, not a warning.
      issues.push({
        rule: "player-without-script",
        severity: "info",
        message: `Player entity "${e.name}" has no script attached — relying on the built-in controller only.`,
        entityIds: [e.id],
      });
    }
  }

  // ── Deathmatch-specific ─────────────────────────────────────────────
  if (input.deathmatch) {
    const behaviors = new Map<BehaviorKind, number>();
    for (const e of ents) {
      if (e.behavior) {
        behaviors.set(e.behavior, (behaviors.get(e.behavior) ?? 0) + 1);
      }
    }
    if (!behaviors.get("gamemode-deathmatch")) {
      issues.push({
        rule: "deathmatch-no-gamemode",
        severity: "warn",
        message:
          "Deathmatch scene has no entity with behavior='gamemode-deathmatch'.",
        hint: "Add an empty entity and set behavior to 'gamemode-deathmatch'.",
      });
    }
    if (!behaviors.get("spawnpoint")) {
      issues.push({
        rule: "deathmatch-no-spawnpoint",
        severity: "warn",
        message:
          "Deathmatch scene has no spawnpoint — players will spawn at the origin.",
        hint: "Mark one or more entities with behavior='spawnpoint'.",
      });
    }
    if (!behaviors.get("enemy-deathmatch")) {
      issues.push({
        rule: "deathmatch-no-enemies",
        severity: "info",
        message: "Deathmatch scene has no enemy-tagged entities yet.",
      });
    }
  }

  return issues;
}

/** Bucket helper used by the tool wrapper to summarize counts. */
export function summarizeBySeverity(issues: readonly Issue[]): Record<IssueSeverity, number> {
  const out: Record<IssueSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const i of issues) out[i.severity] = (out[i.severity] ?? 0) + 1;
  return out;
}
