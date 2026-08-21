/**
 * Contextual best practices for Forge (three.js editor + docs aligned).
 * SSOT review: docs/THREEJS_EDITOR_PARITY.md
 */
export type BestPracticeContext =
  | "viewport"
  | "weapon"
  | "item"
  | "enemy"
  | "quest"
  | "model"
  | "texture"
  | "hdri"
  | "project-asset"
  | "scene"
  | "export"
  | "import"
  | "deploy"
  | "ai"
  | "devtools"
  | "physics"
  | "terrain"
  | "animation"
  | "controller"
  | "identity";

export type BestPractice = {
  title: string;
  detail: string;
  /** Optional deep link (three.js docs / manual / Forge docs). */
  href?: string;
  /**
   * active = current SSOT
   * deprecated = still shown with caution
   * purged = never return from getBestPractices (kept only in PURGED_PRACTICES log)
   */
  status?: "active" | "deprecated" | "purged";
  /** If this tip replaces an older one, name it for agents. */
  replaces?: string;
};

const BEST_PRACTICES: Record<BestPracticeContext, BestPractice[]> = {
  viewport: [
    {
      title: "Keep entity count under ~200 for 60 fps",
      detail:
        "Each entity adds a draw call and a physics body. Use prefabs and instancing for repeated objects (trees, props) instead of duplicating entities.",
    },
    {
      title: "Bake static lights — point lights are expensive",
      detail:
        "Use one directional sun + a few point lights for hero objects. Disable shadow casting on small props. Matches three.js lighting cost guidance.",
      href: "https://threejs.org/manual/en/lights.html",
    },
    {
      title: "sRGB color space on the renderer",
      detail:
        "WebGLRenderer.outputColorSpace must be SRGBColorSpace; color textures use SRGBColorSpace. Linear workflows without this look washed or too dark.",
      href: "https://threejs.org/docs/#manual/en/introduction/Color-management",
    },
    {
      title: "Use the editor camera in play mode for debugging",
      detail:
        "Set Play-Mode Camera to 'Editor (orbit)' in the Inspector to fly around while gameplay runs — great for inspecting physics issues.",
    },
    {
      title: "P toggles play, Esc stops, Space is yours (jump)",
      detail:
        "The editor never binds Space, so user scripts can use it as the jump key. Use F to focus selection, W/E/R to switch translate/rotate/scale gizmos (same as three.js editor).",
    },
    {
      title: "Resize updates aspect + setSize",
      detail:
        "On window/container resize, update camera.aspect, updateProjectionMatrix(), and renderer.setSize — classic three.js responsive pattern.",
      href: "https://threejs.org/manual/en/responsive.html",
    },
  ],
  scene: [
    {
      title: "Edits go through the command stack",
      detail:
        "Like three.js editor History: every user/AI mutation should CommandStack.push so undo/redo works. Avoid silent setState for scene mutations.",
      href: "https://github.com/mrdoob/three.js/tree/master/editor",
    },
    {
      title: ".gfscene.json is the game SSOT",
      detail:
        "Forge scenes are entity graphs (physics, scripts, layers), not raw Object3D trees. Use three.js Editor JSON only for interop exports.",
    },
    {
      title: "SI units — 1 unit = 1 metre",
      detail:
        "Humanoid height ~1.8 m. Scale props relative to the human yardstick; never fit weapons to 1.8 m height.",
    },
    {
      title: "One hierarchy, clear names",
      detail:
        "PascalCase entity names; keep empties as locators; expose GLB children as proxies instead of duplicating meshes.",
    },
  ],
  import: [
    {
      title: "Canonical mesh is meshopt GLB",
      detail:
        "Drop FBX/OBJ/STL/glTF/ZIP — AssetDropZone converts via three-stdlib + GLTFExporter + gltf-transform meshopt. Production kits live on R2.",
      href: "https://threejs.org/docs/#examples/en/exporters/GLTFExporter",
    },
    {
      title: "ZIP OBJ needs MTL + textures together",
      detail:
        "Pack .obj + .mtl + maps in one ZIP so the converter can resolve relative texture paths via LoadingManager blob URLs.",
    },
    {
      title: "Validate bad GLBs before debugging Forge",
      detail:
        "Use the Khronos glTF Validator when import fails mysteriously — often the file, not the editor.",
      href: "https://github.khronos.org/glTF-Validator/",
    },
    {
      title: "Import .gfscene.json for full scenes",
      detail:
        "Scene JSON replaces the live scene graph. Prefer GitHub sync or File open for multi-file projects.",
    },
  ],
  export: [
    {
      title: "Embed images in GLB for CDN",
      detail:
        "GLTFExporter binary + embedImages avoids broken external texture URLs after publish.",
    },
    {
      title: "Pass animations explicitly when exporting clones",
      detail:
        "SkeletonUtils.clone + export: pass animations:[] options — exporter does not auto-discover detached clips.",
    },
    {
      title: "Strip helpers before bake",
      detail:
        "Grid, gizmos, SkeletonHelper, and debug colliders must not ship in production GLBs.",
    },
    {
      title: "Write .meta.json sidecars",
      detail:
        "Library needs triangle/bone/clip counts without re-parsing the binary every time.",
    },
  ],
  deploy: [
    {
      title: "Assign a PublishChannel — never vague “publish”",
      detail:
        "Use forge_api_save + r2_user_assets for durable editor work; puter_host/player_embed for L7 playtest; fleet_satellite for real games. See gameDeployments.ts / docs/GAME_DEPLOYMENT_DEFINITIONS.md.",
      replaces: "bundle_in_spa / vague publish",
    },
    {
      title: "Forge API ≠ Railway player SSOT",
      detail:
        "Forge /api/projects|scenes saves editor control-plane data. Characters/bag/island write Railway grudge-api (L-PLAYER). Do not mix.",
    },
    {
      title: "Build SPA on ≥16 GB RAM",
      detail:
        "Vercel 8 GB containers OOM on R3F+Monaco+Rapier. Use scripts/build-spa.sh then origin + CF Worker (DEPLOYMENT.md).",
    },
    {
      title: "No Replit object paths (purged host)",
      detail:
        "replit.app /api/storage/objects/ is dead. Re-upload via Forge R2 (r2_user_assets).",
      replaces: "replit storage",
    },
    {
      title: "Scenes must reference durable URLs",
      detail:
        "builtin: and assets.grudge-studio.com (or /api/storage object paths) only — never blob: or localhost in saved scenes.",
    },
    {
      title: "Smoke after deploy",
      detail:
        "Run scripts/smoke-forge-prod.mjs / probe-live-forge.mjs against forge.grudge-studio.com. Games: verify /api/health + CDN HEAD.",
    },
    {
      title: "Live multiplayer uses L2–L4 — not Vercel alone for WS",
      detail:
        "WebSockets need co-located process (L2), CF edge proxy (L3), or dedicated Railway room (L4). Vercel rewrites cannot upgrade WS.",
    },
  ],
  ai: [
    {
      title: "AI tools are undoable turns",
      detail:
        "Each mutating tool snapshots scene before/after and pushes makeAITurnCommand — same undo stack as human edits.",
    },
    {
      title: "Diagnose + verify before mass rewrite",
      detail:
        "diagnose_scene → verify_scene_full (scale/textures/anim/terrain) → auto_fix_scene → re-verify. list_threejs_standards for SSOT.",
    },
    {
      title: "Confirm destructive tools",
      detail:
        "Clear scene, mass delete, and rewrites need explicit user confirmation (DESTRUCTIVE_TOOLS).",
    },
    {
      title: "Prefer design tools for lighting/camera",
      detail:
        "Use ai/tools/design (lighting, camera, layouts, palette) instead of inventing raw entity spam.",
    },
    {
      title: "Sub-agents = free-ai D1 jobs + Legion roles",
      detail:
        "create_agent_job for edge work; Grudge AI roles (dev/toolkit) via free-ai. SPA redeploy via GHA only — not ad-hoc worker invent.",
    },
  ],
  devtools: [
    {
      title: "Install three.js Developer Tools",
      detail:
        "Chrome extension + Forge __THREE_DEVTOOLS__ bridge (lib/threeDevtools.ts). Observe each viewport scene/renderer on mount.",
      href: "https://github.com/threejs/devtools",
    },
    {
      title: "Helpers like three.js View menu",
      detail:
        "Toggle grid, light helpers, skeleton helpers, and camera helpers when debugging transforms and skinned meshes.",
    },
    {
      title: "History labels must be readable",
      detail:
        "Command.label shows in undo UI — AI and gizmos should set clear names (Move Box_01, Assign material cloth).",
    },
  ],
  physics: [
    {
      title: "Rapier layers — one matrix",
      detail:
        "Use the Forge layer matrix (Default/Terrain/Player/NPC/Item/Projectile/Trigger/Water). Don't invent ad-hoc collision groups.",
    },
    {
      title: "Static world = fixed bodies",
      detail:
        "Terrain and buildings should be fixed; only interactive props dynamic. Prefer convex-decomp for non-convex dynamics.",
    },
    {
      title: "CCD for fast projectiles",
      detail:
        "Enable continuous collision detection on thin/fast colliders to prevent tunneling.",
    },
    {
      title: "Characters = kinematic CCT + capsule",
      detail:
        "set_physics bodyType=kinematicPosition with capsuleHalfHeight≈0.9 and capsuleRadius≈0.3 (SI). Do not free-dynamic player bodies.",
    },
  ],
  terrain: [
    {
      title: "Fixed ground for raycasts and feet",
      detail:
        "Plane / heightfield / trimesh as fixed; layer=Terrain; surface=Walk. Foot IK and body ground share the same height field.",
    },
    {
      title: "Raycast down for grounding",
      detail:
        "Cast Rapier rays from character root (+εY) against terrain. Prefer world.castRay / CCT grounded over mesh AABB for feet.",
    },
    {
      title: "Instanced scatter for forests",
      detail:
        "Trees/props: InstancedMesh + LOD from biome kits — never one Mesh entity per tree at island scale.",
    },
  ],
  animation: [
    {
      title: "One mixer; Bip001 packs",
      detail:
        "list_animations → apply_animation. grudge6 uses Bip001 packs (sword_shield, longbow, magic). Never two mixers on one skeleton.",
    },
    {
      title: "Strip position tracks when grounded",
      detail:
        "Retarget rotation-only onto grounded kits to prevent hip-float. Re-ground after first anim sample.",
    },
    {
      title: "No Mixamo on Bip001",
      detail:
        "mixamorig tracks fail rematch on Toon RTS kits — use baked Bip001 weapon packs.",
    },
  ],
  controller: [
    {
      title: "Play player is Rapier CCT, not a dynamic capsule",
      detail:
        "kinematicPosition + capsule (r 0.32, halfH 0.58). Autostep / snap / push boxes. Space jump. Feet/LOS: world.castRay (unit dir, maxToi=m). Melee/landing/wheels: castShape. Knockback + contactForce + ragdoll death clip. Do not setLinvel a dynamic player.",
    },
    {
      title: "One player controller per scene",
      detail:
        "diagnose_scene flags multiple controllerKind entities. Play camera sole writer = follow/TPS.",
    },
    {
      title: "Map open keeps the same controller session",
      detail:
        "Rebind terrain height only — keep weapon skills, controller, view mode (fleet law).",
    },
  ],
  identity: [
    {
      title: "Grudge ID is fleet account; Puter is cloud shell",
      detail:
        "Sign in via id.grudge-studio.com/login?redirect_uri=. Dual-write grudge.open.token + fleet keys. Puter never sole bag SSOT.",
    },
    {
      title: "Never /auth/popup",
      detail:
        "That path 404s. Use /login with redirect_uri, origin, handoff=1. Prefer sso_token over short grudge_token.",
    },
  ],
  weapon: [
    {
      title: "Tier scales damage AND drop rarity",
      detail:
        "T1 = common, T5 = legendary. Keep tier-1 base damage 5–10, tier-5 base damage 60–120. Avoid placing T4+ weapons on starter prefabs.",
    },
    {
      title: "Pair on-hit effects with a cooldown",
      detail:
        "Effects like burn / freeze / knockback should have a per-target cooldown, otherwise they stunlock — bad UX. 0.5–1.0 s is the usual range.",
    },
    {
      title: "Spawn weapons as pickups, not as entity children",
      detail:
        "Use the Items tab for inventory-style pickups; use Weapons only for the held/equipped slot of an enemy or player prefab.",
    },
  ],
  item: [
    {
      title: "Stackable items need a stack cap",
      detail:
        "Set max stack size in the inspector. Potions usually 5–20, materials 99, key items 1.",
    },
    {
      title: "Tier 3+ items should NOT spawn in starter zones",
      detail:
        "Gate higher-tier loot behind boss kills or quest completions to preserve progression.",
    },
  ],
  enemy: [
    {
      title: "Enemies need a spawn point, not raw entity placement",
      detail:
        "Use a SpawnPoint prefab so enemies respawn after death or zone reload. Direct entity placement only respawns on full project reload.",
    },
    {
      title: "Balance HP vs damage by tier",
      detail:
        "T1 enemy: 30 HP, 5 dmg. T5 boss: 1500 HP, 60 dmg. Keep TTK (time-to-kill) around 4–8 s for melee, 2–4 s for ranged.",
    },
    {
      title: "Add a Player tag to whatever the enemy AI should chase",
      detail:
        "AI scripts use the 'player' tag to find targets. The starter Blake prefab sets this automatically; custom heroes need it set in the Inspector.",
    },
  ],
  quest: [
    {
      title: "Quests need both a giver and a turn-in entity",
      detail:
        "Even the same NPC can do both, but the script needs explicit start/complete IDs — don't rely on 'first NPC found'.",
    },
    {
      title: "Reward XP scales with player level, not quest tier",
      detail:
        "Use the catalogue's xpReward as a multiplier of (player_level + 1). Hard-coding XP makes late-game quests feel useless.",
    },
  ],
  model: [
    {
      title: "Use builtin: URLs for starter models — they get cached",
      detail:
        "Models prefixed builtin:* are warmed up by the asset preloader and cached across scene reloads. External glTF URLs re-fetch every time.",
    },
    {
      title: "Check the polygon count before spawning many copies",
      detail:
        "A 50k-poly hero model is fine once; spawning 30 of them tanks the framerate. For prop counts > 10, prefer LOD or instancing.",
    },
    {
      title: "Embed textures in the .glb when possible",
      detail:
        "External texture references mean an extra HTTP round-trip per material. Re-export from Blender with 'Embed images' for single-file delivery.",
    },
    {
      title: "Center the pivot in your modelling tool",
      detail:
        "If your model spawns offset from its position, the pivot wasn't at origin in Blender. Apply transforms before exporting.",
    },
  ],
  texture: [
    {
      title: "Pair albedo + normal + roughness for PBR",
      detail:
        "A single colour map looks flat. Import all three from the Poly Haven texture and assign them in the Inspector's material section.",
    },
    {
      title: "1K is enough for most surfaces",
      detail:
        "2K only when the texture covers a hero asset on screen. 4K textures are 16x the memory of 1K and rarely worth it for in-game props.",
    },
    {
      title: "Use UV repeat for tileable surfaces",
      detail:
        "Brick, wood, ground textures should tile (set UV repeat 4×4 or 8×8 on a plane). Don't stretch a single 1K image across a 100m floor.",
    },
    {
      title: "Poly Haven shader presets keep one art look",
      detail:
        "Inspector → Poly Haven shader applies the same CC0 PBR set (diffuse + GL normal + rough + AO + height). WebGL = MeshPhysical. WebGPU = MeshStandardNodeMaterial (TSL). Do not mix random atlas packs on the same prop.",
    },
  ],
  hdri: [
    {
      title: "1K HDRIs are fine for environment lighting",
      detail:
        "The HDRI provides indirect light + reflections. 4K is only useful when the sky is visible and high-res is part of the look.",
    },
    {
      title: "Lower the Ambient slider when an HDRI is active",
      detail:
        "HDRIs already provide ambient. Set Ambient to 0.1–0.2 in the Environment panel to avoid washed-out shadows.",
    },
    {
      title: "Match HDRI mood to gameplay",
      detail:
        "Sunset/night HDRIs feel atmospheric but kill visibility. Use noon / overcast for combat zones, dusk for hub areas.",
    },
  ],
  "project-asset": [
    {
      title: "Store meshes on R2 — not inside the SPA bundle",
      detail:
        "Upload via Asset Drop / R2 (user-assets/<projectId>/…). Scenes reference CDN or /api/storage paths. PURGED: shipping production GLBs inside Vite dist.",
      replaces: "Project assets are bundled into the published build",
    },
    {
      title: "Delete unused R2 assets to cut cost",
      detail:
        "Remove unused .glb / textures from the project library so player downloads and R2 storage stay small — not because they are Vite-bundled.",
    },
    {
      title: "Re-host third-party glTFs on assets.grudge-studio.com or project R2",
      detail:
        "External CDNs go down. Prefer fleet CDN or Upload File so published scenes keep resolving.",
    },
    {
      title: "Always write .meta.json sidecars for 3D uploads",
      detail:
        "Library and AI tools need triangle/bone/clip counts without re-parsing every GLB.",
    },
  ],
};

