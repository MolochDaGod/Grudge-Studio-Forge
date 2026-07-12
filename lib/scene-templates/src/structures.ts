/**
 * Structure mesh + layer kit.
 *
 * Walls, doorways, archways, ladders, holes — authored as composed entities
 * with the correct physics layers / surfaces so:
 *   - solid wall segments block the Player (Terrain + Walk cuboids)
 *   - openings have NO collider (walk-through)
 *   - ladders are sensors (Trigger) with surface Climb (enter to climb)
 *   - floors stay Terrain + Walk
 *
 * Use from templates (`builders.ts`) and from the editor AI tool
 * `add_structure`. Deterministic IDs via the same counter as builders —
 * callers must run inside `withIdScope`.
 */
import type { SceneEntity, SurfaceKind, LayerName } from "@workspace/scene-schema";

type IdFn = () => string;

function idFactory(scope: string): IdFn {
  let n = 0;
  return () => `${scope}-${(n++).toString(36).padStart(4, "0")}`;
}

/** Solid wall segment — blocks players/NPCs. */
export function wallSegment(
  id: IdFn,
  opts: {
    name?: string;
    position: [number, number, number];
    /** Local size (m). Default 4 × 3 × 0.35. */
    size?: [number, number, number];
    rotationY?: number;
    parentId?: string | null;
    color?: string;
  },
): SceneEntity {
  const size = opts.size ?? [4, 3, 0.35];
  return {
    id: id(),
    name: opts.name ?? "Wall",
    type: "box",
    transform: {
      position: opts.position,
      rotation: [0, opts.rotationY ?? 0, 0],
      scale: size,
    },
    parentId: opts.parentId ?? null,
    material: {
      color: opts.color ?? "#5a534c",
      metalness: 0.05,
      roughness: 0.9,
    },
    layer: "Terrain" satisfies LayerName,
    surface: "Walk" satisfies SurfaceKind,
    physics: {
      bodyType: "fixed",
      colliderType: "cuboid",
      mass: 0,
      restitution: 0.05,
      friction: 0.95,
    },
  };
}

/**
 * Wall with a centered doorway gap — two solid wall segments + optional
 * lintel. Opening has no collider (player walks through).
 *
 * Layout (top-down, wall along +X):
 *   [wallL]  [gap]  [wallR]
 *            ^ doorwayWidth
 */
export function wallWithDoorway(
  id: IdFn,
  opts: {
    /** Center of the full wall span on the ground. */
    position: [number, number, number];
    /** Total wall length (m). Default 8. */
    length?: number;
    /** Wall height (m). Default 3. */
    height?: number;
    /** Wall thickness (m). Default 0.4. */
    thickness?: number;
    /** Door opening width (m). Default 1.6. */
    doorwayWidth?: number;
    /** Door opening height (m). Default 2.2. */
    doorwayHeight?: number;
    rotationY?: number;
    parentId?: string | null;
    name?: string;
    /** When true, add a lintel beam above the door. Default true. */
    lintel?: boolean;
  },
): SceneEntity[] {
  const length = opts.length ?? 8;
  const height = opts.height ?? 3;
  const thickness = opts.thickness ?? 0.4;
  const doorW = Math.min(opts.doorwayWidth ?? 1.6, length - 0.4);
  const doorH = Math.min(opts.doorwayHeight ?? 2.2, height - 0.2);
  const side = (length - doorW) / 2;
  const yaw = opts.rotationY ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const [cx, cy, cz] = opts.position;
  const parentId = opts.parentId ?? null;
  const base = opts.name ?? "DoorWall";

  // Local X offsets for left/right segment centers
  const leftLocalX = -(doorW / 2 + side / 2);
  const rightLocalX = doorW / 2 + side / 2;
  const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
    cx + lx * cos - lz * sin,
    cy + ly,
    cz + lx * sin + lz * cos,
  ];

  const out: SceneEntity[] = [];
  if (side > 0.05) {
    out.push(
      wallSegment(id, {
        name: `${base}_L`,
        position: toWorld(leftLocalX, height / 2, 0),
        size: [side, height, thickness],
        rotationY: yaw,
        parentId,
      }),
    );
    out.push(
      wallSegment(id, {
        name: `${base}_R`,
        position: toWorld(rightLocalX, height / 2, 0),
        size: [side, height, thickness],
        rotationY: yaw,
        parentId,
      }),
    );
  }
  if (opts.lintel !== false && height - doorH > 0.15) {
    const lintelH = height - doorH;
    out.push(
      wallSegment(id, {
        name: `${base}_Lintel`,
        position: toWorld(0, doorH + lintelH / 2, 0),
        size: [doorW + 0.1, lintelH, thickness],
        rotationY: yaw,
        parentId,
        color: "#4a443e",
      }),
    );
  }
  // Marker empty for AI / spawn logic (no collider)
  out.push({
    id: id(),
    name: `${base}_Doorway`,
    type: "empty",
    transform: {
      position: toWorld(0, doorH / 2, 0),
      rotation: [0, yaw, 0],
      scale: [doorW, doorH, thickness],
    },
    parentId,
    layer: "IgnoreRaycast",
    surface: "None",
  });
  return out;
}

