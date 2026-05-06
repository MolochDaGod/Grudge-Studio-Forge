/**
 * Lighting presets for `apply_lighting_preset`. Each preset is a pure
 * description: an environment patch (ambient/sun/sky/fog) plus a list of
 * additional light entities to spawn. The tool layer applies the patch
 * via `setEnvironment` and pushes the lights via `addEntityRaw`.
 *
 * Preset-spawned lights are tagged with the AUTO_LIGHTING_TAG name prefix
 * so a second `apply_lighting_preset` call can clear and replace its own
 * earlier output without touching user-authored lights.
 */

/** Name prefix used to identify lights spawned by `apply_lighting_preset`.
 *  Re-applying a preset removes prior `auto:lighting` entities cleanly. */
export const AUTO_LIGHTING_TAG = "auto:lighting";

export interface PresetLight {
  /** Suffix appended after AUTO_LIGHTING_TAG. */
  label: string;
  kind: "point" | "directional" | "spot";
  color: string;
  intensity: number;
  position: [number, number, number];
  distance?: number;
}

export interface LightingPreset {
  id: string;
  name: string;
  description: string;
  environment: {
    skyColor?: string;
    groundColor?: string;
    ambientIntensity?: number;
    sunIntensity?: number;
    fog?: { color?: string; near?: number; far?: number };
  };
  lights: readonly PresetLight[];
}

// Note: each preset's `fog` literal is intentionally distinct from
// `DEFAULT_FOG` (in `@workspace/scene-schema`) — the whole point of a
// lighting preset is to override the default with a hand-tuned mood
// (tight neon-night fog, warm golden-hour haze, overcast wash, etc.).
// Do not collapse these to `DEFAULT_FOG`; the constant is the editor
// baseline, not a preset value.
export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  {
    id: "studio-3pt",
    name: "Studio 3-Point",
    description: "Classic 3-point rig: warm key, cool fill, rim accent. Great for hero shots.",
    environment: {
      skyColor: "#1a1a22",
      groundColor: "#15151c",
      ambientIntensity: 0.25,
      sunIntensity: 0.0,
      fog: { color: "#1a1a22", near: 60, far: 260 },
    },
    lights: [
      { label: "Key", kind: "spot", color: "#fff0d8", intensity: 22, position: [6, 8, 6], distance: 40 },
      { label: "Fill", kind: "spot", color: "#a8c0ff", intensity: 9, position: [-6, 6, 4], distance: 40 },
      { label: "Rim", kind: "spot", color: "#ffd070", intensity: 14, position: [0, 6, -8], distance: 40 },
    ],
  },
  {
    id: "golden-hour",
    name: "Golden Hour",
    description: "Low warm sun, dusky sky, single warm key — late afternoon.",
    environment: {
      skyColor: "#3a2a30",
      groundColor: "#3b1c1a",
      ambientIntensity: 0.35,
      sunIntensity: 0.85,
      fog: { color: "#a06040", near: 40, far: 220 },
    },
    lights: [
      { label: "Sun Key", kind: "spot", color: "#ff8a3d", intensity: 12, position: [10, 5, 3], distance: 60 },
    ],
  },
  {
    id: "night-neon",
    name: "Neon Night",
    description: "Pitch-dark base with cyan + magenta accents — synthwave look, hazy.",
    environment: {
      skyColor: "#06061a",
      groundColor: "#0a0a18",
      ambientIntensity: 0.18,
      sunIntensity: 0.0,
      fog: { color: "#1a0a2a", near: 20, far: 120 },
    },
    lights: [
      { label: "Cyan", kind: "point", color: "#2af0ff", intensity: 22, position: [6, 4, 0], distance: 25 },
      { label: "Magenta", kind: "point", color: "#ff2a8a", intensity: 22, position: [-6, 4, 0], distance: 25 },
      { label: "Top Spot", kind: "spot", color: "#ffffff", intensity: 6, position: [0, 9, 0], distance: 30 },
    ],
  },
  {
    id: "overcast",
    name: "Overcast Soft",
    description: "Flat soft daylight — high ambient, weak directional, neutral grey sky.",
    environment: {
      skyColor: "#9aa0a8",
      groundColor: "#5a5e66",
      ambientIntensity: 0.85,
      sunIntensity: 0.4,
      fog: { color: "#9aa0a8", near: 80, far: 300 },
    },
    lights: [],
  },
  {
    id: "interior-warm",
    name: "Interior Warm",
    description: "Indoor warm tungsten — moderate ambient, no sun, two warm point lights.",
    environment: {
      skyColor: "#1a1108",
      groundColor: "#241a10",
      ambientIntensity: 0.4,
      sunIntensity: 0.0,
      fog: { color: "#2a1a08", near: 30, far: 180 },
    },
    lights: [
      { label: "Lamp L", kind: "point", color: "#ffb060", intensity: 14, position: [5, 3, 4], distance: 18 },
      { label: "Lamp R", kind: "point", color: "#ffb060", intensity: 14, position: [-5, 3, -4], distance: 18 },
      { label: "Ceiling", kind: "spot", color: "#ffe6c0", intensity: 8, position: [0, 7, 0], distance: 22 },
    ],
  },
] as const;

export function getLightingPreset(id: string): LightingPreset | undefined {
  return LIGHTING_PRESETS.find((p) => p.id === id);
}
