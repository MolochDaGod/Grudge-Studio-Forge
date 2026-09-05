/**
 * Domain knowledge packs injected into the orchestrator system prompt.
 * Keep each pack short; orchestrator loads at most 2 extras per turn (+ core).
 * SSOT: lib/ai/threeStandards.ts + grudge-character-correctness / threejs skills.
 */
import type { ForgeIntent } from "./intent";

export type KnowledgePackId =
  | "three-r185"
  | "r3f-viewport"
  | "rapier"
  | "terrain-raycast"
  | "navmesh"
  | "gltf-import"
  | "character-anim"
  | "textures-materials"
  | "vfx"
  | "scripts-js"
  | "blazor-hybrid"
  | "deploy-forge"
  | "fleet-assets"
  | "identity-account"
  | "verify-qa"
  | "core";

const PACKS: Record<KnowledgePackId, string> = {
  core: [
    "CORE:",
    "- SI units: 1 unit = 1 m; human ~1.8 m. Never ship 100× giants.",
    "- All scene edits via tools (CommandStack). Prefer list_fast_assets → spawn_fast_asset.",
    "- Models: only builtin:<key> or https://assets.grudge-studio.com/… — never invent CDN paths.",
    "- Before claiming done: diagnose_scene → verify_mesh_scale → verify_textures → verify_character_animation.",
    "- Identity: Grudge ID = fleet JWT; Puter = cloud only; guest = local.",
    "- list_threejs_standards({ topic }) for terrain/rapier/anim/identity/redeploy.",
  ].join("\n"),

  "three-r185": [
    "THREE.js r185+:",
    "- outputColorSpace = SRGBColorSpace; color textures SRGB; data maps NoColorSpace.",
    "- Dispose geometries/materials/textures on remove. No hot-loop alloc.",
    "- Y-up; ground XZ. Instancing for repeated props.",
    "- Docs: threejs.org manual Color-management + responsive.",
  ].join("\n"),

  "r3f-viewport": [
    "R3F / viewport:",
    "- One OrbitControls in edit; never two camera controllers.",
    "- Play: third-person/follow is sole camera writer — not Orbit during combat.",
    "- Transform gizmo must not permanently kill orbit pan/zoom.",
  ].join("\n"),

  rapier: [
    "RAPIER:",
    "- Only Rapier (no Cannon on same body). Fixed 1/60.",
    "- Layers: Default/Terrain/Player/NPC/Item/Projectile/Trigger/Water.",
    "- Static = fixed; props = dynamic; characters = kinematic CCT + capsule.",
    "- set_physics: bodyType, colliderType, ccd, capsuleHalfHeight/Radius.",
    "- CCD for projectiles; never setTranslation fight dynamics every frame.",
  ].join("\n"),

  "terrain-raycast": [
    "TERRAIN + RAYCAST:",
    "- Ground = fixed plane/heightfield/trimesh; layer=Terrain; surface=Walk.",
    "- Worlds: create_world({ recipe, replace:true }) replaces terrain/trees/rocks/paths (keeps player). layers=['foliage','path'] restamps only those. paint_world_brush({ channel, replace:true }). Super Terrain = heightfield bake, not the WebGPU editor.",
    "- Foliage/rocks = Kenney singles (CommonTree_N, Pine_N, Rock_Medium_N). Never nature_vegetation.glb / *-pack / pirate-islands scene as one tree. ore_nodes needs meshName isolation — do not drop the whole file. Torches warm decay-2.",
    "- CCT/feet: castRay down from root; same height field for body + foot IK.",
    "- Rapier castRay/shapeCast for physics; three-mesh-bvh for pure mesh queries.",
    "- Aim ray: camera/center-screen for ranged — not editor orbit.",
  ].join("\n"),

  navmesh: [
    "NAVMESH:",
    "- Bake from walkable surfaces; agents use path tools.",
    "- Climb/Swim via surface tags. Persist bake when possible.",
  ].join("\n"),

  "gltf-import": [
    "glTF / import:",
    "- Production = meshopt GLB on R2. HTML-as-GLB = hard fail.",
    "- Prefer Fast / fleet search. SI scale on import. Strip helpers before bake.",
  ].join("\n"),

  "character-anim": [
    "CHARACTERS + ANIM LIBRARY:",
    "- Play heroes: grudge6 Toon RTS GLB only — no Meshy/capsule.",
    "- ONE AnimationMixer; Bip001 packs (sword_shield/longbow/magic/…).",
    "- strip position tracks; rematch bones; no mixamorig on Bip001.",
    "- list_animations → apply_animation(idle/walk/run/attack). Re-ground after sample.",
    "- Feet from skinned min.y — never pelvis. Height band ~1.45–2.2 m.",
    "- NEVER fit weapons to 1.8 m human height.",
  ].join("\n"),

  "textures-materials": [
    "TEXTURES:",
    "- sRGB color maps; verify no 1×1/placeholder; fleet CDN only.",
    "- set_material_map / generate_texture; race atlases flipY=false typically.",
    "- verify_textures tool after material work.",
  ].join("\n"),

  vfx: [
    "VFX:",
    "- Catalog effects tools; SI metres; dispose GPU resources.",
    "- Do not load whole fireball scenes for orbs.",
  ].join("\n"),

  "scripts-js": [
    "SCRIPTS:",
    "- exports.start(entity, ctx) / exports.update(entity, ctx).",
    "- WASD / third-person / NetworkManager templates preferred.",
  ].join("\n"),

  "blazor-hybrid": [
    "BLazor hybrid C#:",
    "- Only // @forge-runtime packs. No animations/network authority in C#.",
  ].join("\n"),

  "deploy-forge": [
    "REDEPLOY:",
    "- SPA: GHA Deploy Forge SPA → Vercel prebuilt → edge gameforge-web.",
    "- free-ai worker: wrangler in workers/forge-free-ai (GRUDGE_AI_KEY secret).",
    "- Legion: grudge-legion-ai + grudge-ai-hub both. Smoke free-ai/status + editor.",
    "- Agent D1 jobs ≠ player bag. Intentional single-intent deploys.",
    "- list_game_deployments / list_forge_best_practices. No force-push main.",
  ].join("\n"),

  "fleet-assets": [
    "FLEET ASSETS:",
    "- list_fast_assets → spawn_fast_asset; search_fleet_assets → spawn_fleet_asset.",
    "- grudge6 kits builtin:grudge6:* / race:*. No invented r2 keys.",
  ].join("\n"),

  "identity-account": [
    "ACCOUNT / ID:",
    "- Grudge ID login: id.grudge-studio.com/login?redirect_uri= (not /auth/popup).",
    "- JWT dual-write grudge.open.token + fleet keys; prefer sso_token handoff.",
    "- Puter = cloud projects only; Railway = bag/characters/wallet.",
    "- Email/Discord/wallet → same grudge_id. Guest has no Railway bag.",
  ].join("\n"),

  "verify-qa": [
    "VERIFY / QA:",
    "- verify_mesh_scale, verify_textures, verify_character_animation, verify_terrain_physics.",
    "- diagnose_scene (includes verification rules) → auto_fix_scene → re-diagnose.",
    "- Red = 100× scale, placeholder hosts, missing ground, Mixamo on Bip001.",
  ].join("\n"),
};