/**
 * Archway — two pillars + curved-looking top (box lintel + optional side
 * corbels). Opening center is empty (no collider).
 */
export function archway(
  id: IdFn,
  opts: {
    position: [number, number, number];
    /** Opening width. Default 2.4. */
    width?: number;
    /** Opening height (to underside of arch). Default 2.8. */
    height?: number;
    /** Pillar / depth thickness. Default 0.5. */
    thickness?: number;
    rotationY?: number;
    parentId?: string | null;
    name?: string;
  },
): SceneEntity[] {
  const w = opts.width ?? 2.4;
  const h = opts.height ?? 2.8;
  const t = opts.thickness ?? 0.5;
  const yaw = opts.rotationY ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const [cx, cy, cz] = opts.position;
  const parentId = opts.parentId ?? null;
  const base = opts.name ?? "Arch";
  const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
    cx + lx * cos - lz * sin,
    cy + ly,
    cz + lx * sin + lz * cos,
  ];
  const pillarH = h;
  const half = w / 2 + t / 2;
  return [
    wallSegment(id, {
      name: `${base}_PillarL`,
      position: toWorld(-half, pillarH / 2, 0),
      size: [t, pillarH, t],
      rotationY: yaw,
      parentId,
      color: "#6a635c",
    }),
    wallSegment(id, {
      name: `${base}_PillarR`,
      position: toWorld(half, pillarH / 2, 0),
      size: [t, pillarH, t],
      rotationY: yaw,
      parentId,
      color: "#6a635c",
    }),
    wallSegment(id, {
      name: `${base}_Top`,
      position: toWorld(0, h + t / 2, 0),
      size: [w + t * 2, t, t],
      rotationY: yaw,
      parentId,
      color: "#5a534c",
    }),
    {
      id: id(),
      name: `${base}_Opening`,
      type: "empty",
      transform: {
        position: toWorld(0, h / 2, 0),
        rotation: [0, yaw, 0],
        scale: [w, h, t],
      },
      parentId,
      layer: "IgnoreRaycast",
      surface: "None",
    },
  ];
}

/**
 * Ladder / climb volume.
 *
 * Uses **Trigger** layer (sensor — no solid contact) + **Climb** surface so
 * the player can walk into the volume and climb without being blocked by a
 * solid Terrain wall. Visual is a thin box (rungs optional later).
 */
export function ladder(
  id: IdFn,
  opts: {
    position: [number, number, number];
    /** Height of climbable volume (m). Default 4. */
    height?: number;
    /** Width of ladder face (m). Default 1. */
    width?: number;
    /** Depth of sensor volume (m). Default 0.55. */
    depth?: number;
    rotationY?: number;
    parentId?: string | null;
    name?: string;
  },
): SceneEntity {
  const h = opts.height ?? 4;
  const w = opts.width ?? 1;
  const d = opts.depth ?? 0.55;
  const [x, y, z] = opts.position;
  return {
    id: id(),
    name: opts.name ?? "Ladder",
    type: "box",
    transform: {
      // Center of volume sits half-height above base
      position: [x, y + h / 2, z],
      rotation: [0, opts.rotationY ?? 0, 0],
      scale: [w, h, d],
    },
    parentId: opts.parentId ?? null,
    material: {
      color: "#8b6914",
      metalness: 0.15,
      roughness: 0.75,
      opacity: 0.85,
    },
    // Trigger → sensor by default (Environment.sensorLayers)
    layer: "Trigger" satisfies LayerName,
    surface: "Climb" satisfies SurfaceKind,
    physics: {
      bodyType: "fixed",
      colliderType: "cuboid",
      mass: 0,
      restitution: 0,
      friction: 0,
    },
  };
}

/**
 * Floor hole rim — four thin wall strips around a rectangular hole in a
 * floor (player falls through the open center). Does **not** include a
 * floor plane; place over an existing ground and remove/cut ground separately.
 */
