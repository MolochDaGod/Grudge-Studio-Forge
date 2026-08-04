/**
 * Rule-based intent classification for Forge AI Orchestrator.
 * Cheap, offline, no LLM required. Optional chips override.
 */

export type ForgeIntent =
  | "scene"
  | "model"
  | "physics"
  | "nav"
  | "vfx"
  | "script"
  | "materials"
  | "diagnose"
  | "deploy"
  | "design"
  | "general";

export type AgentRole =
  | "orchestrator"
  | "scene_builder"
  | "code"
  | "design"
  | "diagnose"
  | "deploy"
  | "offline";

const PATTERNS: Array<{ intent: ForgeIntent; re: RegExp }> = [
  {
    intent: "diagnose",
    re: /\b(fix|broken|diagnose|debug|why|error|crash|float|sideways|t-?pose|shapes?|placeholder)\b/i,
  },
  {
    intent: "deploy",
    re: /\b(deploy|production|live|smoke|vercel|railway|wrangler|ship|publish)\b/i,
  },
  {
    intent: "nav",
    re: /\b(navmesh|nav mesh|pathfind|patrol|bake nav|agent path|yuka|recast)\b/i,
  },
  {
    intent: "physics",
    re: /\b(rapier|collider|physics|rigid ?body|cct|kinematic|convex|trigger)\b/i,
  },
  {
    intent: "vfx",
    re: /\b(vfx|particle|slash|trail|explosion|fire|fx|effect|bloom)\b/i,
  },
  {
    intent: "script",
    re: /\b(script|wasd|controller|blazor|c#|csharp|monaco|behavior|networkmanager)\b/i,
  },
  {
    intent: "materials",
    re: /\b(material|texture|pbr|albedo|roughness|metalness|shader|srgb)\b/i,
  },
  {
    intent: "design",
    re: /\b(light|lighting|palette|camera frame|layout|mood|sky|fog|sun)\b/i,
  },
  {
    intent: "model",
    re: /\b(spawn|import|glb|model|character|blake|grudge6|race|weapon|prefab|fast asset)\b/i,
  },
  {
    intent: "scene",
    re: /\b(scene|map|arena|level|island|deathmatch|rts|village|build|generate scene)\b/i,
  },
];

/** Map intent → primary agent role for model routing. */
export function roleForIntent(intent: ForgeIntent): AgentRole {
  switch (intent) {
    case "script":
      return "code";
    case "design":
    case "materials":
    case "vfx":
      return "design";
    case "diagnose":
      return "diagnose";
    case "deploy":
      return "deploy";
    case "scene":
    case "model":
    case "physics":
    case "nav":
      return "scene_builder";
    default:
      return "orchestrator";
  }
}

export function classifyIntent(
  text: string,
  override?: ForgeIntent | null,
): ForgeIntent {
  if (override) return override;
  const t = text.trim();
  if (!t) return "general";
  for (const { intent, re } of PATTERNS) {
    if (re.test(t)) return intent;
  }
  return "general";
}

/** Human label for status chips. */
export function intentLabel(intent: ForgeIntent): string {
  const map: Record<ForgeIntent, string> = {
    scene: "Scene",
    model: "Model / assets",
    physics: "Physics",
    nav: "Navmesh",
    vfx: "VFX",
    script: "Scripts",
    materials: "Materials",
    diagnose: "Diagnose",
    deploy: "Deploy",
    design: "Design",
    general: "Auto",
  };
  return map[intent];
}
