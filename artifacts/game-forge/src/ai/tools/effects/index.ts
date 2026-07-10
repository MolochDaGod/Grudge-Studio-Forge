/**
 * Effects tools for the AI Worker.
 *
 * Wind, soft-body / particle params, celestial sky, weather FX, and
 * named atmosphere presets. Environment writes go through
 * `cmdSetEnvironment`; soft-body through `cmdUpdateEntity`.
 */
import { useEditor } from "@/store/editor";
import {
  type SoftBodyComponent,
  type Environment,
  type Vec3,
} from "@workspace/scene-schema";
import {
  ATMOSPHERE_PRESETS,
  WEATHER_TYPES,
  findAtmospherePreset,
  type WeatherType,
} from "./atmosphere";

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

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clampSegments = (n: number) =>
  Math.max(2, Math.min(64, Math.round(n)));

// ── set_wind ─────────────────────────────────────────────────────────
const SET_WIND: ToolDef = {
  name: "set_wind",
  description:
    "Set the scene's global wind vector (m/s² applied to cloth/flag verts, weather particles, and as a velocity bias on spawned particles). +X is east, +Y is up, +Z is south. Examples: [0,0,0] for dead calm, [1.5,0,0] for a light breeze, [8,0,2] for a stiff gust. Routes through the command stack so Ctrl+Z reverts.",
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

// ── set_celestial ────────────────────────────────────────────────────
const SET_CELESTIAL: ToolDef = {
  name: "set_celestial",
  description:
    "Configure the procedural celestial sky dome (time of day, stars, sun, moon, aurora, colors). " +
    "timeOfDay: 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset. stars/aurora 0–1. " +
    "Merges with existing celestial config. Directional sun light tracks timeOfDay. " +
    "For a full AI-generated panorama use generate_skybox instead (sets skyTexture).",
  input_schema: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      timeOfDay: {
        type: "number",
        description: "0–1 day cycle (0 midnight, 0.5 noon, 0.75 sunset).",
      },
      stars: { type: "number", description: "Star density/brightness 0–1." },
      sun: { type: "boolean" },
      moon: { type: "boolean" },
      aurora: { type: "number", description: "Aurora intensity 0–1." },
      radius: { type: "number", description: "Sky dome radius (world units)." },
      zenithColor: { type: "string", description: "Hex zenith color." },
      horizonColor: { type: "string", description: "Hex horizon color." },
      skyColor: {
        type: "string",
        description: "Optional Environment.skyColor (solid fallback / fog tint).",
      },
      clearSkyTexture: {
        type: "boolean",
        description: "If true, remove skyTexture so pure procedural sky shows.",
      },
    },
    additionalProperties: false,
  },
};

const setCelestialHandler: ToolHandler = async (input) => {
  const keys = [
    "enabled",
    "timeOfDay",
    "stars",
    "sun",
    "moon",
    "aurora",
    "radius",
    "zenithColor",
    "horizonColor",
    "skyColor",
    "clearSkyTexture",
  ];
  if (!keys.some((k) => input[k] !== undefined)) {
    return {
      ok: false,
      error: "Supply at least one celestial field (timeOfDay, stars, sun, moon, aurora, …).",
    };
  }

  const prev = useEditor.getState().sceneData.environment.celestial ?? {};
  const celestial: NonNullable<Environment["celestial"]> = { ...prev, enabled: true };

  if (typeof input.enabled === "boolean") celestial.enabled = input.enabled;
  if (typeof input.timeOfDay === "number" && Number.isFinite(input.timeOfDay)) {
    celestial.timeOfDay = clamp01(input.timeOfDay);
  }
  if (typeof input.stars === "number" && Number.isFinite(input.stars)) {
    celestial.stars = clamp01(input.stars);
  }
  if (typeof input.sun === "boolean") celestial.sun = input.sun;
  if (typeof input.moon === "boolean") celestial.moon = input.moon;
  if (typeof input.aurora === "number" && Number.isFinite(input.aurora)) {
    celestial.aurora = clamp01(input.aurora);
  }
  if (typeof input.radius === "number" && Number.isFinite(input.radius) && input.radius > 10) {
    celestial.radius = input.radius;
  }
  if (typeof input.zenithColor === "string") celestial.zenithColor = input.zenithColor;
  if (typeof input.horizonColor === "string") celestial.horizonColor = input.horizonColor;

  const patch: Partial<Environment> = { celestial };
  if (typeof input.skyColor === "string") patch.skyColor = input.skyColor;
  if (input.clearSkyTexture === true) patch.skyTexture = undefined;

  useEditor.getState().cmdSetEnvironment(patch, "Set celestial sky");
  return {
    ok: true,
    data: {
      celestial: useEditor.getState().sceneData.environment.celestial,
      skyTexture: useEditor.getState().sceneData.environment.skyTexture ?? null,
    },
  };
};

// ── set_weather ──────────────────────────────────────────────────────
const SET_WEATHER: ToolDef = {
  name: "set_weather",
  description:
    "Set volumetric weather particle FX: clear | rain | snow | dust | storm | fog. " +
    "intensity 0–1, density scales particle count. storm includes lightning flashes. " +
    "Wind from Environment.wind (or override). Use apply_atmosphere_preset for full sky+weather moods.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["clear", "rain", "snow", "dust", "storm", "fog"],
      },
      intensity: { type: "number", description: "0–1 effect strength." },
      density: { type: "number", description: "Particle count scale (1 = default)." },
      wind: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
        description: "Optional weather-local wind [x,y,z]; also updates global wind if set.",
      },
    },
    required: ["type"],
    additionalProperties: false,
  },
};