export function floorHoleRim(
  id: IdFn,
  opts: {
    /** Center of the hole on the floor plane. */
    position: [number, number, number];
    /** Hole opening size (m). Default 2 × 2. */
    holeSize?: [number, number];
    /** Rim wall height (m). Default 0.15. */
    rimHeight?: number;
    /** Rim thickness (m). Default 0.25. */
    rimThickness?: number;
    parentId?: string | null;
    name?: string;
  },
): SceneEntity[] {
  const [hw, hd] = opts.holeSize ?? [2, 2];
  const rh = opts.rimHeight ?? 0.15;
  const rt = opts.rimThickness ?? 0.25;
  const [cx, cy, cz] = opts.position;
  const parentId = opts.parentId ?? null;
  const base = opts.name ?? "HoleRim";
  const halfW = hw / 2 + rt / 2;
  const halfD = hd / 2 + rt / 2;
  return [
    wallSegment(id, {
      name: `${base}_N`,
      position: [cx, cy + rh / 2, cz - halfD],
      size: [hw + rt * 2, rh, rt],
      parentId,
      color: "#3a3530",
    }),
    wallSegment(id, {
      name: `${base}_S`,
      position: [cx, cy + rh / 2, cz + halfD],
      size: [hw + rt * 2, rh, rt],
      parentId,
      color: "#3a3530",
    }),
    wallSegment(id, {
      name: `${base}_W`,
      position: [cx - halfW, cy + rh / 2, cz],
      size: [rt, rh, hd],
      parentId,
      color: "#3a3530",
    }),
    wallSegment(id, {
      name: `${base}_E`,
      position: [cx + halfW, cy + rh / 2, cz],
      size: [rt, rh, hd],
      parentId,
      color: "#3a3530",
    }),
    {
      id: id(),
      name: `${base}_Opening`,
      type: "empty",
      transform: {
        position: [cx, cy, cz],
        rotation: [0, 0, 0],
        scale: [hw, 0.1, hd],
      },
      parentId,
      layer: "IgnoreRaycast",
      surface: "None",
    },
  ];
}

/**
 * Demo kit: four walls with one doorway, one archway, one ladder, ground.
 * Useful for testing climb + openings.
 */
export function structureTestKit(opts?: {
  origin?: [number, number, number];
  scope?: string;
}): SceneEntity[] {
  const id = idFactory(opts?.scope ?? "struct");
  const [ox, oy, oz] = opts?.origin ?? [0, 0, 0];
  const out: SceneEntity[] = [];

  // Ground pad
  out.push({
    id: id(),
    name: "StructureGround",
    type: "plane",
    transform: {
      position: [ox, oy, oz],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [24, 24, 1],
    },
    parentId: null,
    material: { color: "#1a1a22", metalness: 0, roughness: 1 },
    layer: "Terrain",
    surface: "Walk",
    physics: {
      bodyType: "fixed",
      colliderType: "cuboid",
      mass: 0,
      restitution: 0.1,
      friction: 1,
    },
  });

  out.push(
    ...wallWithDoorway(id, {
      position: [ox, oy, oz - 6],
      length: 10,
      height: 3.2,
      doorwayWidth: 1.8,
      doorwayHeight: 2.3,
      name: "NorthWall",
    }),
  );
  out.push(
    ...archway(id, {
      position: [ox + 6, oy, oz],
      width: 2.5,
      height: 3,
      rotationY: Math.PI / 2,
      name: "EastArch",
    }),
  );
  out.push(
    ladder(id, {
      position: [ox - 5, oy, oz - 5.6],
      height: 4.5,
      width: 1.1,
      depth: 0.6,
      name: "Ladder_North",
    }),
  );
  // Solid back wall (no opening)
  out.push(
    wallSegment(id, {
      name: "SouthWall",
      position: [ox, oy + 1.5, oz + 6],
      size: [10, 3, 0.4],
    }),
  );
  out.push(
    ...floorHoleRim(id, {
      position: [ox + 2, oy, oz + 2],
      holeSize: [2.2, 2.2],
      name: "Pit",
    }),
  );

  return out;
}

/** Build structures with a fresh local id counter (outside withIdScope). */
export function buildStructures(
  kind: "doorwall" | "archway" | "ladder" | "hole" | "testkit",
  opts: Record<string, unknown> = {},
): SceneEntity[] {
  const id = idFactory(`st-${kind}`);
  switch (kind) {
    case "doorwall":
      return wallWithDoorway(id, {
        position: (opts.position as [number, number, number]) ?? [0, 0, 0],
        length: opts.length as number | undefined,
        height: opts.height as number | undefined,
        doorwayWidth: opts.doorwayWidth as number | undefined,
        doorwayHeight: opts.doorwayHeight as number | undefined,
        rotationY: opts.rotationY as number | undefined,
        name: opts.name as string | undefined,
      });
    case "archway":
      return archway(id, {
        position: (opts.position as [number, number, number]) ?? [0, 0, 0],
        width: opts.width as number | undefined,
        height: opts.height as number | undefined,
        thickness: opts.thickness as number | undefined,
        rotationY: opts.rotationY as number | undefined,
        name: opts.name as string | undefined,
      });
    case "ladder":
      return [
        ladder(id, {
          position: (opts.position as [number, number, number]) ?? [0, 0, 0],
          height: opts.height as number | undefined,
          width: opts.width as number | undefined,
          depth: opts.depth as number | undefined,
          rotationY: opts.rotationY as number | undefined,
          name: opts.name as string | undefined,
        }),
      ];
    case "hole":
      return floorHoleRim(id, {
        position: (opts.position as [number, number, number]) ?? [0, 0, 0],
        holeSize: opts.holeSize as [number, number] | undefined,
        name: opts.name as string | undefined,
      });
    case "testkit":
      return structureTestKit({
        origin: (opts.position as [number, number, number]) ?? [0, 0, 0],
      });
    default:
      return [];
  }
}
