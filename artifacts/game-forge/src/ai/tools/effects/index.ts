/**
 * Effects tools for the AI Worker.
 *
 * Lets the assistant tune the global wind vector and the per-entity
 * soft-body / particle parameters consumed by the verlet + emitter
 * simulation in `EntityRenderer`. Wind writes through
 * `cmdSetEnvironment`; soft-body writes through `cmdUpdateEntity` so
 * both routes are undoable like the matching Inspector edits.
 */
import { useEditor } from "@/store/editor";
import {
  type SoftBodyComponent,
  type Vec3,
} from "@workspace/scene-schema";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const SOFT_BODY_TYPES = new Set(["cloth", "flag", "particles"]);

const asVec3 = (v: unknown): Vec3 | null => {
  if (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return [v[0], v[1], v[2]];
  }
  return null;
};

const clampSegments = (n: number) =>
  Math.max(2, Math.min(64, Math.round(n)));

// ── set_wind ─────────────────────────────────────────────────────────
const SET_WIND: ToolDef = {
  name: "set_wind",
  description:
    "Set the scene's global wind vector (m/s² applied to cloth/flag verts and as a velocity bias on spawned particles). +X is east, +Y is up, +Z is south. Examples: [0,0,0] for dead calm, [1.5,0,0] for a light breeze, [8,0,2] for a stiff gust. Routes through the command stack so Ctrl+Z reverts.",
  input_schema: {
    type: "object",
    properties: {
      wind: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
        description: "World-space wind vector [x, y, z].",
      },
    },
    required: ["wind"],
    additionalProperties: false,
  },
};

const setWindHandler: ToolHandler = async (input) => {
  const wind = asVec3(input.wind);
  if (!wind) {
    return { ok: false, error: "wind must be a [x, y, z] array of three numbers." };
  }
  const before = useEditor.getState().sceneData.environment.wind;
  useEditor.getState().cmdSetEnvironment({ wind }, "Set wind");
  return { ok: true, data: { wind, previous: before ?? null } };
};

// ── set_soft_body ────────────────────────────────────────────────────
const SET_SOFT_BODY: ToolDef = {
  name: "set_soft_body",
  description:
    "Tune the verlet / particle parameters on one or more cloth, flag, or particles entities in a single undoable step. Cloth & flag accept damping, segmentsX/Y (2..64), and pin (topCorners | topEdge | none). Particles accept emitRate (≥0/sec), lifetime (>0/sec), emitVelocity (m/s, +Y up), mode (continuous|burst), burstCount (≥0), burstInterval (>0/sec). Only the fields you supply are changed; others are preserved. Use 'make the flag flutter harder' → lower damping + a stronger wind via set_wind.",
  input_schema: {
    type: "object",
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Entities to update — must be cloth / flag / particles.",
      },
      damping: { type: "number", description: "0..1 per-step velocity damping." },
      emitRate: { type: "number", description: "Particles/sec (≥0)." },
      lifetime: { type: "number", description: "Particle lifetime in seconds (>0)." },
      emitVelocity: { type: "number", description: "Initial vertical velocity m/s." },
      segmentsX: { type: "integer", description: "Cloth/flag width segments (2..64)." },
      segmentsY: { type: "integer", description: "Cloth/flag height segments (2..64)." },
      pin: { type: "string", enum: ["topCorners", "topEdge", "none"] },
      mode: { type: "string", enum: ["continuous", "burst"] },
      burstCount: { type: "integer", description: "Particles per burst (≥0)." },
      burstInterval: { type: "number", description: "Seconds between bursts (>0)." },
    },
    required: ["entityIds"],
    additionalProperties: false,
  },
};

