/**
 * Impressive procedural celestial sky + optional equirectangular skybox.
 *
 * - Shader dome: zenith/horizon gradient driven by time-of-day
 * - Sun / moon discs with limb glow
 * - Twinkling starfield (GPU points)
 * - Optional aurora bands
 * - Optional skyTexture (equirectangular panorama from generate_skybox / R2)
 *
 * Renders as a large inverted sphere that follows the camera so the sky
 * never clips on large arenas (far plane 50k).
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import type { Environment } from "@workspace/scene-schema";

export type CelestialConfig = NonNullable<Environment["celestial"]>;

interface CelestialSkyProps {
  skyColor?: string;
  skyTexture?: string | null;
  celestial?: CelestialConfig | null;
  /** Disable entirely (performance mode). */
  enabled?: boolean;
}

function hexToVec3(hex: string | undefined, fallback: THREE.Color): THREE.Vector3 {
  const c = new THREE.Color(hex && /^#/.test(hex) ? hex : fallback.getStyle());
  return new THREE.Vector3(c.r, c.g, c.b);
}

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform float uTimeOfDay;
  uniform float uSun;
  uniform float uMoon;
  uniform float uAurora;
  uniform float uTime;
  uniform sampler2D uSkyMap;
  uniform float uHasMap;
  uniform vec3 uCamPos;

  // Cheap hash for aurora noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec3 dir = normalize(vWorldPos - uCamPos);
    float elev = dir.y; // -1..1
    float h = clamp(elev * 0.5 + 0.5, 0.0, 1.0);

    // Day factor: 1 at noon, 0 at midnight (smooth)
    float day = 0.5 + 0.5 * cos((uTimeOfDay - 0.5) * 6.2831853);
    day = smoothstep(0.05, 0.55, day);

    // Horizon boost near 0 elevation
    float horizonBand = exp(-abs(elev) * 6.0);

    vec3 zen = mix(uZenith * 0.08, uZenith, day);
    vec3 hor = mix(uHorizon * 0.15, uHorizon, day);
    vec3 col = mix(hor, zen, pow(h, 0.65));

    // Sunset/sunrise warm band
    float dusk = exp(-pow((uTimeOfDay - 0.25) * 8.0, 2.0))
               + exp(-pow((uTimeOfDay - 0.75) * 8.0, 2.0));
    col = mix(col, vec3(1.0, 0.45, 0.15), dusk * horizonBand * 0.55);

    // Ground tint below horizon
    if (elev < 0.0) {
      col = mix(uGround * (0.12 + 0.4 * day), col, exp(elev * 4.0));
    }

    // Sun disc + glow (east-west arc)
    float sunAngle = (uTimeOfDay - 0.25) * 6.2831853;
    vec3 sunDir = normalize(vec3(sin(sunAngle), cos(sunAngle) * 0.85, 0.15));
    float sunDot = max(dot(dir, sunDir), 0.0);
    if (uSun > 0.5 && day > 0.08) {
      float disc = smoothstep(0.9992, 0.9998, sunDot);
      float glow = pow(sunDot, 32.0) * 0.55 * day;
      float halo = pow(sunDot, 8.0) * 0.18 * day;
      col += vec3(1.0, 0.95, 0.75) * (disc * 2.5 + glow + halo);
    }

    // Moon (opposite side of sun)
    if (uMoon > 0.5 && day < 0.55) {
      vec3 moonDir = normalize(-sunDir + vec3(0.05, 0.0, 0.08));
      float moonDot = max(dot(dir, moonDir), 0.0);
      float mDisc = smoothstep(0.9988, 0.9996, moonDot);
      float mGlow = pow(moonDot, 48.0) * 0.35 * (1.0 - day);
      col += vec3(0.75, 0.82, 1.0) * (mDisc * 1.4 + mGlow);
    }

    // Aurora bands (high latitude night)
    if (uAurora > 0.01 && day < 0.4 && elev > 0.05) {
      float a = elev * 4.0 + uTime * 0.15;
      float n = noise(vec2(dir.x * 3.0 + uTime * 0.08, a));
      float band = smoothstep(0.35, 0.75, n) * smoothstep(0.0, 0.35, elev) * (1.0 - day);
      vec3 auroraCol = mix(vec3(0.1, 0.9, 0.45), vec3(0.4, 0.2, 1.0), n);
      col += auroraCol * band * uAurora * 0.65;
    }

    // Soft procedural clouds (day / dusk) — layered fbm wisps
    if (elev > 0.02 && day > 0.12 && uHasMap < 0.5) {
      float cl = 0.0;
      vec2 cp = dir.xz / max(0.08, elev + 0.15);
      cp += uTime * 0.012;
      cl += noise(cp * 1.2) * 0.5;
      cl += noise(cp * 2.4 + 10.0) * 0.3;
      cl += noise(cp * 4.8 + 20.0) * 0.2;
      float cloudMask = smoothstep(0.48, 0.72, cl) * smoothstep(0.02, 0.25, elev) * (1.0 - smoothstep(0.55, 0.95, elev));
      vec3 cloudCol = mix(vec3(0.85, 0.88, 0.95), vec3(1.0, 0.7, 0.5), dusk * 0.6);
      col = mix(col, cloudCol, cloudMask * 0.55 * day);
    }

    // Equirectangular skybox blend
    if (uHasMap > 0.5) {
      // Spherical mapping from direction
      float lon = atan(dir.z, dir.x);
      float lat = asin(clamp(dir.y, -1.0, 1.0));
      vec2 suv = vec2(lon * 0.1591549 + 0.5, lat * 0.3183099 + 0.5);
      vec3 tex = texture2D(uSkyMap, suv).rgb;
      col = mix(col, tex, 0.88);
    }

    // Mild exposure
    col = col / (col + vec3(1.0)) * 1.15;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function SkyDome({
  skyColor,
  skyTexture,
  celestial,
}: {
  skyColor: string;
  skyTexture?: string | null;
  celestial: CelestialConfig;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const [map, setMap] = useState<THREE.Texture | null>(null);

  const radius = celestial.radius ?? 800;
  const timeOfDay = celestial.timeOfDay ?? 0.55;
  const stars = celestial.stars ?? 0.65;
  const showSun = celestial.sun !== false;
  const showMoon = celestial.moon !== false;
  const aurora = celestial.aurora ?? 0;

  const zenith = useMemo(
    () => hexToVec3(celestial.zenithColor, new THREE.Color(skyColor || "#1a2040")),
    [celestial.zenithColor, skyColor],
  );
  const horizon = useMemo(
    () => hexToVec3(celestial.horizonColor, new THREE.Color("#6a7a9a")),
    [celestial.horizonColor],
  );
  const ground = useMemo(() => hexToVec3("#1a1a2e", new THREE.Color("#1a1a2e")), []);

  useEffect(() => {
    if (!skyTexture) {
      setMap(null);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      skyTexture,
      (t) => {
        if (cancelled) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.needsUpdate = true;
        setMap(t);
      },
      undefined,
      () => {
        if (!cancelled) setMap(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [skyTexture]);

  // Dispose GPU texture when map is replaced or unmounted
  useEffect(() => {
    return () => {
      map?.dispose();
    };
  }, [map]);

  const uniforms = useMemo(
    () => ({
      uZenith: { value: zenith.clone() },
      uHorizon: { value: horizon.clone() },
      uGround: { value: ground.clone() },
      uTimeOfDay: { value: timeOfDay },
      uSun: { value: showSun ? 1 : 0 },
      uMoon: { value: showMoon ? 1 : 0 },
      uAurora: { value: aurora },
      uTime: { value: 0 },
      uSkyMap: { value: map ?? new THREE.Texture() },
      uHasMap: { value: map ? 1 : 0 },
      uCamPos: { value: new THREE.Vector3() },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updated in useFrame / effects
    [],
  );

  useEffect(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uZenith.value.copy(zenith);
    matRef.current.uniforms.uHorizon.value.copy(horizon);
    matRef.current.uniforms.uGround.value.copy(ground);
    matRef.current.uniforms.uTimeOfDay.value = timeOfDay;
    matRef.current.uniforms.uSun.value = showSun ? 1 : 0;
    matRef.current.uniforms.uMoon.value = showMoon ? 1 : 0;
    matRef.current.uniforms.uAurora.value = aurora;
  }, [zenith, horizon, ground, timeOfDay, showSun, showMoon, aurora]);

  useEffect(() => {
    if (!matRef.current) return;
    if (map) {
      matRef.current.uniforms.uSkyMap.value = map;
      matRef.current.uniforms.uHasMap.value = 1;
    } else {
      matRef.current.uniforms.uHasMap.value = 0;
    }
  }, [map]);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.position.copy(camera.position);
    }
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
      matRef.current.uniforms.uCamPos.value.copy(camera.position);
    }
  });

  // Star field — more visible at night
  const starGeo = useMemo(() => {
    const count = Math.floor(2500 + stars * 4000);
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Upper hemisphere bias
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(1 - v * 0.92); // mostly sky
      const r = radius * 0.92;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      phases[i] = Math.random() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return g;
  }, [radius, stars]);

  const starMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uNight: { value: 1 },
        uBright: { value: stars },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        varying float vPhase;
        uniform float uTime;
        void main() {
          vPhase = aPhase;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + aPhase);
          gl_PointSize = (2.0 + 2.5 * tw) * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        varying float vPhase;
        uniform float uTime;
        uniform float uNight;
        uniform float uBright;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float tw = 0.55 + 0.45 * sin(uTime * 3.0 + vPhase * 2.0);
          float a = smoothstep(0.5, 0.0, d) * tw * uNight * uBright;
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
        }
      `,
    });
  }, [stars]);

  const starsRef = useRef<THREE.Points>(null);
  useFrame(({ clock }) => {
    if (starMat.uniforms) {
      starMat.uniforms.uTime.value = clock.elapsedTime;
      // Night factor from time of day
      const day = 0.5 + 0.5 * Math.cos((timeOfDay - 0.5) * Math.PI * 2);
      const night = 1 - THREE.MathUtils.smoothstep(day, 0.15, 0.55);
      starMat.uniforms.uNight.value = night;
    }
    if (starsRef.current) {
      starsRef.current.position.copy(camera.position);
    }
  });

  return (
    <group>
      <mesh ref={meshRef} frustumCulled={false} renderOrder={-1000}>
        <sphereGeometry args={[radius, 64, 32]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={SKY_VERT}
          fragmentShader={SKY_FRAG}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
      {stars > 0.02 && (
        <points ref={starsRef} geometry={starGeo} frustumCulled={false} renderOrder={-999}>
          <primitive object={starMat} attach="material" />
        </points>
      )}
    </group>
  );
}

export function CelestialSky({
  skyColor = "#0a0a14",
  skyTexture,
  celestial,
  enabled = true,
}: CelestialSkyProps) {
  if (!enabled) return null;
  // Explicit opt-out only — otherwise show procedural sky (new + legacy scenes).
  if (celestial?.enabled === false && !skyTexture) return null;

  const cfg: CelestialConfig = {
    enabled: true,
    timeOfDay: 0.55,
    stars: 0.7,
    sun: true,
    moon: true,
    aurora: 0,
    radius: 900,
    ...celestial,
  };

  return (
    <SkyDome
      skyColor={skyColor}
      skyTexture={skyTexture}
      celestial={cfg}
    />
  );
}
