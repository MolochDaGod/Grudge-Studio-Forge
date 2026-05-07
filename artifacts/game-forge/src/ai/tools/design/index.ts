/**
 * AI design & spatial-sense tools — composition helpers the model uses to
 * arrange entities, paint palettes, set lighting, frame cameras, and grab
 * a viewport screenshot for multimodal feedback. Plus a `polish_scene`
 * macro that chains them.
 *
 * Follows the same `{ defs, handlers }` shape as `tools/systems/` so
 * `aiTools.ts` can spread them in with a single import.
 */
import { nanoid } from "nanoid";

import { useEditor } from "@/store/editor";
import { isPaletteFriendly } from "@workspace/scene-schema";
import type { SceneEntity, Vec3 } from "@/scene/types";
import type { Command } from "@/lib/commands";
import { getViewportBridge } from "@/scene/viewportBridge";
import {
  setCameraBookmark,
  getCameraBookmark,
  listCameraBookmarks,
} from "@/ai/cameraBookmarks";
import { bounds, clusterPoints } from "@/ai/tools/systems/cluster";
import { diagnoseScene, summarizeBySeverity } from "@/ai/tools/systems/diagnose";
import {
  gridLayout,
  ringLayout,
  lineLayout,
  scatterLayout,
  clusterLayout,
  type LayoutKind,
  type Vec3 as LVec3,
} from "./layouts";
import {
  PALETTES,
  getPalette,
  resolvePalette,
  assignPaletteColors,
  type PaletteAssignment,
} from "./palette";
import {
  LIGHTING_PRESETS,
  getLightingPreset,
  AUTO_LIGHTING_TAG,
} from "./lighting";
import { frameCamera, type ShotKind } from "./camera";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

// ── Helpers ────────────────────────────────────────────────────────────
function asVec3(v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === "number")) {
    return [v[0] as number, v[1] as number, v[2] as number];
  }
  return fallback;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── arrange_entities ───────────────────────────────────────────────────