/** Explicitly purged tips (never returned) — for audit / AI “what not to do”. */
export const PURGED_PRACTICES: Array<{
  was: string;
  reason: string;
  replaceWith: string;
}> = [
  {
    was: "Project assets are bundled into the published build",
    reason: "Fleet L0/L-BIN: binaries live on R2 CDN, not Vite dist",
    replaceWith: "Store meshes on R2 — not inside the SPA bundle",
  },
  {
    was: "Use api.grudge-studio.com as character SSOT",
    reason: "Old CF tunnel purged; Railway same-origin /api/* is L-PLAYER",
    replaceWith: "Forge API ≠ Railway player SSOT",
  },
  {
    was: "Replit object storage for models",
    reason: "Origin dead; scene.bin loads fail",
    replaceWith: "No Replit object paths (purged host)",
  },
  {
    was: "batch_generate = fleet deploy",
    reason: "batch_generate is content fill only",
    replaceWith: "Assign a PublishChannel — never vague publish",
  },
];

export function getBestPractices(ctx: BestPracticeContext): BestPractice[] {
  return (BEST_PRACTICES[ctx] ?? []).filter((t) => t.status !== "purged");
}

/** All contexts that have tips (for Help menu / AI knowledge). */
export function listBestPracticeContexts(): BestPracticeContext[] {
  return Object.keys(BEST_PRACTICES) as BestPracticeContext[];
}

