/**
 * Motion / texture / physics AI tools.
 *
 * Complements materials + scripting:
 *   - set_material_map  — attach albedo/normal/roughness/etc. URLs
 *   - list_animations / apply_animation — clip catalog + model.clip
 *   - set_physics — Rapier body/collider/mass/ccd/damping in one undo step
 */
import { useEditor } from "@/store/editor";
import type { MaterialComponent, BodyType, SceneEntity } from "@workspace/scene-schema";
import {
  ANIMATION_CATALOG,
  type AnimationClip,
} from "@/lib/animationLibrary";
import { resolveModelUrl } from "@/lib/builtinModels";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const BODY_TYPES: BodyType[] = [
  "fixed",
  "dynamic",
  "kinematicPosition",
  "kinematicVelocity",
];

const COLLIDER_TYPES = [
  "cuboid",
  "ball",
  "cylinder",
  "trimesh",
  "convex-decomp",
] as const;

// ── set_material_map ─────────────────────────────────────────────────

const SET_MATERIAL_MAP: ToolDef = {
  name: "set_material_map",
  description:
    "Attach PBR texture map URL(s) to one or more entities' materials. " +
    "Use after generate_texture / import_asset_from_url. Maps: mapUrl (albedo), " +
    "normalMapUrl, roughnessMapUrl, metalnessMapUrl, emissiveMapUrl. " +
    "Optional mapRepeat [u,v] tiles the UVs. Undoable.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Target entity ids.",
      },
      mapUrl: { type: "string", description: "Albedo / diffuse texture URL." },
      normalMapUrl: { type: "string" },
      roughnessMapUrl: { type: "string" },
      metalnessMapUrl: { type: "string" },
      emissiveMapUrl: { type: "string" },
      mapRepeat: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "UV repeat [u, v], e.g. [4, 4] for tiling floors.",
      },
      clear: {
        type: "boolean",
        description: "If true, clear all map URLs on the entities.",
      },
    },
    required: ["entityIds"],
    additionalProperties: false,
  },
};

const setMaterialMapHandler: ToolHandler = async (input) => {
  const ids = Array.isArray(input.entityIds)
    ? input.entityIds.filter((v): v is string => typeof v === "string")
    : [];
  if (!ids.length) return { ok: false, error: "entityIds required." };

  const clear = input.clear === true;
  const mapFields: (keyof MaterialComponent)[] = [
    "mapUrl",
    "normalMapUrl",
    "roughnessMapUrl",
    "metalnessMapUrl",
    "emissiveMapUrl",
  ];
  const patch: Partial<MaterialComponent> = {};
  if (clear) {
    for (const k of mapFields) patch[k] = undefined;
    patch.mapRepeat = undefined;
  } else {
    for (const k of mapFields) {
      if (typeof input[k] === "string" && (input[k] as string).trim()) {
        (patch as Record<string, string>)[k] = (input[k] as string).trim();
      }
    }
    if (
      Array.isArray(input.mapRepeat) &&
      input.mapRepeat.length >= 2 &&
      typeof input.mapRepeat[0] === "number" &&
      typeof input.mapRepeat[1] === "number"
    ) {
      patch.mapRepeat = [input.mapRepeat[0], input.mapRepeat[1]];
    }
    if (Object.keys(patch).length === 0) {
      return {
        ok: false,
        error: "Provide at least one map URL, mapRepeat, or clear:true.",
      };
    }
  }

  const updated: string[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const e = useEditor.getState().sceneData.entities.find((x) => x.id === id);
    if (!e) {
      missing.push(id);
      continue;
    }
    useEditor.getState().cmdUpdateEntity(id, (ent) => {
      const next: MaterialComponent = { ...(ent.material ?? {}) };
      if (clear) {
        delete next.mapUrl;
        delete next.normalMapUrl;
        delete next.roughnessMapUrl;
        delete next.metalnessMapUrl;
        delete next.emissiveMapUrl;
        delete next.mapRepeat;
      } else {
        Object.assign(next, patch);
      }
      ent.material = next;
    });
    updated.push(id);
  }

  return {
    ok: updated.length > 0,
    data: { updated, missing: missing.length ? missing : undefined, patch },
    error: updated.length ? undefined : `No entities found: ${missing.join(", ")}`,
  };
};