const ARRANGE_ENTITIES: ToolDef = {
  name: "arrange_entities",
  description:
    "Reposition existing entities into a layout pattern (grid, ring, line, scatter, cluster). Use this for >5 entities instead of moving them one at a time. Pass entityIds in the order you want filled (the i-th id receives the i-th computed position). Optional jitter adds deterministic noise on top of the pattern. Alignment controls which axis the layout lies on (default 'xz' = ground plane). Returns the new positions and the entity ids that were updated.",
  input_schema: {
    type: "object",
    required: ["entityIds", "pattern"],
    properties: {
      entityIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Entities to reposition. Order matters — they receive layout positions 0..N-1.",
      },
      pattern: {
        type: "string",
        enum: ["grid", "ring", "line", "scatter", "cluster"],
      },
      params: {
        type: "object",
        description: "Pattern parameters.",
        properties: {
          origin: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          spacing: { type: "number", description: "grid/line spacing." },
          cols: { type: "integer", description: "grid only — column count." },
          radius: { type: "number", description: "ring/scatter radius (half-extent for scatter)." },
          arc: { type: "number", description: "ring only — total arc in radians (default 2π)." },
          startAngle: { type: "number", description: "ring only — start angle in radians." },
          direction: {
            type: "array",
            items: { type: "number" },
            minItems: 3,
            maxItems: 3,
            description: "line only — direction vector.",
          },
          minSpacing: { type: "number", description: "scatter only — min separation." },
          clusters: { type: "integer", description: "cluster only — number of cluster centers." },
          clusterRadius: { type: "number", description: "cluster only — spread around each center." },
          fieldRadius: { type: "number", description: "cluster only — half-extent of the centers field." },
          jitter: {
            type: "number",
            description: "Random offset applied on top of every computed point (0 = exact). Default 0.",
          },
          alignment: {
            type: "string",
            enum: ["xz", "xy"],
            description:
              "Plane the layout lies on. 'xz' is the floor (default — Y stays at origin Y). 'xy' uses the wall plane.",
          },
          seed: { type: "integer", description: "Determinism for scatter/cluster/jitter." },
        },
      },
    },
  },
};
const arrangeEntitiesHandler: ToolHandler = async (input) => {
  const ids = Array.isArray(input.entityIds) ? (input.entityIds as string[]) : [];
  if (ids.length === 0) return { ok: false, error: "entityIds must be a non-empty array." };
  const pattern = input.pattern as LayoutKind;
  const p = (input.params as Record<string, unknown> | undefined) ?? {};
  const count = ids.length;
  const origin = asVec3(p.origin);
  const seed = typeof p.seed === "number" ? p.seed : 1;
  let positions: LVec3[] = [];
  switch (pattern) {
    case "grid":
      positions = gridLayout({
        count,
        origin,
        spacing: typeof p.spacing === "number" ? p.spacing : undefined,
        cols: typeof p.cols === "number" ? p.cols : undefined,
      });
      break;
    case "ring":
      positions = ringLayout({
        count,
        origin,
        radius: typeof p.radius === "number" ? p.radius : undefined,
        arc: typeof p.arc === "number" ? p.arc : undefined,
        startAngle: typeof p.startAngle === "number" ? p.startAngle : undefined,
      });
      break;
    case "line":
      positions = lineLayout({
        count,
        origin,
        spacing: typeof p.spacing === "number" ? p.spacing : undefined,
        direction:
          Array.isArray(p.direction) && p.direction.length === 3
            ? asVec3(p.direction, [1, 0, 0])
            : undefined,
      });
      break;
    case "scatter":
      positions = scatterLayout({
        count,
        origin,
        radius: typeof p.radius === "number" ? p.radius : undefined,
        minSpacing: typeof p.minSpacing === "number" ? p.minSpacing : undefined,
        seed,
      });
      break;
    case "cluster":
      positions = clusterLayout({
        count,
        origin,
        clusters: typeof p.clusters === "number" ? p.clusters : undefined,
        clusterRadius: typeof p.clusterRadius === "number" ? p.clusterRadius : undefined,
        fieldRadius: typeof p.fieldRadius === "number" ? p.fieldRadius : undefined,
        seed,
      });
      break;
    default:
      return { ok: false, error: `Unknown pattern '${String(pattern)}'` };
  }

  // Optional jitter (deterministic, additive on the layout plane).
  const jitter = typeof p.jitter === "number" ? Math.max(0, p.jitter) : 0;
  if (jitter > 0) {
    const jr = rng(seed * 31 + 7);
    positions = positions.map(([x, y, z]) => [
      x + (jr() * 2 - 1) * jitter,
      y,
      z + (jr() * 2 - 1) * jitter,
    ]);
  }

  // Alignment: 'xy' rotates the XZ-plane layout onto XY (so the Y axis
  // takes the role Z played, keeping Z constant at origin Z).
  const alignment = p.alignment === "xy" ? "xy" : "xz";
  if (alignment === "xy") {
    positions = positions.map(([x, _y, z]) => [x, origin[1] + (z - origin[2]), origin[2]]);
  }

  const store = useEditor.getState();
  const all = store.sceneData.entities;
  const idSet = new Set(all.map((e) => e.id));
  const updated: { id: string; position: Vec3 }[] = [];
  const missing: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!idSet.has(id)) {
      missing.push(id);
      continue;
    }
    const pos = positions[i];
    store.cmdUpdateEntity(id, (e) => {
      e.transform.position = [pos[0], pos[1], pos[2]];
    });
    updated.push({ id, position: [pos[0], pos[1], pos[2]] });
  }
  return {
    ok: true,
    data: {
      pattern,
      alignment,
      jitter,
      seed,
      updated,
      missing,
    },
  };
};

