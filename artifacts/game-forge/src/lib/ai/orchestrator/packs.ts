/**
 * Domain knowledge packs injected into the orchestrator system prompt.
 * Keep each pack short; orchestrator loads at most 2 per turn.
 */
import type { ForgeIntent } from "./intent";

export type KnowledgePackId =
  | "three-r185"
  | "r3f-viewport"
  | "rapier"
  | "navmesh"
  | "gltf-import"
  | "vfx"
  | "scripts-js"
  | "blazor-hybrid"
  | "deploy-forge"
  | "fleet-assets"
  | "core";

const PACKS: Record<KnowledgePackId, string> = {
  core: [
    "CORE:",
    "- SI units: 1 unit = 1 m; human ~1.8 m.",
    "- All scene edits via tools (CommandStack). Prefer list_fast_assets → spawn_fast_asset.",
    "- Models: only builtin:<key> or https://assets.grudge-studio.com/… — never invent CDN paths.",
    "- Never use Replit/localhost/blob as durable scene URLs.",
    "- After multi-step work, summarize changes; use diagnose_scene when unsure.",
  ].join("\n"),

  "three-r185": [
    "THREE.js r185:",
    "- renderer outputColorSpace = SRGBColorSpace; color textures SRGB.",
    "- Dispose geometries/materials/textures on remove.",
    "- No hot-loop alloc; reuse vectors; prefer instancing for repeats.",
    "- Docs: https://threejs.org/manual/en/introduction/Color-management",
  ].join("\n"),

  "r3f-viewport": [
    "R3F / viewport:",
    "- One OrbitControls (makeDefault); never two camera controllers at once.",
    "- Transform gizmo must not permanently disable orbit (pan/zoom stay free).",
    "- Play mode unmounts editor orbit; use cameraMode for play cameras.",
  ].join("\n"),

  rapier: [
    "RAPIER:",
    "- Only Rapier physics (no Cannon on same body). Fixed 1/60.",
    "- Layers: Default/Terrain/Player/NPC/Item/Projectile/Trigger/Water.",
    "- Prefer explicit colliders; bake convex for complex meshes when needed.",
    "- Kinematic CCT for characters; do not setTranslation every frame on dynamics.",
  ].join("\n"),

  navmesh: [
    "NAVMESH:",
    "- Bake from walkable surfaces; persist when possible.",
    "- Agents use path tools; do not hardcode waypoints without bake.",
    "- Climb/swim surfaces via surface tags.",
  ].join("\n"),

  "gltf-import": [
    "glTF / import:",
    "- Production mesh = meshopt GLB on R2. HTML-as-GLB is a hard failure.",
    "- Prefer Fast assets / fleet search over inventing URLs.",
    "- Hierarchy: preserve parent/child; materials with textures; SI scale.",
  ].join("\n"),

  vfx: [
    "VFX:",
    "- Use catalog VFX / effects tools; do not load whole fireball scenes for orbs.",
    "- Scale in meters; dispose GPU resources.",
  ].join("\n"),

  "scripts-js": [
    "SCRIPTS:",
    "- JS: exports.start(entity, ctx) / exports.update(entity, ctx).",
    "- Prefer smart templates (WASD, third-person, NetworkManager).",
    "- Do not put core engine systems in user scripts.",
  ].join("\n"),

  "blazor-hybrid": [
    "BLazor / hybrid C#:",
    "- Only via // @forge-runtime: blazor + pack directives (Spin/Bob/Strafe).",
    "- No animations, island gen, or network authority in C#.",
    "- See docs/HYBRID_CSHARP.md.",
  ].join("\n"),

  "deploy-forge": [
    "DEPLOY (Forge):",
    "- SPA: GHA Deploy Forge SPA → Vercel prebuilt → grudge-gameforge-web.",
    "- Workers: cd workers/gameforge-web | forge-free-ai → wrangler deploy.",
    "- Smoke: node scripts/smoke-forge-prod.mjs (12 checks).",
    "- list_game_deployments / list_forge_best_practices for SSOT. No force-push main.",
  ].join("\n"),

  "fleet-assets": [
    "FLEET ASSETS:",
    "- list_fast_assets → spawn_fast_asset preferred.",
    "- search_fleet_assets → spawn_fleet_asset(cdnUrl) for full registry.",
    "- grudge6 kits: builtin:grudge6:* or race:*. No Meshy/capsule heroes.",
  ].join("\n"),
};

/** Which packs attach for an intent (always includes core). Max 2 extra. */
export function packsForIntent(intent: ForgeIntent): KnowledgePackId[] {
  const extra: KnowledgePackId[] = (() => {
    switch (intent) {
      case "scene":
        return ["fleet-assets", "three-r185"];
      case "model":
        return ["fleet-assets", "gltf-import"];
      case "physics":
        return ["rapier", "r3f-viewport"];
      case "nav":
        return ["navmesh", "rapier"];
      case "vfx":
        return ["vfx", "three-r185"];
      case "script":
        return ["scripts-js", "blazor-hybrid"];
      case "materials":
        return ["three-r185", "gltf-import"];
      case "design":
        return ["three-r185", "r3f-viewport"];
      case "diagnose":
        return ["r3f-viewport", "rapier"];
      case "deploy":
        return ["deploy-forge", "fleet-assets"];
      default:
        return ["fleet-assets", "three-r185"];
    }
  })();
  return ["core", ...extra.slice(0, 2)];
}

export function renderPacks(ids: KnowledgePackId[]): string {
  return ids.map((id) => PACKS[id]).filter(Boolean).join("\n\n");
}

/**
 * Tool name prefixes / exact names allowed per intent.
 * Empty list means "all tools" (general).
 */
export function toolNameAllowlist(intent: ForgeIntent): string[] | null {
  switch (intent) {
    case "deploy":
      return [
        "list_game_deployments",
        "list_forge_best_practices",
        "get_scene_summary",
        "list_entities",
        "agent_stack_status",
        "diagnose_scene",
      ];
    case "diagnose":
      return [
        "diagnose_scene",
        "auto_fix_scene",
        "get_scene_summary",
        "list_entities",
        "list_fast_assets",
        "spawn_fast_asset",
        "list_forge_best_practices",
      ];
    case "nav":
      return null; // nav tools + systems — full set safer until tagged
    default:
      return null;
  }
}