// ── list_animations ──────────────────────────────────────────────────

const LIST_ANIMATIONS: ToolDef = {
  name: "list_animations",
  description:
    "List the Forge animation catalog (locomotion, combat, emote, utility). " +
    "Use apply_animation with a catalog key to set model.clip on a character. " +
    "Builtin loco-* / magic-* clips also work via apply_animation source.",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["locomotion", "combat", "emote", "utility"],
        description: "Optional category filter.",
      },
    },
    additionalProperties: false,
  },
};

const listAnimationsHandler: ToolHandler = async (input) => {
  const cat =
    typeof input.category === "string" ? input.category : null;
  const clips = ANIMATION_CATALOG.filter(
    (c) => !cat || c.category === cat,
  ).map((c: AnimationClip) => ({
    key: c.key,
    name: c.name,
    category: c.category,
    duration: c.duration,
    loop: c.loop,
    skeleton: c.skeleton,
    description: c.description,
    source: c.source,
  }));
  return {
    ok: true,
    data: {
      count: clips.length,
      clips,
      builtinLoco: [
        "idle",
        "walk",
        "run",
        "jump",
        "loco-idle",
        "loco-walking",
        "loco-running",
        "loco-jump",
      ],
      tip: "apply_animation entityId + clip key. Procedural biped synthesis also provides idle/walk/run/attack/death when GLB has no clips.",
    },
  };
};

// ── apply_animation ──────────────────────────────────────────────────

const APPLY_ANIMATION: ToolDef = {
  name: "apply_animation",
  description:
    "Set the playing animation clip on a model entity (entity.model.clip). " +
    "Use list_animations for catalog keys (idle, walk, run, attack-sword, death, …) " +
    "or pass any clip name present in the GLB / procedural biped set. Undoable.",
  input_schema: {
    type: "object",
    properties: {
      entityId: { type: "string" },
      clip: {
        type: "string",
        description: "Catalog key or raw AnimationClip name.",
      },
      clear: {
        type: "boolean",
        description: "If true, clear model.clip (auto-pick idle).",
      },
    },
    required: ["entityId"],
    additionalProperties: false,
  },
};

const applyAnimationHandler: ToolHandler = async (input) => {
  const entityId = typeof input.entityId === "string" ? input.entityId : "";
  if (!entityId) return { ok: false, error: "entityId required." };
  const e = useEditor.getState().sceneData.entities.find((x) => x.id === entityId);
  if (!e) return { ok: false, error: `Entity not found: ${entityId}` };
  if (e.type !== "model" && !e.model) {
    return {
      ok: false,
      error: "apply_animation only works on model entities with a model component.",
    };
  }

  if (input.clear === true) {
    useEditor.getState().cmdUpdateEntity(entityId, (ent) => {
      if (!ent.model) return;
      delete ent.model.clip;
    });
    return { ok: true, data: { entityId, clip: null } };
  }

  let clip = typeof input.clip === "string" ? input.clip.trim() : "";
  if (!clip) return { ok: false, error: "clip is required (or clear:true)." };

  // Resolve catalog key → preferred playback name
  const catalog = ANIMATION_CATALOG.find(
    (c) => c.key === clip || c.name.toLowerCase() === clip.toLowerCase(),
  );
  if (catalog) {
    // Prefer short keys that match procedural biped / agent FSM names
    clip =
      catalog.key === "attack-sword" || catalog.key === "attack-2h"
        ? "attack"
        : catalog.key === "hit-react"
          ? "hit"
          : catalog.key.startsWith("attack")
            ? "attack"
            : catalog.key === "death"
              ? "death"
              : catalog.key;
  }

  const previous = e.model?.clip ?? null;
  useEditor.getState().cmdUpdateEntity(entityId, (ent) => {
    ent.model = { ...(ent.model ?? { url: "" }), clip };
  });

  // Optional: if source is builtin: loco, also allow resolving model URL
  let resolvedSource: string | null = null;
  if (catalog?.source.startsWith("builtin:")) {
    try {
      resolvedSource = resolveModelUrl(catalog.source);
    } catch {
      resolvedSource = catalog.source;
    }
  }

  return {
    ok: true,
    data: {
      entityId,
      clip,
      previous,
      catalogKey: catalog?.key ?? null,
      resolvedSource,
    },
  };
};