// ── list_palettes ──────────────────────────────────────────────────────
const LIST_PALETTES: ToolDef = {
  name: "list_palettes",
  description: "List the curated color palettes available to apply_palette (id, name, colors). You can also pass a custom string[] of hex colors directly to apply_palette.",
  input_schema: { type: "object", properties: {} },
};
const listPalettesHandler: ToolHandler = async () => ({
  ok: true,
  data: PALETTES.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    colors: p.colors,
  })),
});

// ── apply_palette ──────────────────────────────────────────────────────
const APPLY_PALETTE: ToolDef = {
  name: "apply_palette",
  description:
    "Recolor entities using a palette. The palette can be a curated id (e.g. 'grudge-gold') OR a literal string[] of hex colors (e.g. ['#1a1a2e','#d4af37']). Targets default to all standard primitives + model entities; pass entityIds to restrict. Assignment strategy: 'random' shuffles, 'by-index' cycles in order, 'by-distance-from-origin' assigns palette colors radially (good for ring/concentric layouts). Existing emissive and metalness are preserved. Optionally also patches environment.skyColor / groundColor from the first palette colors.",
  input_schema: {
    type: "object",
    required: ["palette"],
    properties: {
      palette: {
        anyOf: [
          { type: "string", description: "Named palette id from list_palettes." },
          { type: "array", items: { type: "string" }, minItems: 1, description: "Custom palette of hex colors." },
        ],
      },
      entityIds: {
        type: "array",
        items: { type: "string" },
        description: "Restrict to these entity ids. Defaults to all standard + model entities.",
      },
      assignment: {
        type: "string",
        enum: ["random", "by-index", "by-distance-from-origin"],
        description: "Color assignment strategy. Default 'by-index'.",
      },
      seed: {
        type: "integer",
        description: "Determinism for 'random' assignment. Default 1.",
      },
      includeEnvironment: {
        type: "boolean",
        description:
          "Also patch environment.skyColor / groundColor from the palette's first two colors. Default false (only colors entities).",
      },
      skipBackground: {
        type: "boolean",
        description:
          "When true (default), the first palette color is reserved for background and not assigned to entities.",
      },
      force: {
        type: "boolean",
        description:
          "When true, recolor every matched entity regardless of MaterialKind. Default false skips kinds whose material implies its own colour (Glass / Liquid / Particle / Smoke / Foliage / Cloth / Flag).",
      },
    },
  },
};
const applyPaletteHandler: ToolHandler = async (input) => {
  let colors: string[];
  try {
    colors = resolvePalette(
      input.palette as string | readonly string[],
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const assignment: PaletteAssignment =
    input.assignment === "random" || input.assignment === "by-distance-from-origin"
      ? input.assignment
      : "by-index";
  const seed = typeof input.seed === "number" ? input.seed : 1;
  const skipBackground = input.skipBackground !== false;

  const store = useEditor.getState();
  const all = store.sceneData.entities;
  const ids = Array.isArray(input.entityIds) ? new Set(input.entityIds as string[]) : null;
  // Material guard: skip entities whose Material kind implies its own
  // colour (Glass / Liquid / Particle / Smoke / Foliage). A bulk
  // palette swap on those would make water orange or smoke gold,
  // which is never what the user means by "make it look good". The
  // model can override with `force: true` for explicit recolours.
  const force = input.force === true;
  const skippedByMaterial: { id: string; name: string; kind: string }[] = [];
  const targets = all.filter((e) => {
    if (e.type === "light" || e.type === "camera" || e.type === "empty") return false;
    if (ids && !ids.has(e.id)) return false;
    if (!force && e.material?.kind && !isPaletteFriendly(e.material.kind)) {
      skippedByMaterial.push({ id: e.id, name: e.name, kind: e.material.kind });
      return false;
    }
    return true;
  });
  if (targets.length === 0) {
    return { ok: false, error: "No entities matched — nothing to recolor." };
  }
  const assigned = assignPaletteColors(
    colors,
    targets.map((t) => ({ id: t.id, position: t.transform.position })),
    { assignment, seed, skipBackground },
  );
  const recolored: { id: string; color: string }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const c = assigned[i];
    store.cmdUpdateEntity(t.id, (e) => {
      // Patch ONLY color-related fields. Preserve `kind`, density,
      // friction, restitution, drag, opacity, blocks*, emissive,
      // and any other MaterialComponent overrides the entity carried
      // before the palette pass. Only `color` is overwritten;
      // metalness/roughness fall back to sensible defaults if
      // unset but otherwise keep the entity's own values.
      const prev = e.material ?? {};
      e.material = {
        ...prev,
        color: c,
        metalness: prev.metalness ?? 0.1,
        roughness: prev.roughness ?? 0.6,
      };
    });
    recolored.push({ id: t.id, color: c });
  }
  let environmentPatched = false;
  if (input.includeEnvironment === true) {
    store.cmdSetEnvironment({
      skyColor: colors[0],
      groundColor: colors[1] ?? colors[0],
    });
    environmentPatched = true;
  }
  return {
    ok: true,
    data: {
      palette: colors,
      assignment,
      recoloredCount: recolored.length,
      recolored,
      environmentPatched,
      skippedByMaterial: skippedByMaterial.length ? skippedByMaterial : undefined,
    },
  };
};

// ── list_lighting_presets ──────────────────────────────────────────────
const LIST_LIGHTING_PRESETS: ToolDef = {
  name: "list_lighting_presets",
  description: "List the curated lighting presets available to apply_lighting_preset.",
  input_schema: { type: "object", properties: {} },
};
const listLightingPresetsHandler: ToolHandler = async () => ({
  ok: true,
  data: LIGHTING_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    environment: p.environment,
    lightCount: p.lights.length,
  })),
});

