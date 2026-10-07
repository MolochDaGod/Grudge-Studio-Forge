/**
 * ALE / Catsot-parity game modes for Forge.
 * One-shot build → verify → Play over existing Fast assets + editor play.
 * Do not invent a second engine.
 */
import type { SceneEntity } from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";
import { FAST_ASSETS, fetchFastCatalog } from "@/lib/fastAssets";
import { requireAgentAssetUrl } from "@/lib/assetUrlPolicy";
import { isNaturePackKey } from "@/lib/worldBiomeKit";
import { addEntityCommand, type StoreLike } from "@/lib/commands";
import { runFullSceneVerification } from "@/lib/ai/sceneVerification";
import { handlers as worldHandlers } from "@/ai/tools/world";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

export type ForgeGameModeId =
  | "tps-shooter"
  | "parkour"
  | "arena"
  | "sandbox"
  | "pirate-lobby"
  | "survival";

export type ForgeGameModeDef = {
  id: ForgeGameModeId;
  name: string;
  blurb: string;
  tags: string[];
  raceFastId: string;
  cameraMode: "thirdPerson" | "firstPerson" | "rts" | "editor";
  worldRecipe?: string;
  platforms?: boolean;
};

export const FORGE_GAME_MODES: ForgeGameModeDef[] = [
  {
    id: "tps-shooter",
    name: "Third-Person Shooter",
    blurb: "Toon hero + third-person WASD + cover boxes. Auto-play.",
    tags: ["tps", "shooter", "third-person", "fps"],
    raceFastId: "char-g6-human",
    cameraMode: "thirdPerson",
    worldRecipe: "alpine-mesh",
    platforms: true,
  },
  {
    id: "parkour",
    name: "Parkour",
    blurb: "Platform course + third-person run/jump.",
    tags: ["parkour", "platformer", "course"],
    raceFastId: "char-g6-human",
    cameraMode: "thirdPerson",
    platforms: true,
  },
  {
    id: "arena",
    name: "Arena Skirmish",
    blurb: "Flat arena + Toon hero + cover.",
    tags: ["arena", "deathmatch", "pvp", "skirmish"],
    raceFastId: "char-g6-orc",
    cameraMode: "thirdPerson",
    platforms: true,
  },
  {
    id: "sandbox",
    name: "Sandbox",
    blurb: "Empty ground + Toon hero for free build.",
    tags: ["sandbox", "empty", "playground"],
    raceFastId: "char-g6-human",
    cameraMode: "thirdPerson",
  },
  {
    id: "pirate-lobby",
    name: "Pirate Lobby",
    blurb: "Island biome world + Toon walkabout.",
    tags: ["pirate", "lobby", "island", "open"],
    raceFastId: "char-g6-human",
    cameraMode: "thirdPerson",
    worldRecipe: "island",
  },
  {
    id: "survival",
    name: "Survival",
    blurb: "Outdoor world + Toon hero.",
    tags: ["survival", "craft", "outdoor"],
    raceFastId: "char-g6-barb",
    cameraMode: "thirdPerson",
    worldRecipe: "spline-forest",
  },
];

const MAKE_RE =
  /\b(make|create|build|scaffold|spin\s*up|apply)\b[\s\S]{0,40}\b(game|tps|fps|shooter|parkour|arena|sandbox|survival|lobby|playable|mode)\b|\b(third[-\s]?person|tps|fps|parkour|platformer|deathmatch)\b/i;

export function isPlayableBuildRequest(text: string): boolean {
  return MAKE_RE.test(text.trim());
}

export function inferGameMode(text: string): ForgeGameModeId {
  const t = text.toLowerCase();
  if (/parkour|platform/.test(t)) return "parkour";
  if (/pirate|island|lobby/.test(t)) return "pirate-lobby";
  if (/survival|harvest|craft/.test(t)) return "survival";
  if (/arena|deathmatch|skirmish|pvp/.test(t)) return "arena";
  if (/sandbox|empty|playground/.test(t)) return "sandbox";
  if (/tps|third|shooter|fps|shotoer/.test(t)) return "tps-shooter";
  return "tps-shooter";
}