/** Flat list for AI system prompts / knowledge tools (active only). */
export function allBestPracticesFlat(): Array<BestPractice & { context: BestPracticeContext }> {
  const out: Array<BestPractice & { context: BestPracticeContext }> = [];
  for (const ctx of listBestPracticeContexts()) {
    for (const tip of getBestPractices(ctx)) {
      out.push({ ...tip, context: ctx });
    }
  }
  return out;
}

/** Map UI surfaces → practice contexts (correct assignment). */
export const CONTEXT_ASSIGNMENT: Record<string, BestPracticeContext[]> = {
  hierarchy: ["scene"],
  inspector: ["scene", "physics", "model"],
  viewport: ["viewport", "devtools", "physics"],
  asset_browser_model: ["model", "import", "project-asset"],
  asset_browser_texture: ["texture", "project-asset"],
  asset_browser_weapon: ["weapon"],
  asset_browser_item: ["item"],
  asset_browser_enemy: ["enemy"],
  asset_browser_quest: ["quest"],
  drop_zone: ["import", "project-asset"],
  publish_dialog: ["deploy", "export", "project-asset"],
  ai_worker: ["ai", "scene", "deploy"],
  menu_file: ["export", "import", "deploy"],
};

export function practicesForUiSurface(surface: string): BestPractice[] {
  const ctxs = CONTEXT_ASSIGNMENT[surface] ?? [];
  const seen = new Set<string>();
  const out: BestPractice[] = [];
  for (const c of ctxs) {
    for (const tip of getBestPractices(c)) {
      if (seen.has(tip.title)) continue;
      seen.add(tip.title);
      out.push(tip);
    }
  }
  return out;
}