// ── apply_lighting_preset ──────────────────────────────────────────────
const APPLY_LIGHTING_PRESET: ToolDef = {
  name: "apply_lighting_preset",
  description:
    "Apply a curated lighting preset: patches the environment (sky/ground/ambient/sun/fog) and spawns the preset's named light entities. Preset-spawned lights are tagged 'auto:lighting' in their name; re-applying any preset removes prior 'auto:lighting' lights without touching user-authored lights. Available preset ids: studio-3pt, golden-hour, night-neon, overcast, interior-warm. Use list_lighting_presets for descriptions.",
  input_schema: {
    type: "object",
    required: ["presetId"],
    properties: {
      presetId: {
        type: "string",
        enum: ["studio-3pt", "golden-hour", "night-neon", "overcast", "interior-warm"],
      },
    },
  },
};
const applyLightingPresetHandler: ToolHandler = async (input) => {
  const preset = getLightingPreset(String(input.presetId ?? ""));
  if (!preset) return { ok: false, error: `Unknown lighting preset '${input.presetId}'` };
  const store = useEditor.getState();
  // Atomic snapshot: capture before/after of the entire scene, then push a
  // single Command so undo rolls the whole preset application back in one
  // step (env patch + stale-light removals + new-light additions).
  const beforeEntities = store.sceneData.entities;
  const beforeEnv = { ...store.sceneData.environment };
  const stale = beforeEntities.filter(
    (e) => e.type === "light" && e.name.includes(AUTO_LIGHTING_TAG),
  );
  const staleIds = new Set(stale.map((e) => e.id));
  const created: { id: string; name: string }[] = [];
  const newLights: SceneEntity[] = preset.lights.map((l) => {
    const e: SceneEntity = {
      id: nanoid(8),
      name: `[${AUTO_LIGHTING_TAG}] ${preset.id} · ${l.label}`,
      type: "light",
      parentId: null,
      transform: {
        position: l.position,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      light: {
        kind: l.kind,
        color: l.color,
        intensity: l.intensity,
        distance: l.distance,
      },
    };
    created.push({ id: e.id, name: e.name });
    return e;
  });
  const afterEntities: SceneEntity[] = [
    ...beforeEntities.filter((e) => !staleIds.has(e.id)),
    ...newLights,
  ];
  const afterEnv = { ...beforeEnv, ...preset.environment };
  const cmd: Command = {
    kind: "applyLightingPreset",
    label: `Apply lighting: ${preset.id}`,
    do: () => {
      store.setEntities(afterEntities);
      store.setEnvironment(afterEnv);
    },
    undo: () => {
      store.setEntities(beforeEntities);
      store.setEnvironment(beforeEnv);
    },
  };
  store.commandStack.push(cmd);
  return {
    ok: true,
    data: {
      presetId: preset.id,
      removedPriorLights: stale.length,
      addedLights: created,
      environment: preset.environment,
    },
  };
};

// ── frame_camera ───────────────────────────────────────────────────────
const FRAME_CAMERA: ToolDef = {
  name: "frame_camera",
  description:
    "Compute and apply a camera framing for the editor viewport. Frames either a list of target entities or all visible geometry, using a named shot kind. Supported shots: 'hero' (~3/4 medium), 'wide' (further back, more headroom), 'over-shoulder' (camera sits behind a 'fromEntityId' looking at the targets), 'top-down' (orthogonal-ish bird's eye), 'establishing' (very wide, high). Saves the result as a named bookmark you can recall via recall_camera_bookmark. Updates the live OrbitControls when present.",
  input_schema: {
    type: "object",
    properties: {
      bookmark: {
        type: "string",
        description: "Name to save the resulting camera pose as (default 'last_shot').",
      },
      shot: {
        type: "string",
        enum: ["hero", "wide", "over-shoulder", "top-down", "establishing"],
        description: "Default 'hero'.",
      },
      targetEntityIds: {
        type: "array",
        items: { type: "string" },
        description: "Frame these entities. If omitted, frames all visible primitives + models.",
      },
      fromEntityId: {
        type: "string",
        description: "For 'over-shoulder': the entity whose shoulder the camera sits behind.",
      },
      yaw: { type: "number", description: "Optional yaw override in radians." },
      padding: { type: "number", description: "Multiplier on the framing distance (>1 = further back)." },
      note: { type: "string", description: "Optional description stored with the bookmark." },
    },
  },
};
const frameCameraHandler: ToolHandler = async (input) => {
  const store = useEditor.getState();
  const ents = store.sceneData.entities;
  const ids = Array.isArray(input.targetEntityIds)
    ? new Set(input.targetEntityIds as string[])
    : null;
  const subjects = ents.filter((e) => {
    if (ids) return ids.has(e.id);
    return (
      e.type === "box" ||
      e.type === "sphere" ||
      e.type === "cylinder" ||
      e.type === "model"
    );
  });
  if (subjects.length === 0) {
    return { ok: false, error: "No entities matched — nothing to frame." };
  }
  const points = subjects.map((e) => e.transform.position as Vec3);
  let fromPoint: Vec3 | undefined;
  if (typeof input.fromEntityId === "string") {
    const from = ents.find((e) => e.id === input.fromEntityId);
    if (from) fromPoint = from.transform.position as Vec3;
  }
  const result = frameCamera({
    points,
    shot: (input.shot as ShotKind | undefined) ?? "hero",
    yaw: typeof input.yaw === "number" ? input.yaw : undefined,
    padding: typeof input.padding === "number" ? input.padding : undefined,
    fromPoint,
  });
  // Push to live viewport if available.
  const bridge = getViewportBridge();
  if (bridge) {
    bridge.camera.position.set(...result.position);
    if (bridge.controls) {
      bridge.controls.target.set(...result.target);
      bridge.controls.update?.();
    } else {
      const cam = bridge.camera as { lookAt?: (x: number, y: number, z: number) => void };
      cam.lookAt?.(...result.target);
    }
  }
  const name = typeof input.bookmark === "string" && input.bookmark.trim().length > 0
    ? input.bookmark.trim()
    : "last_shot";
  const bookmark = setCameraBookmark({
    name,
    position: result.position,
    target: result.target,
    note: typeof input.note === "string" ? input.note : undefined,
  });
  return {
    ok: true,
    data: {
      bookmark: bookmark.name,
      shot: input.shot ?? "hero",
      position: result.position,
      target: result.target,
      framedRadius: result.radius,
      framedCount: subjects.length,
      appliedToViewport: !!bridge,
    },
  };
};

// ── list_camera_bookmarks ──────────────────────────────────────────────
const LIST_CAMERA_BOOKMARKS: ToolDef = {
  name: "list_camera_bookmarks",
  description: "List previously-saved camera bookmarks (set via frame_camera).",
  input_schema: { type: "object", properties: {} },
};
const listCameraBookmarksHandler: ToolHandler = async () => ({
  ok: true,
  data: listCameraBookmarks(),
});

// ── recall_camera_bookmark ─────────────────────────────────────────────
const RECALL_CAMERA_BOOKMARK: ToolDef = {
  name: "recall_camera_bookmark",
  description:
    "Restore the live editor camera to a previously-saved bookmark. Returns the pose that was applied, or an error if the bookmark name is unknown.",
  input_schema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  },
};
const recallCameraBookmarkHandler: ToolHandler = async (input) => {
  const name = String(input.name ?? "");
  const b = getCameraBookmark(name);
  if (!b) return { ok: false, error: `No bookmark named '${name}'` };
  const bridge = getViewportBridge();
  if (bridge) {
    bridge.camera.position.set(...b.position);
    if (bridge.controls) {
      bridge.controls.target.set(...b.target);
      bridge.controls.update?.();
    } else {
      const cam = bridge.camera as { lookAt?: (x: number, y: number, z: number) => void };
      cam.lookAt?.(...b.target);
    }
  }
  return {
    ok: true,
    data: { ...b, appliedToViewport: !!bridge },
  };
};

