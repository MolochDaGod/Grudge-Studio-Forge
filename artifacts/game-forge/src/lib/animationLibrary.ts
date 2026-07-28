/**
 * Built-in animation catalog for the Forge editor.
 *
 * Fleet SSOT for combat kits / blends: `@/lib/grudgeStudioFleet`
 * (`combatSkillKit`, `LocomotionCore`). This catalog remains the
 * inspector/AI picker for Mixamo + R2 clip keys.
 *
 * The AI tool `apply_animation` and the inspector's animation picker
 * reference this catalog by key. Each entry describes a clip with its
 * source URL (R2, Mixamo pattern, or builtin), duration, loop mode,
 * and which skeleton it targets.
 *
 * Adding a new animation:
 *   1. Add an entry here with a unique `key`.
 *   2. Upload the GLB/FBX to R2 under `animations/<key>.glb`.
 *   3. The editor's ModelRenderer picks it up automatically.
 *
 * Mixamo patterns: URLs like `mixamo://<animation-name>` are resolved
 * at runtime by the ModelRenderer via the Mixamo REST API (requires
 * the user to be signed in to Mixamo). For offline use, download the
 * FBX from Mixamo and convert it to GLB via the asset converter.
 *
 * Weapon skill ids for play: forgeCombatKit("sword_shield" | "mace_1h" | …)
 */

export interface AnimationClip {
  /** Unique key used by AI tools and the inspector. */
  key: string;
  /** Human-readable name shown in the picker. */
  name: string;
  /** Category for grouping in the UI. */
  category: "locomotion" | "combat" | "emote" | "utility";
  /** Approximate duration in seconds (0 = varies/looping). */
  duration: number;
  /** Whether the clip loops by default. */
  loop: boolean;
  /** Skeleton type this clip was authored for. */
  skeleton: "humanoid" | "generic" | "any";
  /** Brief description for the AI. */
  description: string;
  /**
   * Source URL or pattern. One of:
   * - `builtin:<name>` — baked into a bundled GLB
   * - `r2:animations/<key>.glb` — hosted on Grudge R2
   * - `mixamo://<name>` — fetched from Mixamo at runtime
   * - Full HTTPS URL
   */
  source: string;
}

