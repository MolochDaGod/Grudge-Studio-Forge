/**
 * Optional next-step tool: batch_generate
 *
 * Not part of the P0 fleet-deploy / SDK slice. Lets the AI (or a power-user
 * follow-up) fill the scene with multiple CF AI assets or primitive packs
 * in one call instead of N sequential generate_texture / add_entity turns.
 *
 * Caps + concurrency keep CF Workers AI and the undo stack healthy.
 */
import { nanoid } from "nanoid";

import { useEditor } from "@/store/editor";
import { addEntitiesCommand, type StoreLike } from "@/lib/commands";
import type { SceneEntity, EntityType, Vec3 } from "@/scene/types";
import {
  gridLayout,
  ringLayout,
  lineLayout,
  scatterLayout,
  clusterLayout,
  type LayoutKind,
} from "@/ai/tools/design/layouts";
import {
  handlers as cfaiHandlers,
} from "@/ai/tools/cfai";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

/** Hard caps — optional tool must not melt the editor or CF quota. */
export const BATCH_GENERATE_MAX_JOBS = 12;
export const BATCH_GENERATE_MAX_PRIMITIVES = 48;
export const BATCH_GENERATE_DEFAULT_CONCURRENCY = 2;
export const BATCH_GENERATE_MAX_CONCURRENCY = 4;

export type BatchJobKind = "texture" | "skybox" | "lore" | "primitives";

export interface NormalizedBatchJob {
  id: string;
  kind: BatchJobKind;
  /** Original job payload (kind stripped). */
  payload: Record<string, unknown>;
}

const PRIMITIVE_TYPES = new Set<EntityType>([
  "box",
  "sphere",
  "cylinder",
  "plane",
  "empty",
]);

const LAYOUT_KINDS = new Set<LayoutKind>([
  "grid",
  "ring",
  "line",
  "scatter",
  "cluster",
]);

function editorStore(): StoreLike {
  return {
    getEntities: () => useEditor.getState().sceneData.entities,
    setEntities: (next) => useEditor.getState().setEntities(next),
    selectEntity: (id) => useEditor.getState().selectEntity(id),
  };
}

function asVec3(v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (
    Array.isArray(v) &&
    v.length >= 3 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    typeof v[2] === "number"
  ) {
    return [v[0], v[1], v[2]];
  }
  return fallback;
}

/** Pure: clamp + normalize jobs for tests and the handler. */
export function normalizeBatchJobs(
  raw: unknown,
): { ok: true; jobs: NormalizedBatchJob[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      error: "jobs must be a non-empty array (max " + BATCH_GENERATE_MAX_JOBS + ").",
    };
  }
  if (raw.length > BATCH_GENERATE_MAX_JOBS) {
    return {
      ok: false,
      error: `Too many jobs (${raw.length}). Cap is ${BATCH_GENERATE_MAX_JOBS}.`,
    };
  }

  const jobs: NormalizedBatchJob[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      return { ok: false, error: `jobs[${i}] must be an object.` };
    }
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    if (
      kind !== "texture" &&
      kind !== "skybox" &&
      kind !== "lore" &&
      kind !== "primitives"
    ) {
      return {
        ok: false,
        error: `jobs[${i}].kind must be texture|skybox|lore|primitives.`,
      };
    }
    const { kind: _k, id: maybeId, ...rest } = rec;
    jobs.push({
      id:
        typeof maybeId === "string" && maybeId.trim()
          ? maybeId.trim()
          : `job-${i + 1}`,
      kind,
      payload: rest,
    });
  }
  return { ok: true, jobs };
}

export function clampConcurrency(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return BATCH_GENERATE_DEFAULT_CONCURRENCY;
  }
  return Math.max(
    1,
    Math.min(BATCH_GENERATE_MAX_CONCURRENCY, Math.floor(n)),
  );
}