// ── capture_viewport ───────────────────────────────────────────────────
const CAPTURE_VIEWPORT: ToolDef = {
  name: "capture_viewport",
  description:
    "Capture the current editor viewport as a JPEG image. Returns { url, mimeType, width, height } where url is a base64 data URL. The image is also automatically attached to the next assistant turn as a multimodal image content block — so you can literally see the scene before deciding what to change next. Use after frame_camera for a deliberate shot. Long edge is capped at 1024 by default.",
  input_schema: {
    type: "object",
    properties: {
      maxEdge: {
        type: "integer",
        minimum: 256,
        maximum: 2048,
        description: "Cap the longer edge in pixels (default 1024).",
      },
      quality: {
        type: "number",
        minimum: 0.3,
        maximum: 0.95,
        description: "JPEG quality 0..1 (default 0.7).",
      },
    },
  },
};
const captureViewportHandler: ToolHandler = async (input) => {
  const bridge = getViewportBridge();
  if (!bridge) {
    return {
      ok: false,
      error:
        "No viewport mounted — capture_viewport requires the editor Canvas to be visible.",
    };
  }
  // Force a fresh render so the framebuffer matches the latest scene state
  // (R3F renders on demand; the back buffer may be stale by the time we
  // call toDataURL).
  try {
    bridge.gl.render(bridge.scene, bridge.camera as never);
  } catch {
    // continue — best effort
  }
  const srcCanvas = bridge.gl.domElement as HTMLCanvasElement;
  const maxEdge = Math.max(256, Math.min(2048, Math.floor(Number(input.maxEdge ?? 1024))));
  const quality = Math.max(0.3, Math.min(0.95, Number(input.quality ?? 0.7)));
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  if (!sw || !sh) {
    return { ok: false, error: "Viewport canvas has zero size — nothing to capture." };
  }
  const longEdge = Math.max(sw, sh);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const out = document.createElement("canvas");
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext("2d");
  if (!ctx) return { ok: false, error: "2D context unavailable for downscaling." };
  ctx.drawImage(srcCanvas, 0, 0, dw, dh);
  const dataUrl = out.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.split(",")[1] ?? "";
  return {
    ok: true,
    data: {
      url: dataUrl,
      mimeType: "image/jpeg",
      width: dw,
      height: dh,
      sourceWidth: sw,
      sourceHeight: sh,
      sizeBytes: Math.floor((base64.length * 3) / 4),
      // Convention recognized by aiClient: when present, the next user
      // turn will include a multimodal image content block alongside the
      // tool_result so the model can actually see the scene.
      __image: { mediaType: "image/jpeg", base64 },
    },
  };
};