// ── set_physics ──────────────────────────────────────────────────────

const SET_PHYSICS: ToolDef = {
  name: "set_physics",
  description:
    "Configure Rapier physics on one or more entities in one undoable edit. " +
    "bodyType: fixed|dynamic|kinematicPosition|kinematicVelocity. " +
    "colliderType: cuboid|ball|cylinder|trimesh|convex-decomp. " +
    "Also: mass, friction, restitution, ccd (fast projectiles), linearDamping, " +
    "angularDamping, capsuleHalfHeight/capsuleRadius for character capsules. " +
    "Prefer cylinder + kinematicPosition for player/NPC characters.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
      bodyType: { type: "string", enum: BODY_TYPES },
      colliderType: { type: "string", enum: [...COLLIDER_TYPES] },
      mass: { type: "number" },
      friction: { type: "number" },
      restitution: { type: "number" },
      ccd: { type: "boolean" },
      linearDamping: { type: "number" },
      angularDamping: { type: "number" },
      capsuleHalfHeight: { type: "number" },
      capsuleRadius: { type: "number" },
      clear: {
        type: "boolean",
        description: "Remove the physics component entirely.",
      },
    },
    required: ["entityIds"],
    additionalProperties: false,
  },
};

const setPhysicsHandler: ToolHandler = async (input) => {
  const ids = Array.isArray(input.entityIds)
    ? input.entityIds.filter((v): v is string => typeof v === "string")
    : [];
  if (!ids.length) return { ok: false, error: "entityIds required." };

  const updated: Array<{ id: string; physics: SceneEntity["physics"] }> = [];
  const missing: string[] = [];

  for (const id of ids) {
    const e = useEditor.getState().sceneData.entities.find((x) => x.id === id);
    if (!e) {
      missing.push(id);
      continue;
    }
    useEditor.getState().cmdUpdateEntity(id, (ent) => {
      if (input.clear === true) {
        delete ent.physics;
        return;
      }
      const ph = { ...(ent.physics ?? {}) };
      if (typeof input.bodyType === "string" && BODY_TYPES.includes(input.bodyType as BodyType)) {
        ph.bodyType = input.bodyType as BodyType;
      }
      if (
        typeof input.colliderType === "string" &&
        (COLLIDER_TYPES as readonly string[]).includes(input.colliderType)
      ) {
        ph.colliderType = input.colliderType as NonNullable<
          SceneEntity["physics"]
        >["colliderType"];
      }
      if (typeof input.mass === "number") ph.mass = input.mass;
      if (typeof input.friction === "number") ph.friction = input.friction;
      if (typeof input.restitution === "number") ph.restitution = input.restitution;
      if (typeof input.ccd === "boolean") ph.ccd = input.ccd;
      if (typeof input.linearDamping === "number") ph.linearDamping = input.linearDamping;
      if (typeof input.angularDamping === "number") ph.angularDamping = input.angularDamping;
      if (typeof input.capsuleHalfHeight === "number") {
        ph.capsuleHalfHeight = input.capsuleHalfHeight;
      }
      if (typeof input.capsuleRadius === "number") {
        ph.capsuleRadius = input.capsuleRadius;
      }
      // Defaults when first enabling physics
      if (!ph.bodyType) ph.bodyType = "dynamic";
      if (!ph.colliderType) ph.colliderType = "cuboid";
      ent.physics = ph;
    });
    const after = useEditor.getState().sceneData.entities.find((x) => x.id === id);
    updated.push({ id, physics: after?.physics });
  }

  return {
    ok: updated.length > 0,
    data: { updated, missing: missing.length ? missing : undefined },
    error: updated.length ? undefined : `No entities found: ${missing.join(", ")}`,
  };
};

// ── exports ──────────────────────────────────────────────────────────

export const defs: ToolDef[] = [
  SET_MATERIAL_MAP,
  LIST_ANIMATIONS,
  APPLY_ANIMATION,
  SET_PHYSICS,
];

export const handlers: Record<string, ToolHandler> = {
  set_material_map: setMaterialMapHandler,
  list_animations: listAnimationsHandler,
  apply_animation: applyAnimationHandler,
  set_physics: setPhysicsHandler,
};

export const destructiveToolNames: string[] = [
  "set_material_map",
  "apply_animation",
  "set_physics",
];
