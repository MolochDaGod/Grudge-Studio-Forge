/**
 * GPU weather particle systems — rain, snow, dust, storm sheets, fog wisps.
 *
 * Follows the camera so weather feels infinite on large maps. Intensity
 * and wind come from Environment.weather (+ Environment.wind fallback).
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Environment, Vec3 } from "@workspace/scene-schema";

export type WeatherConfig = NonNullable<Environment["weather"]>;

interface WeatherFxProps {
  weather?: WeatherConfig | null;
  wind?: Vec3 | null;
  enabled?: boolean;
}

function makeParticleGeo(
  count: number,
  spread: [number, number, number],
  yMin: number,
  yMax: number,
): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread[0];
    positions[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread[2];
    seeds[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  return g;
}

const WEATHER_VERT = /* glsl */ `
  precision highp float;
  attribute float aSeed;
  varying float vAlpha;
  varying float vSeed;
  uniform float uTime;
  uniform vec3 uWind;
  uniform float uSpeed;
  uniform float uSize;
  uniform float uSpreadY;
  uniform float uStreak; // 1 = rain/storm elongated points
  void main() {
    vec3 p = position;
    float t = uTime * uSpeed + aSeed;
    // Fall / drift
    p.y = mod(p.y - t * 12.0, uSpreadY) - uSpreadY * 0.5;
    p.x += uWind.x * t * 0.35 + sin(t * 0.7 + aSeed) * 0.4;
    p.z += uWind.z * t * 0.35 + cos(t * 0.5 + aSeed) * 0.3;
    // Wind slant for precipitation
    p.x += (uSpreadY * 0.5 - p.y) * uWind.x * 0.02;
    p.z += (uSpreadY * 0.5 - p.y) * uWind.z * 0.02;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float streakBoost = mix(1.0, 2.4, uStreak);
    gl_PointSize = uSize * streakBoost * (180.0 / max(1.0, -mv.z));
    vAlpha = 0.55 + 0.45 * fract(sin(aSeed * 91.7) * 43758.5);
    vSeed = aSeed;
    gl_Position = projectionMatrix * mv;
  }
`;

const WEATHER_FRAG = /* glsl */ `
  // Match vertex highp — shared uniforms/varyings must not mix mediump/highp
  // (THREE.WebGLProgram VALIDATE_STATUS / precision mismatch).
  precision highp float;
  varying float vAlpha;
  varying float vSeed;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uSoft;
  uniform float uStreak;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float a;
    if (uStreak > 0.5) {
      // Vertical rain streak (taller than wide)
      float sx = abs(uv.x) * 2.2;
      float sy = abs(uv.y);
      if (sx > 0.5 || sy > 0.5) discard;
      a = (1.0 - sx * 2.0) * (1.0 - sy * 1.2) * vAlpha * uIntensity;
      a *= 0.75 + 0.25 * fract(sin(vSeed * 12.3) * 43758.5);
    } else {
      float d = length(uv);
      if (d > 0.5) discard;
      a = smoothstep(0.5, uSoft, d) * vAlpha * uIntensity;
    }
    gl_FragColor = vec4(uColor, a);
  }
`;

