/**
 * Resolve a user/AI-requested animation clip name against the set of
 * clip names available on a GLB (or procedural biped synthesizer).
 *
 * Handles:
 *   - exact match
 *   - case-insensitive match
 *   - catalog keys (idle, walk, run, attack-sword → attack)
 *   - substring / Mixamo "mixamo.com|Idle" style names
 */

const ALIASES: Record<string, string[]> = {
  idle: ["idle", "standing", "stand", "t-pose", "tpose", "breathing"],
  walk: ["walk", "walking", "loco-walking", "loco-walk"],
  run: ["run", "running", "sprint", "loco-running", "fast run"],
  jump: ["jump", "jumping", "loco-jump"],
  attack: [
    "attack",
    "slash",
    "punch",
    "strike",
    "combat",
    "sword",
    "hit",
    "attack-sword",
    "attack-2h",
  ],
  death: ["death", "die", "dying", "dead"],
  hit: ["hit", "hit-react", "react", "damage", "flinch"],
  climb: ["climb", "climbing", "ladder"],
  swim: ["swim", "swimming"],
  block: ["block", "shield", "guard"],
};

/** Normalize catalog keys into short FSM-friendly names. */
export function normalizeCatalogClip(requested: string): string {
  const k = requested.trim().toLowerCase();
  if (k === "attack-sword" || k === "attack-2h" || k.startsWith("attack-")) return "attack";
  if (k === "hit-react") return "hit";
  if (k === "dodge-roll") return "dodge";
  if (k === "strafe-left" || k === "strafe-right") return "walk";
  if (k === "sprint") return "run";
  if (k.startsWith("loco-")) {
    if (k.includes("walk")) return "walk";
    if (k.includes("run")) return "run";
    if (k.includes("jump")) return "jump";
    if (k.includes("idle")) return "idle";
  }
  if (k.startsWith("magic-standing-")) {
    if (k.includes("idle")) return "idle";
    if (k.includes("walk")) return "walk";
    if (k.includes("run") || k.includes("sprint")) return "run";
    if (k.includes("jump")) return "jump";
  }
  return requested.trim();
}

/**
 * Pick the best available clip name for `requested`.
 * Returns null if nothing matches.
 */
export function resolveClipName(
  requested: string | null | undefined,
  available: readonly string[],
): string | null {
  if (!requested || !available.length) return null;
  const names = [...available];
  // 1. Exact
  if (names.includes(requested)) return requested;

  const norm = normalizeCatalogClip(requested);
  if (names.includes(norm)) return norm;

  const lower = norm.toLowerCase();
  // 2. Case-insensitive exact
  const ci = names.find((n) => n.toLowerCase() === lower);
  if (ci) return ci;

  // 3. Alias table — match any alias token as substring of available name
  const aliasTokens = ALIASES[lower] ?? [lower];
  for (const token of aliasTokens) {
    const hit = names.find((n) => {
      const nl = n.toLowerCase();
      return nl === token || nl.includes(token) || nl.endsWith(token);
    });
    if (hit) return hit;
  }

  // 4. Requested appears inside a long Mixamo-style name
  const sub = names.find((n) => n.toLowerCase().includes(lower));
  if (sub) return sub;

  return null;
}

/** Publish a clip override so LoadedModel crossfades even outside play-mode FSM. */
export function publishAgentClip(entityId: string, clip: string | null): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __agentClips?: Map<string, string> };
  w.__agentClips ??= new Map();
  if (clip == null || clip === "") {
    w.__agentClips.delete(entityId);
  } else {
    w.__agentClips.set(entityId, clip);
  }
}
