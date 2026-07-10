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
import {
  normalizeCatalogClip,
  publishAgentClip,
} from "@/lib/animationClipResolve";

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

const MAP_SLOTS = [
  "mapUrl",
  "normalMapUrl",
  "roughnessMapUrl",
  "metalnessMapUrl",
  "emissiveMapUrl",
] as const;

// ── set_material_map ─────────────────────────────────────────────────

const SET_MATERIAL_MAP: ToolDef = {
  name: "set_material_map",
  description:
    "Attach PBR texture map URL(s) to one or more entities' materials. " +
    "Use after generate_texture / import_asset_from_url. Maps: mapUrl (albedo), " +
    "normalMapUrl, roughnessMapUrl, metalnessMapUrl, emissiveMapUrl. " +
    "Optional mapRepeat [u,v] tiles the UVs. Pass slot='mapUrl' with url= for a single map. Undoable.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Target entity ids.",
      },
      entityId: {
        type: "string",
        description: "Single entity id (alias for entityIds:[id]).",
      },
      url: {
        type: "string",
        description:
          "Single texture URL — applied to `slot` (default mapUrl/albedo).",
      },
      slot: {
        type: "string",
        enum: [...MAP_SLOTS],
        description: "Which map slot receives `url`. Default mapUrl.",
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
    additionalProperties: false,
  },
};

function collectEntityIds(input: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (typeof input.entityId === "string" && input.entityId.trim()) {
    ids.push(input.entityId.trim());
  }
  if (Array.isArray(input.entityIds)) {
    for (const v of input.entityIds) {
      if (typeof v === "string" && v.trim()) ids.push(v.trim());
    }
  }
  return [...new Set(ids)];
}

const setMaterialMapHandler: ToolHandler = async (input) => {
  const ids = collectEntityIds(input);
  if (!ids.length) {
    return {
      ok: false,
      error: "entityIds (or entityId) required. Pass the ids from list_entities / add_entity.",
    };
  }

  const clear = input.clear === true;
  const patch: Partial<MaterialComponent> = {};

  if (clear) {
    // handled per-entity below
  } else {
    for (const k of MAP_SLOTS) {
      if (typeof input[k] === "string" && (input[k] as string).trim()) {
        (patch as Record<string, string>)[k] = (input[k] as string).trim();
      }
    }
    // Convenience: url + slot
    if (typeof input.url === "string" && input.url.trim()) {
      const slot =
        typeof input.slot === "string" &&
        (MAP_SLOTS as readonly string[]).includes(input.slot)
          ? (input.slot as (typeof MAP_SLOTS)[number])
          : "mapUrl";
      (patch as Record<string, string>)[slot] = input.url.trim();
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
        error:
          "Provide url (or mapUrl/normalMapUrl/…), mapRepeat, or clear:true.",
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
        // Ensure kind exists so renderer treats material as intentional
        if (!next.kind) next.kind = "Custom";
      }
      ent.material = next;
    });
    updated.push(id);
  }

  if (updated.length) {
    useEditor.getState().pushLog(
      "info",
      `Textures applied to ${updated.length} entit${updated.length === 1 ? "y" : "ies"}${
        patch.mapUrl ? ` (albedo)` : ""
      }.`,
    );
  }

  return {
    ok: updated.length > 0,
    data: {
      updated,
      missing: missing.length ? missing : undefined,
      maps: clear ? null : patch,
    },
    error: updated.length
      ? undefined
      : `No entities found: ${missing.join(", ")}`,
  };
};

// ── list_animations ──────────────────────────────────────────────────

const LIST_ANIMATIONS: ToolDef = {
  name: "list_animations",
  description:
    "List the Forge animation catalog (locomotion, combat, emote, utility). " +
    "Use apply_animation with a catalog key to set model.clip on a character. " +
    "Procedural biped clips: idle, walk, run, attack, death, jump, climb, swim.",
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
  const cat = typeof input.category === "string" ? input.category : null;
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
    playAs: normalizeCatalogClip(c.key),
  }));
  return {
    ok: true,
    data: {
      count: clips.length,
      clips,
      proceduralBiped: [
        "idle",
        "walk",
        "run",
        "attack",
        "death",
        "jump",
        "climb",
        "swim",
      ],
      tip: "apply_animation({ entityId, clip: 'walk' }). Works in edit mode via live crossfade.",
    },
  };
};

// ── apply_animation ──────────────────────────────────────────────────

const APPLY_ANIMATION: ToolDef = {
  name: "apply_animation",
  description:
    "Play an animation on a model entity (sets model.clip + live preview). " +
    "clip: idle|walk|run|jump|attack|death or any list_animations key. " +
    "Supports entityId or entityIds. Undoable. Works immediately in the viewport.",
  input_schema: {
    type: "object",
    properties: {
      entityId: { type: "string" },
      entityIds: { type: "array", items: { type: "string" } },
      clip: {
        type: "string",
        description: "Catalog key or raw AnimationClip name (idle, walk, run, attack, death…).",
      },
      clear: {
        type: "boolean",
        description: "If true, clear model.clip (return to auto idle).",
      },
    },
    additionalProperties: false,
  },
};