function WeatherParticles({
  type,
  intensity,
  wind,
  density,
}: {
  type: NonNullable<WeatherConfig["type"]>;
  intensity: number;
  wind: THREE.Vector3;
  density: number;
}) {
  const { camera } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const preset = useMemo(() => {
    switch (type) {
      case "rain":
        return {
          count: Math.floor(4000 * density),
          color: new THREE.Color("#a8c8e8"),
          speed: 2.2 + intensity * 2.5,
          size: 1.8,
          soft: 0.15,
          spread: [90, 60, 90] as [number, number, number],
        };
      case "snow":
        return {
          count: Math.floor(2800 * density),
          color: new THREE.Color("#f0f4ff"),
          speed: 0.35 + intensity * 0.4,
          size: 3.2,
          soft: 0.05,
          spread: [100, 50, 100] as [number, number, number],
        };
      case "dust":
        return {
          count: Math.floor(1800 * density),
          color: new THREE.Color("#c4a574"),
          speed: 0.25 + intensity * 0.5,
          size: 4.5,
          soft: 0.0,
          spread: [120, 40, 120] as [number, number, number],
        };
      case "storm":
        return {
          count: Math.floor(5500 * density),
          color: new THREE.Color("#7a8aa0"),
          speed: 3.5 + intensity * 3,
          size: 2.2,
          soft: 0.12,
          spread: [110, 70, 110] as [number, number, number],
        };
      case "fog":
        return {
          count: Math.floor(900 * density),
          color: new THREE.Color("#c8d0d8"),
          speed: 0.12,
          size: 28,
          soft: -0.2,
          spread: [80, 25, 80] as [number, number, number],
        };
      default:
        return null;
    }
  }, [type, intensity, density]);

  const geo = useMemo(() => {
    if (!preset) return null;
    return makeParticleGeo(preset.count, preset.spread, -preset.spread[1] / 2, preset.spread[1] / 2);
  }, [preset]);

  const isStreak = type === "rain" || type === "storm";

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWind: { value: wind.clone() },
      uSpeed: { value: preset?.speed ?? 1 },
      uSize: { value: preset?.size ?? 2 },
      uSpreadY: { value: preset?.spread[1] ?? 50 },
      uColor: { value: preset?.color ?? new THREE.Color("#fff") },
      uIntensity: { value: intensity },
      uSoft: { value: preset?.soft ?? 0.1 },
      uStreak: { value: isStreak ? 1 : 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type],
  );

  useFrame(({ clock }) => {
    if (pointsRef.current) {
      pointsRef.current.position.set(
        camera.position.x,
        camera.position.y + 8,
        camera.position.z,
      );
    }
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
      matRef.current.uniforms.uWind.value.copy(wind);
      matRef.current.uniforms.uIntensity.value = intensity;
      matRef.current.uniforms.uStreak.value = isStreak ? 1 : 0;
      if (preset) {
        matRef.current.uniforms.uSpeed.value = preset.speed;
        matRef.current.uniforms.uSize.value = preset.size;
        matRef.current.uniforms.uColor.value.copy(preset.color);
      }
    }
  });

  if (!preset || !geo || type === "clear") return null;

  return (
    <points ref={pointsRef} geometry={geo} frustumCulled={false} renderOrder={50}>
      <shaderMaterial
        ref={matRef}
        vertexShader={WEATHER_VERT}
        fragmentShader={WEATHER_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={type === "fog" || type === "dust" ? THREE.NormalBlending : THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Storm lightning flashes — brief full-scene pulses that follow the camera. */
function StormLightning({ intensity }: { intensity: number }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const fillRef = useRef<THREE.AmbientLight>(null);
  const nextFlash = useRef(2 + Math.random() * 4);
  const { camera } = useThree();

  useFrame((_state, dt) => {
    nextFlash.current -= dt;
    if (nextFlash.current <= 0) {
      const flash = 40 + intensity * 80;
      if (lightRef.current) {
        lightRef.current.position.set(
          camera.position.x + (Math.random() - 0.5) * 50,
          camera.position.y + 55 + Math.random() * 25,
          camera.position.z + (Math.random() - 0.5) * 50,
        );
        lightRef.current.intensity = flash;
      }
      if (fillRef.current) fillRef.current.intensity = 0.35 + intensity * 0.5;
      nextFlash.current = 2.5 + Math.random() * 6 * (1.2 - intensity);
    } else {
      if (lightRef.current) lightRef.current.intensity *= 0.78;
      if (fillRef.current) fillRef.current.intensity *= 0.75;
    }
  });

  return (
    <>
      <pointLight
        ref={lightRef}
        color="#cde6ff"
        intensity={0}
        distance={400}
        decay={2}
        position={[0, 80, 0]}
      />
      <ambientLight ref={fillRef} color="#a8c8ff" intensity={0} />
    </>
  );
}

export function WeatherFx({ weather, wind, enabled = true }: WeatherFxProps) {
  if (!enabled || !weather || !weather.type || weather.type === "clear") return null;

  const intensity = THREE.MathUtils.clamp(weather.intensity ?? 0.55, 0, 1);
  const density = Math.max(0.2, weather.density ?? 1);
  const w = weather.wind ?? wind ?? ([1.5, 0, 0] as Vec3);
  const windVec = new THREE.Vector3(w[0], w[1], w[2]);

  return (
    <group>
      <WeatherParticles
        type={weather.type}
        intensity={intensity}
        wind={windVec}
        density={density}
      />
      {weather.type === "storm" && <StormLightning intensity={intensity} />}
    </group>
  );
}
