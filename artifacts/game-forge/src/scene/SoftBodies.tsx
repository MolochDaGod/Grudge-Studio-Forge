import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import {
  resolveMaterialDefaults,
  type MaterialComponent,
} from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";
import type { SceneEntity } from "./types";
import {
  buildGrid,
  gatherSoftColliders,
  makeParticlePool,
  projectOutOfColliders,
  readWindVec,
  resolveEmitter,
  snapshotColliders,
  stepVerlet,
  tickEmitter,
  tickParticles,
  type EmitState,
  type RapierLikeWorld,
  type SoftCollider,
} from "./softBodySim";

/** Probe the Rapier context and publish the live world into a ref.
 *
 *  IMPORTANT: This component must only be mounted inside a `<Physics>`
 *  provider. `useRapier()` throws when no provider is present, which
 *  happens in **edit mode** (the editor's `SceneEditMode` does not
 *  wrap the scene in `<Physics>` — only `ScenePlayMode` does). The
 *  parent components conditionally mount this probe based on
 *  `isPlaying` so the editor never tries to read Rapier when there's
 *  no physics world. */
function RapierWorldProbe({
  worldRef,
}: {
  worldRef: MutableRefObject<RapierLikeWorld | null>;
}) {
  const { world } = useRapier();
  worldRef.current = world as unknown as RapierLikeWorld;
  useEffect(() => {
    return () => {
      worldRef.current = null;
    };
  }, [worldRef]);
  return null;
}


const SELECTION_COLOR = "#d4af37";

function pickColor(mat: MaterialComponent | undefined, fallback: string) {
  return mat?.color ?? fallback;
}

function buildGridGeometry(cols: number, rows: number, positions: Float32Array): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setIndex(idx);
  const uv = new Float32Array(cols * rows * 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      uv[k * 2] = i / (cols - 1);
      uv[k * 2 + 1] = 1 - j / (rows - 1);
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

interface VerletEntityProps {
  entity: SceneEntity;
  selected?: boolean;
  onPick?: () => void;
  effectiveMaterial?: MaterialComponent;
}

/** Walk the cloth/flag verlet vertices through scene colliders and
 *  push penetrating ones outside. The verlet positions are LOCAL to
 *  the entity group, so we transform → resolve → transform back via
 *  the supplied group's worldMatrix. We update `previous` to match
 *  the resolved position so the implicit velocity along the contact
 *  normal is killed (no jitter). */
function applyClothCollision(
  positions: Float32Array,
  previous: Float32Array,
  pinned: Uint8Array,
  group: THREE.Group | null,
  colliders: ReturnType<typeof snapshotColliders>,
) {
  if (!group || colliders.length === 0) return;
  group.updateWorldMatrix(true, false);
  const m = group.matrixWorld;
  const inv = new THREE.Matrix4().copy(m).invert();
  const tmp = new THREE.Vector3();
  const scratch = { x: 0, y: 0, z: 0 };
  const n = pinned.length;
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    const ix = i * 3;
    tmp.set(positions[ix], positions[ix + 1], positions[ix + 2]).applyMatrix4(m);
    scratch.x = tmp.x;
    scratch.y = tmp.y;
    scratch.z = tmp.z;
    if (projectOutOfColliders(scratch, colliders)) {
      tmp.set(scratch.x, scratch.y, scratch.z).applyMatrix4(inv);
      positions[ix] = tmp.x;
      positions[ix + 1] = tmp.y;
      positions[ix + 2] = tmp.z;
      // Kill velocity along the contact axis by snapping `previous`
      // onto the resolved position. Cheaper than computing per-axis
      // normals and good enough for prototype-quality cloth.
      previous[ix] = tmp.x;
      previous[ix + 1] = tmp.y;
      previous[ix + 2] = tmp.z;
    }
  }
}

/** Flag — a vertical panel pinned along its left edge (pole side)
 *  and rippled by the global wind. */