const newId = () => Math.random().toString(36).slice(2, 10);

function makeStoreLike(): StoreLike {
  return {
    getEntities: () => useEditor.getState().sceneData.entities,
    setEntities: (next) => useEditor.getState().setEntities(next),
    selectEntity: (id) => useEditor.getState().selectEntity(id),
  };
}

function pushEntity(e: SceneEntity) {
  useEditor.getState().commandStack.push(addEntityCommand(makeStoreLike(), e));
}

async function spawnFast(
  id: string,
  name: string,
  position: [number, number, number],
): Promise<{ ok: true; id: string; name: string; fastId: string } | { ok: false; error: string }> {
  const { items } = await fetchFastCatalog();
  const a = items.find((x) => x.id === id) ?? FAST_ASSETS.find((x) => x.id === id);
  if (!a) return { ok: false, error: `Unknown fast asset "${id}"` };
  if (a.group !== "maps" && isNaturePackKey(a.modelUrl)) {
    return { ok: false, error: `Refusing pack key ${a.id}` };
  }
  let modelUrl: string;
  try {
    modelUrl = requireAgentAssetUrl(a.modelUrl);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const scale = a.scale != null ? a.scale : 1;
  const e: SceneEntity = {
    id: newId(),
    name,
    type: "model",
    parentId: null,
    transform: {
      position,
      rotation: [0, 0, 0],
      scale: [scale, scale, scale],
    },
    model: { url: modelUrl },
  };
  pushEntity(e);
  await useEditor.getState().explodeGlbHierarchy(e.id);
  return { ok: true, id: e.id, name: e.name, fastId: a.id };
}

function ensureGround(): string | null {
  const ents = useEditor.getState().sceneData.entities;
  const hasGround = ents.some(
    (e) =>
      e.layer === "Terrain" ||
      e.surface === "Walk" ||
      (e.type === "plane" && (e.name || "").toLowerCase().includes("ground")) ||
      (e.type === "box" &&
        (e.name || "").toLowerCase().includes("ground") &&
        (e.transform?.scale?.[0] ?? 0) >= 20),
  );
  if (hasGround) return null;
  const g: SceneEntity = {
    id: newId(),
    name: "Ground",
    type: "plane",
    parentId: null,
    transform: {
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [40, 40, 1],
    },
    material: { color: "#1a2332" },
    physics: { bodyType: "fixed", colliderType: "cuboid" },
    layer: "Terrain",
    surface: "Walk",
  };
  pushEntity(g);
  return g.id;
}

function addCoverBoxes(): string[] {
  const ids: string[] = [];
  const spots: Array<[number, number, number, number, number, number]> = [
    [4, 0.6, -3, 1.2, 1.2, 1.2],
    [-5, 0.6, 2, 1.2, 1.2, 1.2],
    [0, 0.6, 6, 1.2, 1.2, 1.2],
    [8, 1.2, 4, 2, 2.4, 1],
  ];
  spots.forEach(([x, y, z, sx, sy, sz], i) => {
    const b: SceneEntity = {
      id: newId(),
      name: `Cover_${i + 1}`,
      type: "box",
      parentId: null,
      transform: {
        position: [x, y, z],
        rotation: [0, 0, 0],
        scale: [sx, sy, sz],
      },
      material: { color: i % 2 ? "#4a6fa5" : "#6b8f71" },
      physics: { bodyType: "fixed", colliderType: "cuboid" },
    };
    pushEntity(b);
    ids.push(b.id);
  });
  return ids;
}

function verifyPlayableNow(): {
  ok: boolean;
  issues: string[];
  playerId?: string;
  cameraMode?: string;
} {
  const s = useEditor.getState();
  const ents = s.sceneData.entities;
  const env = s.sceneData.environment || {};
  const issues: string[] = [];
  const player = ents.find(
    (e) =>
      e.controllerKind === "thirdPerson" ||
      e.controllerKind === "firstPerson" ||
      /^player$/i.test(e.name || ""),
  );
  if (!player) issues.push("No player controller (set_player / apply_game_mode).");
  const cam = (env as { cameraMode?: string }).cameraMode || "editor";
  if (cam === "editor") {
    issues.push("cameraMode is still editor — expect thirdPerson for TPS play.");
  }
  const ground = ents.some(
    (e) =>
      e.layer === "Terrain" ||
      e.surface === "Walk" ||
      (e.type === "plane" && (e.name || "").toLowerCase().includes("ground")),
  );
  if (!ground) issues.push("No obvious ground / Terrain layer.");
  return {
    ok: issues.length === 0,
    issues,
    playerId: player?.id,
    cameraMode: cam,
  };
}

const RACE_TO_FAST: Record<string, string> = {
  human: "char-g6-human",
  warrior: "char-g6-human",
  orc: "char-g6-orc",
  elf: "char-g6-elf",
  dwarf: "char-g6-dwarf",
  barb: "char-g6-barb",
  barbarian: "char-g6-barb",
};

const LIST_EXAMPLES: ToolDef = {
  name: "list_game_examples",
  description:
    "List Forge one-shot playable game modes (tps-shooter, parkour, arena, …). Call apply_game_mode next — never essay a fake game.",
  input_schema: { type: "object", properties: {} },
};

const listExamplesHandler: ToolHandler = async () => ({
  ok: true,
  data: {
    modes: FORGE_GAME_MODES.map((m) => ({
      id: m.id,
      name: m.name,
      blurb: m.blurb,
      tags: m.tags,
    })),
    next: "apply_game_mode({ mode:'tps-shooter', autoPlay:true })",
  },
});

const SPAWN_TOON: ToolDef = {
  name: "spawn_toon_race",
  description:
    "Spawn a grudge6 Toon RTS race kit (Fast char-g6-*). Default human. Prefer this over inventing CDN URLs.",
  input_schema: {
    type: "object",
    properties: {
      race: {
        type: "string",
        description: "human|orc|elf|dwarf|barb (maps to char-g6-*)",
      },
      name: { type: "string" },
      position: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
      },
      asPlayer: {
        type: "boolean",
        description: "If true (default), set thirdPerson controller on the spawn",
      },
    },
  },
};