// ── polish_scene (macro) ───────────────────────────────────────────────
const POLISH_SCENE: ToolDef = {
  name: "polish_scene",
  description:
    "One-shot 'make it look good' macro. Runs the fixed sequence: diagnose_scene → apply_palette (auto-derived from existing entity colors when there are enough; falls back to grudge-gold) → apply_lighting_preset (default 'studio-3pt') → frame_camera (hero shot on the densest cluster of geometry, saved as bookmark 'polish') → capture_viewport. Returns a summary of what each step did. Use as a finishing pass after building or editing a scene.",
  input_schema: {
    type: "object",
    properties: {
      lightingPreset: {
        type: "string",
        enum: ["studio-3pt", "golden-hour", "night-neon", "overcast", "interior-warm"],
        description: "Lighting preset to apply. Default 'studio-3pt'.",
      },
      paletteOverride: {
        anyOf: [
          { type: "string", description: "Named palette id." },
          { type: "array", items: { type: "string" } },
        ],
        description: "Skip auto-derivation and force a specific palette.",
      },
    },
  },
};
const polishSceneHandler: ToolHandler = async (input) => {
  const summary: Record<string, unknown> = {};

  // 1. Diagnose first so we know what we're working with.
  const store = useEditor.getState();
  const ents = store.sceneData.entities;
  const issues = diagnoseScene({
    entities: store.sceneData.entities,
    environment: store.sceneData.environment,
  });
  summary.diagnose = {
    issueCount: issues.length,
    bySeverity: summarizeBySeverity(issues),
    topIssues: issues.slice(0, 5).map((i) => ({
      severity: i.severity,
      rule: i.rule,
      message: i.message,
    })),
  };

  // 2. Auto-derive palette from existing colors, or use override.
  let palette: string | string[];
  if (typeof input.paletteOverride === "string" || Array.isArray(input.paletteOverride)) {
    palette = input.paletteOverride as string | string[];
  } else {
    const seen = new Map<string, number>();
    for (const e of ents) {
      const c = e.material?.color;
      if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) {
        const lc = c.toLowerCase();
        seen.set(lc, (seen.get(lc) ?? 0) + 1);
      }
    }
    const ranked = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    palette = ranked.length >= 3 ? ranked.slice(0, 6) : "grudge-gold";
  }
  const paletteResult = await applyPaletteHandler({
    palette,
    assignment: "by-distance-from-origin",
    includeEnvironment: false,
  });
  summary.palette = paletteResult.ok
    ? {
        used: palette,
        recoloredCount: (paletteResult.data as { recoloredCount?: number })?.recoloredCount ?? 0,
      }
    : { error: paletteResult.error };

  // 3. Lighting preset.
  const lightingPreset =
    typeof input.lightingPreset === "string" ? input.lightingPreset : "studio-3pt";
  const lightingResult = await applyLightingPresetHandler({ presetId: lightingPreset });
  summary.lighting = lightingResult.ok
    ? {
        presetId: lightingPreset,
        addedLights:
          (lightingResult.data as { addedLights?: unknown[] })?.addedLights?.length ?? 0,
      }
    : { error: lightingResult.error };

  // 4. Frame camera (hero) on the densest cluster of geometry.
  const geometryPoints = ents
    .filter((e) => e.type !== "light" && e.type !== "camera" && e.type !== "empty")
    .map((e) => ({
      id: e.id,
      x: e.transform.position[0],
      y: e.transform.position[1],
      z: e.transform.position[2],
    }));
  let targetIds: string[] | undefined;
  if (geometryPoints.length >= 3) {
    const { clusters } = clusterPoints(geometryPoints, { maxK: 4 });
    if (clusters.length > 0) {
      const densest = clusters.reduce((best, c) =>
        (c.memberIds?.length ?? 0) > (best.memberIds?.length ?? 0) ? c : best,
      );
      if (densest.memberIds && densest.memberIds.length > 0) {
        targetIds = densest.memberIds;
      }
    }
  }
  // Fallback: frame the full bounding box.
  if (!targetIds && geometryPoints.length > 0) {
    targetIds = geometryPoints.map((p) => p.id);
  }
  const frameResult = await frameCameraHandler({
    shot: "hero",
    bookmark: "polish",
    targetEntityIds: targetIds,
  });
  summary.camera = frameResult.ok
    ? {
        shot: "hero",
        bookmark: "polish",
        framedCount: (frameResult.data as { framedCount?: number })?.framedCount ?? 0,
        position: (frameResult.data as { position?: Vec3 })?.position,
      }
    : { error: frameResult.error };
  if (geometryPoints.length === 0) {
    summary.camera = { skipped: "no geometry to frame" };
  }
  void bounds; // keep import used in case future tweaks need it

  // 5. Capture viewport — best effort; may fail in non-viewport contexts.
  const captureResult = await captureViewportHandler({});
  if (captureResult.ok) {
    summary.capture = {
      width: (captureResult.data as { width?: number })?.width,
      height: (captureResult.data as { height?: number })?.height,
      mimeType: "image/jpeg",
    };
    return {
      ok: true,
      data: {
        ...summary,
        // Bubble the screenshot up so polish_scene itself becomes a
        // multimodal turn — the model can immediately see what it did.
        __image: (captureResult.data as { __image?: unknown }).__image,
        url: (captureResult.data as { url?: string }).url,
      },
    };
  }
  summary.capture = { error: captureResult.error };
  return { ok: true, data: summary };
};

