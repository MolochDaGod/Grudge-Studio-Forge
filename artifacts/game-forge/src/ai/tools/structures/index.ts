/**
 * AI tools for structure mesh / layer kit — walls with openings, ladders,
 * archways, holes. Uses `@workspace/scene-templates` structure helpers so
 * colliders and surfaces stay correct (solid walls, open doorways, climb
 * sensors).
 */
import { useEditor } from "@/store/editor";
import { addEntitiesCommand, type StoreLike } from "@/lib/commands";
import { buildStructures } from "@workspace/scene-templates";
import type { SceneEntity } from "@workspace/scene-schema";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const KINDS = ["doorwall", "archway", "ladder", "hole", "testkit"] as const;
type Kind = (typeof KINDS)[number];

function editorStore(): StoreLike {
  return {
    getEntities: () => useEditor.getState().sceneData.entities,
    setEntities: (next) => useEditor.getState().setEntities(next),
    selectEntity: (id) => useEditor.getState().selectEntity(id),
  };
}

const ADD_STRUCTURE: ToolDef = {
  name: "add_structure",
  description:
    "Add meshed structure pieces with correct physics layers: doorwall (solid walls + open doorway, no collider in the gap), archway (pillars + lintel, open center), ladder (Trigger sensor + Climb surface — player W/S climbs), hole (floor rim, open center), testkit (demo ground + walls + ladder + arch). Prefer these over a single sealed AABB on a whole map GLB.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...KINDS],
        description: "Structure type to spawn.",
      },
      position: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
        description: "World position [x,y,z]. For ladders this is the base.",
      },
      rotationY: { type: "number", description: "Yaw radians." },
      length: { type: "number", description: "doorwall total length (m)." },
      height: { type: "number", description: "Wall/ladder/arch height (m)." },
      doorwayWidth: { type: "number" },
      doorwayHeight: { type: "number" },
      width: { type: "number", description: "archway opening width." },
      name: { type: "string" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
};

const addStructureHandler: ToolHandler = async (input) => {
  const kind = input.kind as Kind;
  if (!KINDS.includes(kind)) {
    return {
      ok: false,
      error: `Unknown kind '${String(input.kind)}'. Use: ${KINDS.join(", ")}`,
    };
  }
  const position = Array.isArray(input.position)
    ? (input.position as [number, number, number])
    : ([0, 0, 0] as [number, number, number]);
  const entities = buildStructures(kind, {
    position,
    rotationY: typeof input.rotationY === "number" ? input.rotationY : undefined,
    length: typeof input.length === "number" ? input.length : undefined,
    height: typeof input.height === "number" ? input.height : undefined,
    doorwayWidth:
      typeof input.doorwayWidth === "number" ? input.doorwayWidth : undefined,
    doorwayHeight:
      typeof input.doorwayHeight === "number" ? input.doorwayHeight : undefined,
    width: typeof input.width === "number" ? input.width : undefined,
    name: typeof input.name === "string" ? input.name : undefined,
  }) as SceneEntity[];

  if (entities.length === 0) {
    return { ok: false, error: "No entities produced." };
  }

  useEditor
    .getState()
    .commandStack.push(
      addEntitiesCommand(
        editorStore(),
        entities,
        `Add structure ${kind}`,
        entities[0]?.id,
      ),
    );

  return {
    ok: true,
    data: {
      kind,
      count: entities.length,
      ids: entities.map((e) => e.id),
      names: entities.map((e) => e.name),
      note:
        kind === "ladder"
          ? "Ladder is Trigger+Climb. Play mode: walk into it, hold W to climb up / S down, Space to detach."
          : kind === "doorwall" || kind === "archway"
            ? "Opening has no collider — only wall segments are solid Terrain."
            : undefined,
    },
  };
};

const DESCRIBE_STRUCTURE_LAYERS: ToolDef = {
  name: "describe_structure_layers",
  description:
    "Explain how maps/walls/ladders/openings should be meshed and layered: solid Terrain walls, no collider in doorways, ladders as Trigger+Climb sensors, map GLB trimesh vs AABB vs visual-only.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const describeHandler: ToolHandler = async () => ({
  ok: true,
  data: {
    axes: {
      layer: "Rapier collision groups (Terrain, Player, Trigger, …)",
      surface: "Walk | Climb | Swim | Jump | Dig | None — nav + climb probes",
      material: "visual + friction defaults",
    },
    rules: [
      "Walls: fixed cuboid, layer Terrain, surface Walk — solid colliders.",
      "Doorways/archways: compose wall segments with a gap; never one sealed AABB over the whole facade.",
      "Ladders: layer Trigger (sensor), surface Climb — enter volume, W/S climb, Space detach.",
      "Map GLBs: prefer collideMode trimesh for small arenas (mesh holes passable); large maps = visual + ground plane + structure kit props.",
      "Holes: rim walls only; open center has no floor collider.",
      "Never put Climb on a thick solid Terrain box if you want the player inside the volume — use Trigger sensor.",
    ],
    tools: ["add_structure kind=doorwall|archway|ladder|hole|testkit"],
  },
});

export const defs: ToolDef[] = [ADD_STRUCTURE, DESCRIBE_STRUCTURE_LAYERS];
export const handlers: Record<string, ToolHandler> = {
  add_structure: addStructureHandler,
  describe_structure_layers: describeHandler,
};
export const destructiveToolNames = ["add_structure"];