const spawnToonHandler: ToolHandler = async (input) => {
  const race = String(input.race || "human").toLowerCase();
  const fastId = RACE_TO_FAST[race] || "char-g6-human";
  const pos = (input.position as [number, number, number] | undefined) || [0, 0, 0];
  const name = typeof input.name === "string" ? input.name : "Player";
  const spawned = await spawnFast(fastId, name, pos);
  if (!spawned.ok) return { ok: false, error: spawned.error };
  if (input.asPlayer !== false) {
    useEditor.getState().cmdSetEntityController(spawned.id, "thirdPerson");
  }
  return {
    ok: true,
    data: {
      id: spawned.id,
      name: spawned.name,
      fastId: spawned.fastId,
      controller: input.asPlayer !== false ? "thirdPerson" : "none",
    },
  };
};

const APPLY_MODE: ToolDef = {
  name: "apply_game_mode",
  description:
    "ONE-SHOT playable game: world/ground + Toon race + thirdPerson player + cover + verify + optional Play. Modes: tps-shooter|parkour|arena|sandbox|pirate-lobby|survival. On make/create/TPS requests ALWAYS call this — ban essay/example-code replies.",
  input_schema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        description: "tps-shooter | parkour | arena | sandbox | pirate-lobby | survival",
      },
      autoPlay: {
        type: "boolean",
        description: "Default true — enter Play after verify",
      },
      race: { type: "string", description: "Optional race override for spawn_toon_race" },
    },
    required: ["mode"],
  },
};