export function FlagEntity({ entity, selected, onPick, effectiveMaterial }: VerletEntityProps) {
  const env = useEditor((s) => s.sceneData.environment);
  const allEntities = useEditor((s) => s.sceneData.entities);
  const isPlaying = useEditor((s) => s.isPlaying);
  const worldRef = useRef<RapierLikeWorld | null>(null);
  const sb = entity.softBody ?? {};
  const cols = Math.max(3, Math.min(24, sb.segmentsX ?? 12));
  const rows = Math.max(2, Math.min(20, sb.segmentsY ?? 8));
  const width = 1;
  const height = 0.6;
  const grid = useMemo(
    () => buildGrid(cols, rows, width, height, (i) => i === 0),
    [cols, rows],
  );
  const geo = useMemo(
    () => buildGridGeometry(cols, rows, grid.positions),
    [cols, rows, grid.positions],
  );
  useEffect(() => {
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }, [geo]);
  const matResolved = useMemo(
    () => resolveMaterialDefaults(effectiveMaterial ?? entity.material),
    [effectiveMaterial, entity.material],
  );
  const damping = sb.damping ?? matResolved.drag;
  const tRef = useRef(0);
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    tRef.current += dt;
    const wind = readWindVec(env);
    const turbulence = 0.6 * Math.sin(tRef.current * 4);
    stepVerlet(
      grid,
      dt,
      damping,
      wind[0] + turbulence,
      wind[1] - 1.5,
      wind[2] + 0.4 * Math.sin(tRef.current * 3.1),
      3,
    );
    // Collision pass — keep the rippling panel from sweeping through
    // the pole / nearby props.
    applyClothCollision(
      grid.positions,
      grid.previous,
      grid.pinned,
      groupRef.current,
      gatherSoftColliders(worldRef.current, allEntities, entity.id),
    );
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    geo.computeVertexNormals();
  });
  const color = pickColor(effectiveMaterial ?? entity.material, "#cc3333");
  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
    >
      {isPlaying && <RapierWorldProbe worldRef={worldRef} />}
      <mesh position={[-width / 2 - 0.02, 0, 0]}>
        <cylinderGeometry args={[0.025, 0.025, height + 0.4, 12]} />
        <meshStandardMaterial color="#b08d2e" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial
          color={color}
          side={THREE.DoubleSide}
          metalness={0.05}
          roughness={0.85}
        />
      </mesh>
      {selected && (
        <mesh geometry={geo} renderOrder={999}>
          <meshBasicMaterial
            color={SELECTION_COLOR}
            wireframe
            transparent
            opacity={0.85}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

/** Cloth — a draped panel pinned at one of three configurable patterns
 *  (top corners / top edge / none). Drapes over scene colliders. */
export function ClothEntity({ entity, selected, onPick, effectiveMaterial }: VerletEntityProps) {
  const env = useEditor((s) => s.sceneData.environment);
  const allEntities = useEditor((s) => s.sceneData.entities);
  const isPlaying = useEditor((s) => s.isPlaying);
  const worldRef = useRef<RapierLikeWorld | null>(null);
  const sb = entity.softBody ?? {};
  const cols = Math.max(3, Math.min(24, sb.segmentsX ?? 10));
  const rows = Math.max(3, Math.min(24, sb.segmentsY ?? 10));
  const width = 1;
  const height = 1;
  const pin = sb.pin ?? "topCorners";
  const grid = useMemo(
    () =>
      buildGrid(cols, rows, width, height, (i, j) => {
        if (pin === "none") return false;
        if (pin === "topEdge") return j === 0;
        return j === 0 && (i === 0 || i === cols - 1);
      }),
    [cols, rows, pin],
  );
  const geo = useMemo(
    () => buildGridGeometry(cols, rows, grid.positions),
    [cols, rows, grid.positions],
  );
  useEffect(() => {
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }, [geo]);
  const matResolved = useMemo(
    () => resolveMaterialDefaults(effectiveMaterial ?? entity.material),
    [effectiveMaterial, entity.material],
  );
  const damping = sb.damping ?? matResolved.drag;
  const tRef = useRef(0);
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    tRef.current += dt;
    const wind = readWindVec(env);
    stepVerlet(
      grid,
      dt,
      damping,
      wind[0] * 0.5,
      wind[1] - 9.81,
      wind[2] * 0.5 + 0.3 * Math.sin(tRef.current * 2.2),
      4,
    );
    applyClothCollision(
      grid.positions,
      grid.previous,
      grid.pinned,
      groupRef.current,
      gatherSoftColliders(worldRef.current, allEntities, entity.id),
    );
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    geo.computeVertexNormals();
  });
  const color = pickColor(effectiveMaterial ?? entity.material, "#a87a5a");
  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
    >
      {isPlaying && <RapierWorldProbe worldRef={worldRef} />}
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial
          color={color}
          side={THREE.DoubleSide}
          metalness={0.05}
          roughness={0.9}
        />
      </mesh>
      {selected && (
        <mesh geometry={geo} renderOrder={999}>
          <meshBasicMaterial
            color={SELECTION_COLOR}
            wireframe
            transparent
            opacity={0.85}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

/** Particles — pooled THREE.Points emitter. Supports continuous and
 *  burst modes (puff / impact spark). */
export function ParticlesEntity({ entity, selected, onPick, effectiveMaterial }: VerletEntityProps) {
  const env = useEditor((s) => s.sceneData.environment);
  const allEntities = useEditor((s) => s.sceneData.entities);
  const isPlaying = useEditor((s) => s.isPlaying);
  const worldRef = useRef<RapierLikeWorld | null>(null);
  const matResolved = useMemo(
    () => resolveMaterialDefaults(effectiveMaterial ?? entity.material),
    [effectiveMaterial, entity.material],
  );
  const cfg = useMemo(
    () => resolveEmitter(entity.softBody, matResolved.drag),
    [entity.softBody, matResolved.drag],
  );
  const color = pickColor(effectiveMaterial ?? entity.material, "#cccccc");

  const pool = useMemo(() => makeParticlePool(cfg.capacity), [cfg.capacity]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pool.positions, 3));
    g.setDrawRange(0, 0);
    return g;
  }, [pool]);
  const stateRef = useRef<EmitState>({ accum: 0, fired: false });
  const groupRef = useRef<THREE.Group>(null);
  // Reset emitter state when mode flips so a continuous-→-burst toggle
  // immediately fires the opening burst (and vice-versa doesn't carry
  // a stale accumulator).
  useEffect(() => {
    stateRef.current = { accum: 0, fired: false };
  }, [cfg.mode, cfg.burstCount, cfg.burstInterval]);

  useFrame((_, dt) => {
    const h = Math.min(dt, 1 / 20);
    const wind = readWindVec(env);
    tickEmitter(pool, stateRef.current, cfg, {
      windX: wind[0],
      windY: wind[1],
      windZ: wind[2],
      emitVelocity: cfg.emitVelocity,
    }, h);
    // Build the per-frame collider list and translate it into the
    // particle group's local frame. We only translate (not rotate /
    // scale) — the particle emitter's group is identity-orientation in
    // practice, so a coarse AABB approximation is sufficient.
    let localColliders: SoftCollider[] | undefined;
    if (cfg.collideGround && groupRef.current) {
      const worldColliders = gatherSoftColliders(worldRef.current, allEntities, entity.id);
      if (worldColliders.length > 0) {
        groupRef.current.updateWorldMatrix(true, false);
        const gp = groupRef.current.getWorldPosition(new THREE.Vector3());
        localColliders = worldColliders.map((c) => ({
          ...c,
          cx: c.cx - gp.x,
          cy: c.cy - gp.y,
          cz: c.cz - gp.z,
        }));
      }
    }
    const { live, maxIdx } = tickParticles(
      pool,
      cfg,
      wind[0],
      wind[1],
      wind[2],
      h,
      localColliders,
    );
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    geo.setDrawRange(0, live === 0 ? 0 : maxIdx);
  });

  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
    >
      {isPlaying && <RapierWorldProbe worldRef={worldRef} />}
      <mesh visible={selected}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial color={SELECTION_COLOR} wireframe />
      </mesh>
      <points geometry={geo}>
        <pointsMaterial
          color={color}
          size={0.18}
          sizeAttenuation
          transparent
          opacity={0.75}
          depthWrite={false}
        />
      </points>
    </group>
  );
}