/** Run async tasks with a fixed concurrency pool. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function buildPrimitive(
  type: EntityType,
  name: string,
  position: Vec3,
  color?: string,
): SceneEntity {
  const e: SceneEntity = {
    id: nanoid(8),
    name,
    type,
    parentId: null,
    transform: {
      position,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  };
  if (color) e.material = { color };
  return e;
}

function positionsForPrimitives(
  count: number,
  pattern: LayoutKind,
  origin: Vec3,
  spacing: number,
  seed: number,
): Vec3[] {
  const base = { count, origin, spacing };
  switch (pattern) {
    case "ring":
      return ringLayout({ count, origin, radius: spacing * Math.max(2, count / 4) });
    case "line":
      return lineLayout({ count, origin, spacing });
    case "scatter":
      return scatterLayout({
        count,
        origin,
        radius: spacing * Math.max(3, Math.sqrt(count)),
        seed,
      });
    case "cluster":
      return clusterLayout({
        count,
        origin,
        fieldRadius: spacing * Math.max(3, Math.sqrt(count)),
        clusterRadius: Math.max(0.5, spacing * 0.75),
        seed,
      });
    case "grid":
    default:
      return gridLayout(base);
  }
}

async function runPrimitivesJob(
  payload: Record<string, unknown>,
): Promise<ToolResult> {
  const typeRaw = typeof payload.type === "string" ? payload.type : "box";
  if (!PRIMITIVE_TYPES.has(typeRaw as EntityType)) {
    return {
      ok: false,
      error: `primitives.type must be one of: ${[...PRIMITIVE_TYPES].join(", ")}`,
    };
  }
  const type = typeRaw as EntityType;
  let count =
    typeof payload.count === "number" && Number.isFinite(payload.count)
      ? Math.floor(payload.count)
      : 4;
  if (count < 1) count = 1;
  if (count > BATCH_GENERATE_MAX_PRIMITIVES) {
    return {
      ok: false,
      error: `primitives.count max is ${BATCH_GENERATE_MAX_PRIMITIVES}.`,
    };
  }

  const patternRaw =
    typeof payload.pattern === "string" ? payload.pattern : "grid";
  const pattern = (LAYOUT_KINDS.has(patternRaw as LayoutKind)
    ? patternRaw
    : "grid") as LayoutKind;

  const origin = asVec3(payload.origin, [0, 0.5, 0]);
  const spacing =
    typeof payload.spacing === "number" && payload.spacing > 0
      ? payload.spacing
      : 2;
  const seed =
    typeof payload.seed === "number" && Number.isFinite(payload.seed)
      ? payload.seed
      : 1;
  const color =
    typeof payload.color === "string" && payload.color.trim()
      ? payload.color.trim()
      : undefined;
  const namePrefix =
    typeof payload.namePrefix === "string" && payload.namePrefix.trim()
      ? payload.namePrefix.trim()
      : type[0].toUpperCase() + type.slice(1);

  const positions = positionsForPrimitives(
    count,
    pattern,
    origin,
    spacing,
    seed,
  );
  const entities = positions.map((pos, i) =>
    buildPrimitive(type, `${namePrefix}_${i + 1}`, pos, color),
  );

  useEditor.getState().commandStack.push(
    addEntitiesCommand(
      editorStore(),
      entities,
      `Batch generate ${count}× ${type} (${pattern})`,
      entities[0]?.id,
    ),
  );

  return {
    ok: true,
    data: {
      kind: "primitives",
      count: entities.length,
      pattern,
      type,
      ids: entities.map((e) => e.id),
      positions: entities.map((e) => e.transform.position),
    },
  };
}

async function runOneJob(job: NormalizedBatchJob): Promise<{
  id: string;
  kind: BatchJobKind;
  ok: boolean;
  data?: unknown;
  error?: string;
}> {
  try {
    let result: ToolResult;
    switch (job.kind) {
      case "texture":
        result = await cfaiHandlers.generate_texture(job.payload);
        break;
      case "skybox":
        result = await cfaiHandlers.generate_skybox(job.payload);
        break;
      case "lore":
        result = await cfaiHandlers.generate_lore(job.payload);
        break;
      case "primitives":
        result = await runPrimitivesJob(job.payload);
        break;
    }
    return {
      id: job.id,
      kind: job.kind,
      ok: result.ok,
      data: result.data,
      error: result.error,
    };
  } catch (err) {
    return {
      id: job.id,
      kind: job.kind,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const BATCH_GENERATE: ToolDef = {
  name: "batch_generate",
  description:
    "OPTIONAL multi-job generator (not required for deploy). Run up to 12 jobs in one call: " +
    "CF AI texture / skybox / lore, or primitive packs (box/sphere/cylinder/plane/empty) laid out on grid|ring|line|scatter. " +
    "Prefer this when the user asks to fill many surfaces, spawn a prop pack, or generate several textures at once. " +
    "Do NOT use for fleet publish / one-click deploy — that is a separate path. " +
    "Concurrency defaults to 2 (max 4). Returns per-job ok/error + ids/urls.",
  input_schema: {
    type: "object",
    required: ["jobs"],
    properties: {
      jobs: {
        type: "array",
        minItems: 1,
        maxItems: BATCH_GENERATE_MAX_JOBS,
        description:
          "Job list. Each job needs kind. texture/skybox/lore share generate_* fields; primitives uses type+count+pattern.",
        items: {
          type: "object",
          required: ["kind"],
          properties: {
            id: {
              type: "string",
              description: "Optional job id for correlating results.",
            },
            kind: {
              type: "string",
              enum: ["texture", "skybox", "lore", "primitives"],
            },
            // texture / skybox / lore
            prompt: { type: "string" },
            model: { type: "string" },
            entityIds: {
              type: "array",
              items: { type: "string" },
              description: "texture only — auto-apply albedo to these entities.",
            },
            entityId: { type: "string" },
            slot: { type: "string" },
            mapRepeat: {
              type: "array",
              items: { type: "number" },
              minItems: 2,
              maxItems: 2,
            },
            apply: {
              type: "boolean",
              description: "skybox only — apply as skyTexture (default true).",
            },
            system: { type: "string", description: "lore only — system tone." },
            maxTokens: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            negativePrompt: { type: "string" },
            steps: { type: "number" },
            guidance: { type: "number" },
            seed: { type: "number" },
            // primitives
            type: {
              type: "string",
              enum: ["box", "sphere", "cylinder", "plane", "empty"],
              description: "primitives only.",
            },
            count: {
              type: "integer",
              description: `primitives only. 1–${BATCH_GENERATE_MAX_PRIMITIVES}.`,
            },
            pattern: {
              type: "string",
              enum: ["grid", "ring", "line", "scatter", "cluster"],
            },
            origin: {
              type: "array",
              items: { type: "number" },
              minItems: 3,
              maxItems: 3,
            },
            spacing: { type: "number" },
            color: { type: "string" },
            namePrefix: { type: "string" },
          },
          additionalProperties: true,
        },
      },
      concurrency: {
        type: "integer",
        description: `Parallel CF jobs (1–${BATCH_GENERATE_MAX_CONCURRENCY}). Default ${BATCH_GENERATE_DEFAULT_CONCURRENCY}.`,
      },
    },
    additionalProperties: false,
  },
};

const batchGenerateHandler: ToolHandler = async (input) => {
  const normalized = normalizeBatchJobs(input.jobs);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const concurrency = clampConcurrency(input.concurrency);
  const jobs = normalized.jobs;

  // Primitives mutate the scene and should stay sequential so undo stays one
  // command per pack; CF AI jobs can pool. Split for safety.
  const cfJobs = jobs.filter((j) => j.kind !== "primitives");
  const primJobs = jobs.filter((j) => j.kind === "primitives");

  const cfResults = await mapPool(cfJobs, concurrency, (job) => runOneJob(job));
  const primResults: Awaited<ReturnType<typeof runOneJob>>[] = [];
  for (const job of primJobs) {
    primResults.push(await runOneJob(job));
  }

  // Preserve original job order in the response
  const byId = new Map(
    [...cfResults, ...primResults].map((r) => [r.id, r] as const),
  );
  const results = jobs.map((j) => byId.get(j.id)!);

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  useEditor.getState().pushLog(
    failCount === 0 ? "info" : "warn",
    `batch_generate: ${okCount}/${results.length} ok` +
      (failCount ? ` · ${failCount} failed` : ""),
  );

  return {
    ok: failCount === 0,
    data: {
      optional: true,
      note: "batch_generate is an optional content tool — not the fleet deploy path.",
      concurrency,
      okCount,
      failCount,
      results,
    },
    error:
      failCount === 0
        ? undefined
        : `${failCount} of ${results.length} jobs failed — see results[].error`,
  };
};

export const defs: ToolDef[] = [BATCH_GENERATE];

export const handlers: Record<string, ToolHandler> = {
  batch_generate: batchGenerateHandler,
};

/** Mutates scene when textures/skyboxes/primitives succeed. */
export const destructiveToolNames: string[] = ["batch_generate"];
