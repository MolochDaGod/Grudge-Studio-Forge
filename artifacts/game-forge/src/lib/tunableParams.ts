/**
 * Tunable params registry — the single source of truth for "feel knobs"
 * the AI Worker (and humans, via the Inspector or future Leva panel) can
 * tweak without touching scene-graph editing tools.
 *
 * Each param entry is a typed binding to a slot in the editor store. We
 * deliberately keep this small and curated: every entry here becomes
 * surface area the AI can poke, so we want only the knobs that matter
 * for "make this dusk warmer" / "make jumping feel snappier"-style asks.
 *
 * Adding a new knob is one entry — the AI tool wiring (`list_tunable_params`,
 * `set_tunable_param`) and validation are derived automatically.
 */

import { useEditor } from "@/store/editor";
import type { Environment } from "@/scene/types";
import { DEFAULT_GRAVITY } from "@workspace/scene-schema";

type NumericRange = {
  kind: "number";
  /** Inclusive lower bound used for clamping. */
  min: number;
  /** Inclusive upper bound used for clamping. */
  max: number;
  /** Suggested UI step / quantum. Not enforced for AI writes. */
  step?: number;
};

type ColorParam = { kind: "color" };

type EnumParam<T extends string = string> = {
  kind: "enum";
  options: readonly T[];
};

export type TunableParamSpec = NumericRange | ColorParam | EnumParam;

interface TunableParam {
  /** Stable id used by the AI and persisted UIs. snake_case. */
  id: string;
  /** Short human/AI-readable description, ~one sentence. */
  description: string;
  spec: TunableParamSpec;
  read: () => unknown;
  write: (value: unknown) => void;
}

/** Apply an env patch through the editor store, marking the scene dirty
 *  via the same path the Inspector uses. */
function patchEnv(env: Partial<Environment>): void {
  useEditor.getState().cmdSetEnvironment(env);
}

function readEnv<K extends keyof Environment>(key: K): Environment[K] {
  return useEditor.getState().sceneData.environment[key];
}