const applyModeHandler: ToolHandler = async (input) => {
  const raw = String(input.mode || "tps-shooter").toLowerCase();
  const mode =
    FORGE_GAME_MODES.find((m) => m.id === raw) ||
    FORGE_GAME_MODES.find((m) => m.tags.some((t) => raw.includes(t))) ||
    FORGE_GAME_MODES[0];
  const autoPlay = input.autoPlay !== false;
  const steps: string[] = [];

  if (mode.worldRecipe) {
    try {
      const w = await worldHandlers.create_world({
        recipe: mode.worldRecipe,
        replace: true,
        size: 64,
        density: 0.45,
      });
      steps.push(w.ok ? `create_world:${mode.worldRecipe}` : `create_world_failed:${w.error}`);
    } catch (e) {
      steps.push(`create_world_err:${e instanceof Error ? e.message : String(e)}`);
      ensureGround();
      steps.push("ground:fallback");
    }
  } else {
    const gid = ensureGround();
    steps.push(gid ? `ground:${gid}` : "ground:existing");
  }

  if (mode.platforms) {
    const boxes = addCoverBoxes();
    steps.push(`cover:${boxes.length}`);
  }

  const raceKey = typeof input.race === "string" ? input.race : undefined;
  const fastId = raceKey
    ? RACE_TO_FAST[raceKey.toLowerCase()] || mode.raceFastId
    : mode.raceFastId;
  const spawned = await spawnFast(fastId, "Player", [0, 0.05, 0]);
  if (!spawned.ok) return { ok: false, error: spawned.error, data: { steps } };
  useEditor.getState().cmdSetEntityController(spawned.id, "thirdPerson");
  steps.push(`player:${spawned.id}:${fastId}`);

  useEditor.getState().cmdSetEnvironment(
    { cameraMode: mode.cameraMode },
    `ALE · ${mode.name}`,
  );
  steps.push(`camera:${mode.cameraMode}`);

  const playable = verifyPlayableNow();
  const full = runFullSceneVerification(useEditor.getState().sceneData.entities, {
    includeOk: false,
  });
  steps.push(`verify_playable:${playable.ok}`);
  steps.push(`verify_scene_full:${full.ok}`);

  if (autoPlay && playable.ok) {
    useEditor.getState().setPlaying(true);
    steps.push("start_playtest:true");
  } else if (autoPlay) {
    steps.push("start_playtest:skipped_unplayable");
  }

  return {
    ok: playable.ok,
    data: {
      mode: mode.id,
      name: mode.name,
      playerId: spawned.id,
      steps,
      playable,
      sceneVerifyOk: full.ok,
      playing: useEditor.getState().isPlaying,
      next: playable.ok
        ? ["WASD in viewport", "Stop Play from toolbar to edit"]
        : ["diagnose_scene", "fix issues", "start_playtest"],
    },
    error: playable.ok ? undefined : playable.issues.join("; "),
  };
};

const START_PLAY: ToolDef = {
  name: "start_playtest",
  description:
    "Enter Forge Play mode (WASD on player). Prefer after apply_game_mode / verify_playable.",
  input_schema: { type: "object", properties: {} },
};

const startPlayHandler: ToolHandler = async () => {
  const v = verifyPlayableNow();
  useEditor.getState().setPlaying(true);
  return { ok: true, data: { playing: true, playable: v } };
};

const STOP_PLAY: ToolDef = {
  name: "stop_playtest",
  description: "Exit Forge Play mode back to edit.",
  input_schema: { type: "object", properties: {} },
};

const stopPlayHandler: ToolHandler = async () => {
  useEditor.getState().setPlaying(false);
  return { ok: true, data: { playing: false } };
};

const VERIFY_PLAYABLE: ToolDef = {
  name: "verify_playable",
  description:
    "Check player controller + cameraMode + ground before claiming a game works. Different from verify_scene_full (scale/tex).",
  input_schema: { type: "object", properties: {} },
};

const verifyPlayableHandler: ToolHandler = async () => {
  const v = verifyPlayableNow();
  return { ok: v.ok, data: v, error: v.ok ? undefined : v.issues.join("; ") };
};

export const defs: ToolDef[] = [
  LIST_EXAMPLES,
  SPAWN_TOON,
  APPLY_MODE,
  START_PLAY,
  STOP_PLAY,
  VERIFY_PLAYABLE,
];

export const handlers: Record<string, ToolHandler> = {
  list_game_examples: listExamplesHandler,
  spawn_toon_race: spawnToonHandler,
  apply_game_mode: applyModeHandler,
  start_playtest: startPlayHandler,
  stop_playtest: stopPlayHandler,
  verify_playable: verifyPlayableHandler,
};

/** Force-build must not block on confirm dialogs. */
export const destructiveToolNames: string[] = [];
