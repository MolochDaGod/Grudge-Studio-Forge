/**
 * Condensed Three.js / Rapier / character standards for Forge AI Worker.
 * Sourced from fleet skills (threejs-*, grudge-rapier, grudge-character-correctness).
 * Used by list_threejs_standards tool + knowledge packs.
 */

export type StandardsTopic =
  | "all"
  | "terrain"
  | "textures"
  | "rapier"
  | "raycast"
  | "controller"
  | "animation"
  | "character"
  | "identity"
  | "redeploy";

const SECTIONS: Record<Exclude<StandardsTopic, "all">, string[]> = {
  terrain: [
    "TERRAIN (SI metres, Y-up):",
    "- Walkable ground = fixed Rapier body (plane, heightfield, or trimesh mesh).",
    "- layer=Terrain · surface=Walk for nav + feet. Water = Water layer / Swim.",
    "- Scatter trees as InstancedMesh + LOD — never 1 Mesh per tree at scale.",
    "- Foot IK + body ground from the SAME height field / raycast down.",
    "- Helpers (Grid/Axes/Rapier debug) only in edit — strip before publish.",
  ],
  textures: [
    "TEXTURES / MATERIALS:",
    "- Renderer outputColorSpace = SRGBColorSpace; color maps = SRGB; data maps = NoColorSpace.",
    "- flipY=false for most GLB/FBX atlases; ClampToEdge for race kits.",
    "- 1×1 / missing maps → yellow sludge — rebind atlas or re-bake (grudge-asset-convert).",
    "- Durable URLs only: builtin: or https://assets.grudge-studio.com — never blob/localhost/Replit.",
    "- set_material_map / generate_texture for albedo; dispose maps on entity remove.",
  ],
  rapier: [
    "RAPIER PHYSICS:",
    "- One physics engine only (Rapier). Fixed timestep 1/60.",
    "- Layers: Default / Terrain / Player / NPC / Item / Projectile / Trigger / Water.",
    "- Static world = fixed; interactive props = dynamic; characters = kinematic CCT.",
    "- Colliders: cuboid/ball/cylinder/trimesh/convex-decomp; CCD for fast projectiles.",
    "- set_physics tool for bodyType/collider/mass/friction/ccd/capsuleHalfHeight.",
  ],
  raycast: [
    "RAYCASTING:",
    "- Ground: cast down from character root (+ small Y) against Terrain/Default fixed colliders.",
    "- Aim: center-screen / camera forward ray for staff/rifle (not OrbitControls during combat).",
    "- Prefer Rapier world.castRay / shapeCast for physics; three-mesh-bvh for pure mesh queries.",
    "- Never use only mesh AABB for feet — skinned feet min.y after skeleton update.",
  ],
  controller: [
    "RAPIER CHARACTER CONTROLLER (CCT):",
    "- KinematicPosition body + capsule (~ halfHeight 0.9 m, radius 0.3 m for human).",
    "- Desired translation each frame; slide/autostep via CCT — do not setTranslation fight dynamics.",
    "- One controller per scene (diagnose multiple-players).",
    "- Play mode: sole camera writer = third-person/follow — not OrbitControls.",
    "- Map open: keep controller + weapon + skills; rebind terrain sampler only.",
  ],
  animation: [
    "ANIMATION LIBRARY (characters / AI / players):",
    "- ONE AnimationMixer per skeleton. Never two mixers on the same body.",
    "- grudge6 / Toon play: Bip001 bone packs (sword_shield, longbow, magic, rifle…).",
    "- strip position tracks when retargeting onto grounded kits (prevent hip-float).",
    "- Bones-only rematch; never mixamorig* on Bip001 kits.",
    "- apply_animation({ clip:'idle'|'walk'|'run'|'attack'|'death' }) + list_animations.",
    "- Attack = one-shot overlay; re-ground feet after first sample.",
    "- 30characters.glb = outline/look ref only — not play body SSOT.",
  ],
  character: [
    "CHARACTER MESH / SIZE:",
    "- SI: 1 unit = 1 m; human ~1.8 m; hero band ~1.45–2.2 m.",
    "- Play mesh: Toon RTS grudge6 GLB races only — no Meshy/capsule heroes.",
    "- Ground from skinned body feet min.y — never pelvis-as-feet.",
    "- Face: Toon play yaw 0 (+Z); π/2 only for +X FBX author kits — no double-yaw.",
    "- NEVER fit weapons/arrows to 1.8 m human height.",
    "- verify_mesh_scale + verify_textures + verify_character_animation before deploy.",
  ],
  identity: [
    "IDENTITY (login planes):",
    "- Grudge ID (id.grudge-studio.com) = fleet JWT · Railway bag · Legion · characters.",
    "- Puter = User-Pays cloud FS/KV/AI only — never sole bag/XP SSOT.",
    "- Guest = local Forge only.",
    "- Login URL: /login?redirect_uri=… (NOT /auth/popup). Prefer sso_token over grudge_token.",
    "- Dual-write tokens: grudge.open.token, grudge_auth_token, sso_token, …",
    "- Email / Discord / wallet on ID hub mint same Grudge ID; Railway users.grudge_id.",
  ],
  redeploy: [
    "REDEPLOY / AI WORKERS (correct path):",
    "- SPA: GHA Deploy Forge SPA → Vercel prebuilt → forge.grudge-studio.com edge.",
    "- free-ai / catalog / agent: workers/forge-free-ai wrangler deploy (routes more-specific).",
    "- gameforge-web edge shell separate from free-ai secrets.",
    "- Legion brain: grudge-legion-ai + grudge-ai-hub (ai.grudge-studio.com) — dual deploy.",
    "- Smoke: smoke-forge-prod.mjs · free-ai/status · __edge/health · editor shell.",
    "- Agent jobs D1 forge-agent: create_agent_job kinds (bake/verify hints) — not player bag.",
    "- Intentional single-intent deploys; never force-push main; secrets via wrangler secret put.",
  ],
};

export function getThreeStandards(topic: StandardsTopic = "all"): {
  topic: StandardsTopic;
  text: string;
  topics: string[];
} {
  if (topic === "all") {
    const text = (Object.keys(SECTIONS) as Array<keyof typeof SECTIONS>)
      .map((k) => SECTIONS[k].join("\n"))
      .join("\n\n");
    return {
      topic: "all",
      text,
      topics: Object.keys(SECTIONS),
    };
  }
  const lines = SECTIONS[topic];
  return {
    topic,
    text: lines ? lines.join("\n") : `Unknown topic: ${topic}`,
    topics: Object.keys(SECTIONS),
  };
}