/** Which packs attach for an intent (always includes core). Max 2 extra. */
export function packsForIntent(intent: ForgeIntent): KnowledgePackId[] {
  const extra: KnowledgePackId[] = (() => {
    switch (intent) {
      case "scene":
        return ["fleet-assets", "terrain-raycast"];
      case "model":
        return ["character-anim", "fleet-assets"];
      case "physics":
        return ["rapier", "terrain-raycast"];
      case "nav":
        return ["navmesh", "terrain-raycast"];
      case "vfx":
        return ["vfx", "three-r185"];
      case "script":
        return ["scripts-js", "character-anim"];
      case "materials":
        return ["textures-materials", "three-r185"];
      case "design":
        return ["three-r185", "r3f-viewport"];
      case "diagnose":
        return ["verify-qa", "character-anim"];
      case "deploy":
        return ["deploy-forge", "identity-account"];
      case "identity":
        return ["identity-account", "deploy-forge"];
      case "character":
        return ["character-anim", "verify-qa"];
      case "terrain":
        return ["terrain-raycast", "rapier"];
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
 * Tool name allowlist per intent.
 * Empty/null means all tools (general).
 */
export function toolNameAllowlist(intent: ForgeIntent): string[] | null {
  switch (intent) {
    case "deploy":
      return [
        "list_game_deployments",
        "list_forge_best_practices",
        "list_threejs_standards",
        "get_scene_summary",
        "list_entities",
        "agent_stack_status",
        "diagnose_scene",
        "verify_mesh_scale",
        "verify_textures",
        "verify_character_animation",
        "verify_terrain_physics",
      ];
    case "diagnose":
    case "character":
      return [
        "diagnose_scene",
        "auto_fix_scene",
        "verify_mesh_scale",
        "verify_textures",
        "verify_character_animation",
        "verify_terrain_physics",
        "list_threejs_standards",
        "get_scene_summary",
        "list_entities",
        "list_fast_assets",
        "spawn_fast_asset",
        "list_animations",
        "apply_animation",
        "set_physics",
        "list_forge_best_practices",
      ];
    case "identity":
      return [
        "list_threejs_standards",
        "list_forge_best_practices",
        "agent_stack_status",
        "list_game_deployments",
        "get_scene_summary",
      ];
    case "terrain":
      return null;
    case "nav":
      return null;
    default:
      return null;
  }
}