export const ANIMATION_CATALOG: AnimationClip[] = [
  // ── Locomotion ─────────────────────────────────────────────────────
  {
    key: "idle",
    name: "Idle",
    category: "locomotion",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Standing idle with subtle breathing motion.",
    source: "mixamo://Idle",
  },
  {
    key: "walk",
    name: "Walk",
    category: "locomotion",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Normal walking cycle, forward direction.",
    source: "mixamo://Walking",
  },
  {
    key: "run",
    name: "Run",
    category: "locomotion",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Running cycle, forward direction.",
    source: "mixamo://Running",
  },
  {
    key: "sprint",
    name: "Sprint",
    category: "locomotion",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Fast sprint cycle.",
    source: "mixamo://Fast Run",
  },
  {
    key: "jump",
    name: "Jump",
    category: "locomotion",
    duration: 1.0,
    loop: false,
    skeleton: "humanoid",
    description: "Jump in place — takeoff, airborne, landing.",
    source: "mixamo://Jump",
  },
  {
    key: "strafe-left",
    name: "Strafe Left",
    category: "locomotion",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Side-stepping left while facing forward.",
    source: "mixamo://Left Strafe Walking",
  },
  {
    key: "strafe-right",
    name: "Strafe Right",
    category: "locomotion",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Side-stepping right while facing forward.",
    source: "mixamo://Right Strafe Walking",
  },

  // ── Combat ─────────────────────────────────────────────────────────
  {
    key: "attack-sword",
    name: "Sword Slash",
    category: "combat",
    duration: 0.8,
    loop: false,
    skeleton: "humanoid",
    description: "One-handed horizontal sword swing.",
    source: "mixamo://Sword And Shield Slash",
  },
  {
    key: "attack-2h",
    name: "Two-Handed Strike",
    category: "combat",
    duration: 1.0,
    loop: false,
    skeleton: "humanoid",
    description: "Overhead two-handed weapon strike.",
    source: "mixamo://Great Sword Slash",
  },
  {
    key: "attack-bow",
    name: "Bow Draw & Release",
    category: "combat",
    duration: 1.2,
    loop: false,
    skeleton: "humanoid",
    description: "Draw bow, aim, and release arrow.",
    source: "mixamo://Standing Aim Recoil",
  },
  {
    key: "attack-staff",
    name: "Staff Cast",
    category: "combat",
    duration: 1.5,
    loop: false,
    skeleton: "humanoid",
    description: "Magic staff casting animation.",
    source: "mixamo://Standing 2H Cast Spell 01",
  },
  {
    key: "block",
    name: "Block",
    category: "combat",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Shield block stance, held until released.",
    source: "mixamo://Standing Shield Block Idle",
  },
  {
    key: "dodge-roll",
    name: "Dodge Roll",
    category: "combat",
    duration: 0.8,
    loop: false,
    skeleton: "humanoid",
    description: "Forward dodge roll for evasion.",
    source: "mixamo://Standing Dodge Forward",
  },
  {
    key: "death",
    name: "Death",
    category: "combat",
    duration: 2.0,
    loop: false,
    skeleton: "humanoid",
    description: "Death fall — collapses to the ground.",
    source: "mixamo://Death From The Front",
  },
  {
    key: "hit-react",
    name: "Hit Reaction",
    category: "combat",
    duration: 0.5,
    loop: false,
    skeleton: "humanoid",
    description: "Stagger backwards when taking damage.",
    source: "mixamo://Hit Reaction",
  },
  // Fleet weapon-skill keys (map to combatSkillKit / LocomotionCore roles)
  {
    key: "fleet-ss-slash",
    name: "Fleet: Sword Slash",
    category: "combat",
    duration: 0.6,
    loop: false,
    skeleton: "humanoid",
    description: "sword_shield ss_slash — play via forgeCombatKit + LocomotionCore.",
    source: "fleet:sword_shield/ss_slash",
  },
  {
    key: "fleet-mace-swing",
    name: "Fleet: Mace Swing",
    category: "combat",
    duration: 0.6,
    loop: false,
    skeleton: "humanoid",
    description: "mace_1h mace_swing (Raidriar retarget path).",
    source: "fleet:mace_1h/mace_swing",
  },
  {
    key: "fleet-dash-slide",
    name: "Fleet: Dash Slide",
    category: "combat",
    duration: 0.9,
    loop: false,
    skeleton: "humanoid",
    description: "dash pack mobility skill — locomotionSkill blend.",
    source: "fleet:dash/dash_slide",
  },
  {
    key: "fleet-parry",
    name: "Fleet: Parry",
    category: "combat",
    duration: 0.4,
    loop: false,
    skeleton: "humanoid",
    description: "block pack parry — full-body timed window.",
    source: "fleet:block/parry",
  },

  // ── Emotes ─────────────────────────────────────────────────────────
  {
    key: "dance",
    name: "Dance",
    category: "emote",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Casual dance loop — victory or idle entertainment.",
    source: "mixamo://Macarena Dance",
  },
  {
    key: "wave",
    name: "Wave",
    category: "emote",
    duration: 2.0,
    loop: false,
    skeleton: "humanoid",
    description: "Friendly wave gesture.",
    source: "mixamo://Waving",
  },
  {
    key: "sit",
    name: "Sitting",
    category: "emote",
    duration: 0,
    loop: true,
    skeleton: "humanoid",
    description: "Seated idle pose (ground or chair).",
    source: "mixamo://Sitting Idle",
  },

  // ── Utility ────────────────────────────────────────────────────────
  {
    key: "gather",
    name: "Gather / Harvest",
    category: "utility",
    duration: 2.5,
    loop: true,
    skeleton: "humanoid",
    description: "Picking up or mining — repetitive gathering motion.",
    source: "mixamo://Picking Up",
  },
  {
    key: "interact",
    name: "Interact / Use",
    category: "utility",
    duration: 1.0,
    loop: false,
    skeleton: "humanoid",
    description: "Generic interact — pushing button, opening chest.",
    source: "mixamo://Push Button",
  },
];

/** Look up a clip by key. */
export function findClip(key: string): AnimationClip | undefined {
  return ANIMATION_CATALOG.find((c) => c.key === key);
}

/** Get all clips in a category. */
export function clipsByCategory(cat: AnimationClip["category"]): AnimationClip[] {
  return ANIMATION_CATALOG.filter((c) => c.category === cat);
}

/** Get all clip keys (for AI tool enum). */
export function allClipKeys(): string[] {
  return ANIMATION_CATALOG.map((c) => c.key);
}