const applyAnimationHandler: ToolHandler = async (input) => {
  const ids = collectEntityIds(input);
  if (!ids.length) {
    return { ok: false, error: "entityId or entityIds required." };
  }

  const clear = input.clear === true;
  let clipRaw = typeof input.clip === "string" ? input.clip.trim() : "";
  if (!clear && !clipRaw) {
    return { ok: false, error: "clip is required (or clear:true)." };
  }

  // Catalog resolution
  const catalog = clipRaw
    ? ANIMATION_CATALOG.find(
        (c) =>
          c.key === clipRaw ||
          c.key.toLowerCase() === clipRaw.toLowerCase() ||
          c.name.toLowerCase() === clipRaw.toLowerCase(),
      )
    : undefined;
  const playClip = clear
    ? null
    : normalizeCatalogClip(catalog?.key ?? clipRaw);

  const results: Array<{
    entityId: string;
    clip: string | null;
    previous: string | null;
    ok: boolean;
    error?: string;
  }> = [];

  for (const entityId of ids) {
    const e = useEditor.getState().sceneData.entities.find((x) => x.id === entityId);
    if (!e) {
      results.push({
        entityId,
        clip: playClip,
        previous: null,
        ok: false,
        error: "not found",
      });
      continue;
    }
    if (e.type !== "model" && !e.model?.url) {
      results.push({
        entityId,
        clip: playClip,
        previous: null,
        ok: false,
        error: "not a model entity",
      });
      continue;
    }

    const previous = e.model?.clip ?? null;

    if (clear) {
      useEditor.getState().cmdUpdateEntity(entityId, (ent) => {
        if (!ent.model) return;
        const { clip: _c, ...rest } = ent.model;
        ent.model = rest as typeof ent.model;
        // ensure url preserved
        if (!ent.model.url && e.model?.url) ent.model.url = e.model.url;
        delete ent.model.clip;
      });
      publishAgentClip(entityId, null);
      results.push({ entityId, clip: null, previous, ok: true });
      continue;
    }

    // Ensure model component exists
    useEditor.getState().cmdUpdateEntity(entityId, (ent) => {
      const baseUrl =
        ent.model?.url ||
        e.model?.url ||
        (ent.type === "model" ? "builtin:character" : "");
      ent.model = {
        ...(ent.model ?? {}),
        url: baseUrl || ent.model?.url || "builtin:character",
        clip: playClip!,
      };
      ent.type = "model";
    });
    // Live preview in edit mode (LoadedModel polls __agentClips each frame)
    publishAgentClip(entityId, playClip);

    results.push({ entityId, clip: playClip, previous, ok: true });
  }

  const okCount = results.filter((r) => r.ok).length;
  if (okCount) {
    useEditor.getState().pushLog(
      "info",
      `Animation "${playClip ?? "cleared"}" on ${okCount} model(s).`,
    );
  }

  let resolvedSource: string | null = null;
  if (catalog?.source.startsWith("builtin:")) {
    try {
      resolvedSource = resolveModelUrl(catalog.source);
    } catch {
      resolvedSource = catalog.source;
    }
  }

  return {
    ok: okCount > 0,
    data: {
      results,
      clip: playClip,
      catalogKey: catalog?.key ?? null,
      resolvedSource,
      tip:
        okCount > 0
          ? "Clip applied. If the GLB has no baked animations, procedural biped idle/walk/run/attack/death still play."
          : undefined,
    },
    error:
      okCount > 0
        ? undefined
        : results.map((r) => r.error).filter(Boolean).join("; ") ||
          "No models updated.",
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
      entityId: { type: "string" },
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
    additionalProperties: false,
  },
};

const setPhysicsHandler: ToolHandler = async (input) => {
  const ids = collectEntityIds(input);
  if (!ids.length) return { ok: false, error: "entityIds (or entityId) required." };

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
      if (
        typeof input.bodyType === "string" &&
        BODY_TYPES.includes(input.bodyType as BodyType)
      ) {
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
      if (typeof input.angularDamping === "number") {
        ph.angularDamping = input.angularDamping;
      }
      if (typeof input.capsuleHalfHeight === "number") {
        ph.capsuleHalfHeight = input.capsuleHalfHeight;
      }
      if (typeof input.capsuleRadius === "number") {
        ph.capsuleRadius = input.capsuleRadius;
      }
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
    error: updated.length
      ? undefined
      : `No entities found: ${missing.join(", ")}`,
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
