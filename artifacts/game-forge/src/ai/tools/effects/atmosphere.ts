/**
 * Atmosphere presets + helpers for celestial sky / weather FX.
 * Pure data — tools merge into Environment via cmdSetEnvironment.
 */
import type { Environment, Vec3 } from "@workspace/scene-schema";

export type WeatherType = NonNullable<NonNullable<Environment["weather"]>["type"]>;

export interface AtmospherePreset {
  id: string;
  name: string;
  description: string;
  environment: Partial<Environment>;
}

/** Named moods the AI can apply in one shot. */
export const ATMOSPHERE_PRESETS: readonly AtmospherePreset[] = [
  {
    id: "clear-noon",
    name: "Clear Noon",
    description: "Bright midday sky, no weather, strong sun.",
    environment: {
      skyColor: "#4a7ab8",
      groundColor: "#3a4a3a",
      ambientIntensity: 0.55,
      sunIntensity: 1.6,
      fog: { color: "#a8c0d8", near: 100, far: 420 },
      celestial: {
        enabled: true,
        timeOfDay: 0.5,
        stars: 0.15,
        sun: true,
        moon: false,
        aurora: 0,
        zenithColor: "#3a6aaa",
        horizonColor: "#b0c8e0",
      },
      weather: { type: "clear", intensity: 0, density: 1 },
    },
  },
  {
    id: "golden-sunset",
    name: "Golden Sunset",
    description: "Warm horizon, low sun, mild haze.",
    environment: {
      skyColor: "#3a2a30",
      groundColor: "#2a1a18",
      ambientIntensity: 0.4,
      sunIntensity: 1.1,
      fog: { color: "#a06040", near: 50, far: 280 },
      celestial: {
        enabled: true,
        timeOfDay: 0.75,
        stars: 0.35,
        sun: true,
        moon: true,
        aurora: 0,
        zenithColor: "#1a2040",
        horizonColor: "#e87840",
      },
      weather: { type: "clear", intensity: 0, density: 1 },
      wind: [2, 0, 0.5] as Vec3,
    },
  },
  {
    id: "midnight-stars",
    name: "Midnight Stars",
    description: "Deep night sky, dense stars, moon, cool ambient.",
    environment: {
      skyColor: "#050510",
      groundColor: "#0a0a14",
      ambientIntensity: 0.22,
      sunIntensity: 0.15,
      fog: { color: "#0a0a18", near: 40, far: 200 },
      celestial: {
        enabled: true,
        timeOfDay: 0.0,
        stars: 1,
        sun: false,
        moon: true,
        aurora: 0.15,
        zenithColor: "#05051a",
        horizonColor: "#1a1a40",
      },
      weather: { type: "clear", intensity: 0, density: 1 },
    },
  },
  {
    id: "aurora-night",
    name: "Aurora Night",
    description: "Polar night with strong aurora ribbons and stars.",
    environment: {
      skyColor: "#040818",
      groundColor: "#0a1018",
      ambientIntensity: 0.28,
      sunIntensity: 0.1,
      fog: { color: "#081420", near: 30, far: 180 },
      celestial: {
        enabled: true,
        timeOfDay: 0.05,
        stars: 0.95,
        sun: false,
        moon: true,
        aurora: 0.9,
        zenithColor: "#061020",
        horizonColor: "#102030",
      },
      weather: { type: "clear", intensity: 0, density: 1 },
    },
  },
  {
    id: "soft-rain",
    name: "Soft Rain",
    description: "Overcast grey sky with gentle rain particles.",
    environment: {
      skyColor: "#3a4250",
      groundColor: "#2a3038",
      ambientIntensity: 0.45,
      sunIntensity: 0.35,
      fog: { color: "#5a6878", near: 25, far: 160 },
      celestial: {
        enabled: true,
        timeOfDay: 0.45,
        stars: 0,
        sun: false,
        moon: false,
        aurora: 0,
        zenithColor: "#4a5568",
        horizonColor: "#6a7888",
      },
      weather: { type: "rain", intensity: 0.45, density: 0.9 },
      wind: [1.2, 0, 0.4] as Vec3,
    },
  },
  {
    id: "thunderstorm",
    name: "Thunderstorm",
    description: "Heavy storm rain, dark sky, lightning flashes, strong wind.",
    environment: {
      skyColor: "#121820",
      groundColor: "#1a1e24",
      ambientIntensity: 0.3,
      sunIntensity: 0.2,
      fog: { color: "#2a3038", near: 15, far: 120 },
      celestial: {
        enabled: true,
        timeOfDay: 0.4,
        stars: 0,
        sun: false,
        moon: false,
        aurora: 0,
        zenithColor: "#1a2230",
        horizonColor: "#2a3440",
      },
      weather: { type: "storm", intensity: 0.9, density: 1.2 },
      wind: [8, 0, 3] as Vec3,
    },
  },
  {
    id: "snowfall",
    name: "Snowfall",
    description: "Cold winter sky with soft snowflakes.",
    environment: {
      skyColor: "#6a7a90",
      groundColor: "#c8d0d8",
      ambientIntensity: 0.55,
      sunIntensity: 0.5,
      fog: { color: "#b0bcc8", near: 20, far: 140 },
      celestial: {
        enabled: true,
        timeOfDay: 0.42,
        stars: 0,
        sun: true,
        moon: false,
        aurora: 0,
        zenithColor: "#7090b0",
        horizonColor: "#c0d0e0",
      },
      weather: { type: "snow", intensity: 0.65, density: 1 },
      wind: [0.8, 0, 0.3] as Vec3,
    },
  },
  {
    id: "desert-dust",
    name: "Desert Dust",
    description: "Hot amber sky with blowing dust particles.",
    environment: {
      skyColor: "#c09050",
      groundColor: "#8a6030",
      ambientIntensity: 0.5,
      sunIntensity: 1.4,
      fog: { color: "#c8a060", near: 30, far: 200 },
      celestial: {
        enabled: true,
        timeOfDay: 0.55,
        stars: 0.05,
        sun: true,
        moon: false,
        aurora: 0,
        zenithColor: "#5080b0",
        horizonColor: "#e0b070",
      },
      weather: { type: "dust", intensity: 0.55, density: 1 },
      wind: [4, 0.2, 1] as Vec3,
    },
  },
  {
    id: "thick-fog",
    name: "Thick Fog",
    description: "Dense fog bank, muted sky, low visibility.",
    environment: {
      skyColor: "#6a7078",
      groundColor: "#4a5058",
      ambientIntensity: 0.5,
      sunIntensity: 0.25,
      fog: { color: "#8a9098", near: 4, far: 45 },
      celestial: {
        enabled: true,
        timeOfDay: 0.48,
        stars: 0,
        sun: false,
        moon: false,
        aurora: 0,
        zenithColor: "#707880",
        horizonColor: "#9098a0",
      },
      weather: { type: "fog", intensity: 0.8, density: 1.3 },
      wind: [0.4, 0, 0.2] as Vec3,
    },
  },
  {
    id: "blood-moon",
    name: "Blood Moon",
    description: "Ominous night with reddish horizon and high star density.",
    environment: {
      skyColor: "#100808",
      groundColor: "#1a0a0a",
      ambientIntensity: 0.25,
      sunIntensity: 0.12,
      fog: { color: "#2a1010", near: 25, far: 160 },
      celestial: {
        enabled: true,
        timeOfDay: 0.02,
        stars: 0.85,
        sun: false,
        moon: true,
        aurora: 0.2,
        zenithColor: "#100510",
        horizonColor: "#602020",
      },
      weather: { type: "clear", intensity: 0, density: 1 },
    },
  },
];

export function findAtmospherePreset(idOrName: string): AtmospherePreset | undefined {
  const q = idOrName.trim().toLowerCase();
  return ATMOSPHERE_PRESETS.find(
    (p) => p.id === q || p.name.toLowerCase() === q || p.id.replace(/-/g, " ") === q,
  );
}

export const WEATHER_TYPES: readonly WeatherType[] = [
  "clear",
  "rain",
  "snow",
  "dust",
  "storm",
  "fog",
];