const setSoftBodyHandler: ToolHandler = async (input) => {
  const ids = Array.isArray(input.entityIds)
    ? input.entityIds.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0) {
    return { ok: false, error: "entityIds must include at least one id." };
  }

  const patch: Partial<SoftBodyComponent> = {};

  if (input.damping !== undefined) {
    if (typeof input.damping !== "number" || !Number.isFinite(input.damping)) {
      return { ok: false, error: "damping must be a finite number." };
    }
    patch.damping = Math.max(0, Math.min(1, input.damping));
  }
  if (input.emitRate !== undefined) {
    if (typeof input.emitRate !== "number" || !Number.isFinite(input.emitRate)) {
      return { ok: false, error: "emitRate must be a finite number." };
    }
    if (input.emitRate < 0) {
      return { ok: false, error: "emitRate must be ≥ 0." };
    }
    patch.emitRate = input.emitRate;
  }
  if (input.lifetime !== undefined) {
    if (typeof input.lifetime !== "number" || !Number.isFinite(input.lifetime) || input.lifetime <= 0) {
      return { ok: false, error: "lifetime must be a positive number." };
    }
    patch.lifetime = input.lifetime;
  }
  if (input.emitVelocity !== undefined) {
    if (typeof input.emitVelocity !== "number" || !Number.isFinite(input.emitVelocity)) {
      return { ok: false, error: "emitVelocity must be a finite number." };
    }
    patch.emitVelocity = input.emitVelocity;
  }
  if (input.segmentsX !== undefined) {
    if (typeof input.segmentsX !== "number" || !Number.isFinite(input.segmentsX)) {
      return { ok: false, error: "segmentsX must be a number." };
    }
    patch.segmentsX = clampSegments(input.segmentsX);
  }
  if (input.segmentsY !== undefined) {
    if (typeof input.segmentsY !== "number" || !Number.isFinite(input.segmentsY)) {
      return { ok: false, error: "segmentsY must be a number." };
    }
    patch.segmentsY = clampSegments(input.segmentsY);
  }
  if (input.pin !== undefined) {
    if (input.pin !== "topCorners" && input.pin !== "topEdge" && input.pin !== "none") {
      return { ok: false, error: "pin must be one of: topCorners, topEdge, none." };
    }
    patch.pin = input.pin;
  }
  if (input.mode !== undefined) {
    if (input.mode !== "continuous" && input.mode !== "burst") {
      return { ok: false, error: "mode must be one of: continuous, burst." };
    }
    patch.mode = input.mode;
  }
  if (input.burstCount !== undefined) {
    if (typeof input.burstCount !== "number" || !Number.isFinite(input.burstCount) || input.burstCount < 0) {
      return { ok: false, error: "burstCount must be ≥ 0." };
    }
    patch.burstCount = Math.max(0, Math.round(input.burstCount));
  }
  if (input.burstInterval !== undefined) {
    if (typeof input.burstInterval !== "number" || !Number.isFinite(input.burstInterval) || input.burstInterval <= 0) {
      return { ok: false, error: "burstInterval must be a positive number." };
    }
    patch.burstInterval = input.burstInterval;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Supply at least one tunable field besides entityIds." };
  }

  const state = useEditor.getState();
  const entities = state.sceneData.entities;
  const updated: { id: string; name: string; type: string; previous: SoftBodyComponent | null }[] = [];
  const notFound: string[] = [];
  const wrongType: { id: string; type: string }[] = [];

  for (const id of ids) {
    const target = entities.find((e) => e.id === id);
    if (!target) {
      notFound.push(id);
      continue;
    }
    if (!SOFT_BODY_TYPES.has(target.type)) {
      wrongType.push({ id, type: target.type });
      continue;
    }
    updated.push({
      id,
      name: target.name,
      type: target.type,
      previous: target.softBody ? { ...target.softBody } : null,
    });
    state.cmdUpdateEntity(id, (e) => {
      e.softBody = { ...(e.softBody ?? {}), ...patch };
    });
  }

  if (updated.length === 0) {
    return {
      ok: false,
      error:
        wrongType.length > 0
          ? `No cloth/flag/particles entities matched. Wrong type: ${wrongType.map((w) => `${w.id} (${w.type})`).join(", ")}`
          : `No matching entities: ${notFound.join(", ")}`,
    };
  }

  return {
    ok: true,
    data: {
      patch,
      count: updated.length,
      updated,
      notFound: notFound.length ? notFound : undefined,
      wrongType: wrongType.length ? wrongType : undefined,
    },
  };
};

export const defs: ToolDef[] = [SET_WIND, SET_SOFT_BODY];

export const handlers: Record<string, ToolHandler> = {
  set_wind: setWindHandler,
  set_soft_body: setSoftBodyHandler,
};

export const destructiveToolNames: string[] = ["set_wind", "set_soft_body"];