const setWeatherHandler: ToolHandler = async (input) => {
  const type = input.type as string;
  if (!WEATHER_TYPES.includes(type as WeatherType)) {
    return {
      ok: false,
      error: `type must be one of: ${WEATHER_TYPES.join(", ")}`,
    };
  }
  const prev = useEditor.getState().sceneData.environment.weather ?? {};
  const weather: NonNullable<Environment["weather"]> = {
    ...prev,
    type: type as WeatherType,
  };
  if (typeof input.intensity === "number" && Number.isFinite(input.intensity)) {
    weather.intensity = clamp01(input.intensity);
  } else if (weather.intensity === undefined) {
    weather.intensity = type === "clear" ? 0 : 0.55;
  }
  if (typeof input.density === "number" && Number.isFinite(input.density)) {
    weather.density = Math.max(0.2, Math.min(3, input.density));
  }
  const patch: Partial<Environment> = { weather };
  const wind = asVec3(input.wind);
  if (wind) {
    weather.wind = wind;
    patch.wind = wind;
  }
  useEditor.getState().cmdSetEnvironment(patch, `Weather: ${type}`);
  return {
    ok: true,
    data: { weather: useEditor.getState().sceneData.environment.weather },
  };
};

// ── apply_atmosphere_preset ──────────────────────────────────────────
const APPLY_ATMOSPHERE: ToolDef = {
  name: "apply_atmosphere_preset",
  description:
    "Apply a named sky + weather + lighting mood in one undoable step. " +
    `Presets: ${ATMOSPHERE_PRESETS.map((p) => p.id).join(", ")}. ` +
    "Combines celestial dome, weather particles, sky/fog colors, ambient/sun. " +
    "Does not clear skyTexture unless you also call set_celestial({ clearSkyTexture: true }).",
  input_schema: {
    type: "object",
    properties: {
      preset: {
        type: "string",
        description: `Preset id or name. Known: ${ATMOSPHERE_PRESETS.map((p) => p.id).join(", ")}`,
      },
    },
    required: ["preset"],
    additionalProperties: false,
  },
};

const applyAtmosphereHandler: ToolHandler = async (input) => {
  const name = typeof input.preset === "string" ? input.preset : "";
  if (!name) return { ok: false, error: "preset is required." };
  const found = findAtmospherePreset(name);
  if (!found) {
    return {
      ok: false,
      error: `Unknown atmosphere preset "${name}". Use list_atmosphere_presets.`,
      data: { available: ATMOSPHERE_PRESETS.map((p) => p.id) },
    };
  }
  useEditor
    .getState()
    .cmdSetEnvironment(found.environment, `Atmosphere: ${found.name}`);
  return {
    ok: true,
    data: {
      preset: found.id,
      name: found.name,
      environment: useEditor.getState().sceneData.environment,
    },
  };
};

// ── list_atmosphere_presets ──────────────────────────────────────────
const LIST_ATMOSPHERE: ToolDef = {
  name: "list_atmosphere_presets",
  description:
    "List named atmosphere presets (sky + weather + lighting) for apply_atmosphere_preset.",
  input_schema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const listAtmosphereHandler: ToolHandler = async () => ({
  ok: true,
  data: {
    presets: ATMOSPHERE_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      weather: p.environment.weather?.type ?? "clear",
      timeOfDay: p.environment.celestial?.timeOfDay,
    })),
  },
});

// ── set_sky_texture ──────────────────────────────────────────────────
const SET_SKY_TEXTURE: ToolDef = {
  name: "set_sky_texture",
  description:
    "Set or clear the equirectangular skybox texture URL (https / data: / R2). " +
    "CelestialSky blends it with the procedural gradient. Pass url:null or clear:true to remove. " +
    "Prefer generate_skybox({ prompt, apply:true }) to create + apply in one step.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Texture URL, or omit when clear=true.",
      },
      clear: {
        type: "boolean",
        description: "If true, remove skyTexture.",
      },
    },
    additionalProperties: false,
  },
};

const setSkyTextureHandler: ToolHandler = async (input) => {
  if (input.clear === true || input.url === null || input.url === "") {
    useEditor.getState().cmdSetEnvironment({ skyTexture: undefined }, "Clear sky texture");
    return { ok: true, data: { skyTexture: null, cleared: true } };
  }
  if (typeof input.url !== "string" || !input.url.trim()) {
    return { ok: false, error: "url is required (or clear:true)." };
  }
  const url = input.url.trim();
  const prevCel = useEditor.getState().sceneData.environment.celestial ?? {};
  useEditor.getState().cmdSetEnvironment(
    {
      skyTexture: url,
      celestial: { ...prevCel, enabled: true },
    },
    "Set sky texture",
  );
  return { ok: true, data: { skyTexture: url } };
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

export const defs: ToolDef[] = [
  SET_WIND,
  SET_SOFT_BODY,
  SET_CELESTIAL,
  SET_WEATHER,
  APPLY_ATMOSPHERE,
  LIST_ATMOSPHERE,
  SET_SKY_TEXTURE,
];

export const handlers: Record<string, ToolHandler> = {
  set_wind: setWindHandler,
  set_soft_body: setSoftBodyHandler,
  set_celestial: setCelestialHandler,
  set_weather: setWeatherHandler,
  apply_atmosphere_preset: applyAtmosphereHandler,
  list_atmosphere_presets: listAtmosphereHandler,
  set_sky_texture: setSkyTextureHandler,
};

export const destructiveToolNames: string[] = [
  "set_wind",
  "set_soft_body",
  "set_celestial",
  "set_weather",
  "apply_atmosphere_preset",
  "set_sky_texture",
];