function clampNumber(spec: NumericRange, raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Expected a finite number, got ${JSON.stringify(raw)}`);
  }
  return Math.min(spec.max, Math.max(spec.min, n));
}

function validateColor(raw: unknown): string {
  if (typeof raw !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw)) {
    throw new Error(
      `Expected a hex color string like "#d4af37", got ${JSON.stringify(raw)}`,
    );
  }
  return raw.toLowerCase();
}

function validateEnum<T extends string>(spec: EnumParam<T>, raw: unknown): T {
  if (typeof raw !== "string" || !spec.options.includes(raw as T)) {
    throw new Error(
      `Expected one of [${spec.options.join(", ")}], got ${JSON.stringify(raw)}`,
    );
  }
  return raw as T;
}

const PARAMS: TunableParam[] = [
  {
    id: "sun_intensity",
    description:
      "Directional sun light strength (0 = night, 1 = noon, 2 = blown-out).",
    spec: { kind: "number", min: 0, max: 4, step: 0.05 },
    read: () => readEnv("sunIntensity") ?? 1.2,
    write: (v) =>
      patchEnv({
        sunIntensity: clampNumber({ kind: "number", min: 0, max: 4 }, v),
      }),
  },
  {
    id: "ambient_intensity",
    description:
      "Hemisphere/ambient fill light strength (raises the floor on dark sides).",
    spec: { kind: "number", min: 0, max: 2, step: 0.05 },
    read: () => readEnv("ambientIntensity") ?? 0.4,
    write: (v) =>
      patchEnv({
        ambientIntensity: clampNumber({ kind: "number", min: 0, max: 2 }, v),
      }),
  },
  {
    id: "sky_color",
    description:
      "Hex color for the sky / background. Warm tones (#d4af37) read as dusk; cool tones (#0a0a14) as night.",
    spec: { kind: "color" },
    read: () => readEnv("skyColor") ?? "#0a0a14",
    write: (v) => patchEnv({ skyColor: validateColor(v) }),
  },
  {
    id: "ground_color",
    description: "Hex color for the ground hemisphere fill / floor tint.",
    spec: { kind: "color" },
    read: () => readEnv("groundColor") ?? "#1a1a2e",
    write: (v) => patchEnv({ groundColor: validateColor(v) }),
  },
  {
    id: "gravity_y",
    description:
      "World gravity along Y in m/s² (negative = down). Earth = -9.81; moon-feel = -1.6; floaty = -3.",
    spec: { kind: "number", min: -30, max: 30, step: 0.1 },
    read: () => (readEnv("gravity") ?? DEFAULT_GRAVITY)[1],
    write: (v) => {
      const g = clampNumber({ kind: "number", min: -30, max: 30 }, v);
      const cur = readEnv("gravity") ?? DEFAULT_GRAVITY;
      patchEnv({ gravity: [cur[0], g, cur[2]] as [number, number, number] });
    },
  },
  {
    id: "player_move_speed",
    description: "Player WASD movement speed in m/s.",
    spec: { kind: "number", min: 0.5, max: 30, step: 0.1 },
    read: () => readEnv("playerMoveSpeed") ?? 6,
    write: (v) =>
      patchEnv({
        playerMoveSpeed: clampNumber(
          { kind: "number", min: 0.5, max: 30 },
          v,
        ),
      }),
  },
  {
    id: "mouse_sensitivity",
    description:
      "Mouselook sensitivity in radians per pixel (lower = calmer aim, higher = twitchy).",
    spec: { kind: "number", min: 0.0005, max: 0.02, step: 0.0005 },
    read: () => readEnv("mouseSensitivity") ?? 0.0025,
    write: (v) =>
      patchEnv({
        mouseSensitivity: clampNumber(
          { kind: "number", min: 0.0005, max: 0.02 },
          v,
        ),
      }),
  },
  {
    id: "camera_mode",
    description:
      "Active play-mode camera controller. 'editor' = orbit only; 'rts' = top-down strategy; 'thirdPerson' = follow-cam; 'firstPerson' = mouselook.",
    spec: {
      kind: "enum",
      options: ["editor", "rts", "thirdPerson", "firstPerson"] as const,
    },
    read: () => readEnv("cameraMode") ?? "editor",
    write: (v) => {
      const mode = validateEnum(
        {
          kind: "enum",
          options: ["editor", "rts", "thirdPerson", "firstPerson"] as const,
        },
        v,
      );
      patchEnv({ cameraMode: mode });
    },
  },
];

const PARAM_INDEX: Record<string, TunableParam> = Object.fromEntries(
  PARAMS.map((p) => [p.id, p]),
);

/** Public summary used by the AI's `list_tunable_params` tool — returns
 *  enough metadata for the model to pick a sensible value without any
 *  follow-up reads. */
export function listTunableParams(): Array<{
  id: string;
  description: string;
  spec: TunableParamSpec;
  current: unknown;
}> {
  return PARAMS.map((p) => ({
    id: p.id,
    description: p.description,
    spec: p.spec,
    current: p.read(),
  }));
}

/** Apply a write through the registry. Throws on unknown id or invalid
 *  shape so the AI tool wrapper can surface the error. */
export function setTunableParam(id: string, value: unknown): {
  id: string;
  previous: unknown;
  current: unknown;
} {
  const param = PARAM_INDEX[id];
  if (!param) {
    throw new Error(
      `Unknown tunable param "${id}". Call list_tunable_params for the catalog.`,
    );
  }
  const previous = param.read();
  param.write(value);
  return { id, previous, current: param.read() };
}

/** Convenience for in-app readers (e.g. a future Leva panel). */
export function getTunableParam(id: string): unknown {
  const p = PARAM_INDEX[id];
  if (!p) throw new Error(`Unknown tunable param "${id}"`);
  return p.read();
}