// ── Bundled exports ────────────────────────────────────────────────────
export const defs: ToolDef[] = [
  ARRANGE_ENTITIES,
  LIST_PALETTES,
  APPLY_PALETTE,
  LIST_LIGHTING_PRESETS,
  APPLY_LIGHTING_PRESET,
  FRAME_CAMERA,
  LIST_CAMERA_BOOKMARKS,
  RECALL_CAMERA_BOOKMARK,
  CAPTURE_VIEWPORT,
  POLISH_SCENE,
];

export const handlers: Record<string, ToolHandler> = {
  arrange_entities: arrangeEntitiesHandler,
  list_palettes: listPalettesHandler,
  apply_palette: applyPaletteHandler,
  list_lighting_presets: listLightingPresetsHandler,
  apply_lighting_preset: applyLightingPresetHandler,
  frame_camera: frameCameraHandler,
  list_camera_bookmarks: listCameraBookmarksHandler,
  recall_camera_bookmark: recallCameraBookmarkHandler,
  capture_viewport: captureViewportHandler,
  polish_scene: polishSceneHandler,
};

/** Tool names that mutate scene state — the aiClient confirms these with
 *  the user before running them. Camera framing, listing, screenshots, and
 *  bookmark recall are non-destructive so they don't appear here.
 *  Exported for symmetry with `tools/scripting`, `tools/layers`, `tools/systems`
 *  so `aiTools.ts` can spread destructive sets uniformly. */
export const destructiveToolNames: string[] = [
  "arrange_entities",
  "apply_palette",
  "apply_lighting_preset",
  "polish_scene",
];
