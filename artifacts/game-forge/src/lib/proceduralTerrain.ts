/**
 * Procedural heightmap terrain — deterministic value-noise displacement
 * with vertex-colored biome bands. Used by the `terrain` entity type
 * (see EntityRenderer's TerrainMesh component) to give RTS-style maps
 * a real 3D landscape without depending on an external GLB.
 *
 * The same `(size, segments, heightSeed)` triple always produces the
 * exact same geometry, so saved scenes are reproducible across machines
 * and the deterministic template entity-id chain (used by the API
 * server's seed loop) stays stable.
 */
import * as THREE from "three";

export interface TerrainOptions {
  size: number;
  segments: number;
  heightAmp: number;
  heightSeed: number;
  noiseScale?: number;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// Integer hash → [-1, 1]. Splittable-ish constants from the standard
// xorshift / mulberry32 mixers. Cheap and stable across runs.
function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed | 0) >>> 0;
  h = Math.imul(h ^ (ix | 0), 0x85ebca6b);
  h = Math.imul(h ^ (iy | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const v00 = hash2(ix, iy, seed);
  const v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const a = v00 * (1 - sx) + v10 * sx;
  const b = v01 * (1 - sx) + v11 * sx;
  return a * (1 - sy) + b * sy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // ≈ [-1, 1]
}

const SAND = new THREE.Color("#c9b27f");
const GRASS = new THREE.Color("#4f7a3a");
const ROCK = new THREE.Color("#6e6357");
const SNOW = new THREE.Color("#e8eef2");

/**
 * Build a centred XZ-plane heightfield. Y axis is up; the geometry's
 * pivot is at world origin so an entity transform of `[0,0,0]` lands
 * the terrain centre at the world origin and the rim falls off below 0.
 */
export function buildTerrainGeometry(opts: TerrainOptions): THREE.BufferGeometry {
  const { size, segments, heightAmp, heightSeed } = opts;
  const noiseScale = opts.noiseScale ?? 0.012;
  const geom = new THREE.PlaneGeometry(size, size, segments, segments);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Edge falloff so the rim sinks below 0 — frames the playfield and
    // gives the camera a clean horizon line in SC1-style fixed-angle
    // overhead cameras.
    const dx = x / (size * 0.5);
    const dz = z / (size * 0.5);
    const r = Math.min(1, Math.hypot(dx, dz));
    const falloff = 1 - smoothstep((r - 0.7) / 0.3);
    const n = fbm(x * noiseScale, z * noiseScale, heightSeed);
    // Map noise [-1..1] → [-0.05..1] · heightAmp · falloff.
    const h = (n * 0.6 + 0.4) * heightAmp * falloff - heightAmp * 0.05;
    pos.setY(i, h);

    // Vertex color by elevation, smooth-blended so biome bands don't
    // show as hard contour lines.
    if (h < heightAmp * 0.05) {
      tmp.copy(SAND);
    } else if (h < heightAmp * 0.45) {
      const t = (h - heightAmp * 0.05) / (heightAmp * 0.4);
      tmp.copy(SAND).lerp(GRASS, smoothstep(t));
    } else if (h < heightAmp * 0.75) {
      const t = (h - heightAmp * 0.45) / (heightAmp * 0.3);
      tmp.copy(GRASS).lerp(ROCK, smoothstep(t));
    } else {
      const t = (h - heightAmp * 0.75) / (heightAmp * 0.25);
      tmp.copy(ROCK).lerp(SNOW, smoothstep(t));
    }
    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  pos.needsUpdate = true;
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
