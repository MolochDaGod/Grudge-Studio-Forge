/**
 * First-class Material system.
 *
 * `Material` is one of three orthogonal axes a {@link SceneEntity} can
 * carry — alongside {@link LayerName} (collision groups) and
 * {@link SurfaceKind} (navmesh + agent FSM). All three are stamped on
 * the rendered group's `userData` and resolved via the parent chain
 * (see {@link resolveInheritedFields}) so spatial queries, raycasts,
 * AI perception, and gameplay scripts can read a coherent answer from
 * any hit object regardless of which level of the GLB / prefab tree
 * the ray actually lands on.
 *
 * The {@link MATERIAL_KINDS} registry is fixed (the AI tool schemas
 * enum off it). Per-kind defaults model the "physical character" of
 * the material — a glass pane lets bullets through, foliage doesn't
 * block sight, cloth has high air drag and zero restitution, etc.
 * Individual entities can override any default field via
 * {@link MaterialComponent}.
 */

export const MATERIAL_KINDS = [
  "Solid",
  "Metal",
  "Glass",
  "Wood",
  "Stone",
  "Cloth",
  "Flag",
  "Foliage",
  "Liquid",
  "Particle",
  "Smoke",
  "Emissive",
  "Custom",
] as const;

export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** Physical defaults for a single MaterialKind. Every field is concrete
 *  (no `?`) so callers can rely on a non-undefined readout after a
 *  registry lookup; overrides on {@link MaterialComponent} layer on top. */
export interface MaterialDefaults {
  /** Volumetric mass density (kg/m³). Drives Rapier `density` when the
   *  entity has a collider but no explicit `mass`. */
  density: number;
  /** Coulomb friction coefficient applied to the collider. */
  friction: number;
  /** Bounciness (0…1). */
  restitution: number;
  /** Linear damping applied to dynamic bodies — high for cloth /
   *  liquid / smoke so they don't sail across the scene. */
  drag: number;
  /** Visual opacity used by the renderer when the entity has no
   *  explicit color/opacity override. 1 = fully opaque. */
  opacity: number;
  /** Whether a ray-of-sight cast (camera vis, AI perception) is
   *  blocked by hits on this material. */
  blocksLineOfSight: boolean;
  /** Whether projectile raycasts stop on this material. Glass /
   *  foliage / liquid let bullets through; metal / wood / stone don't. */
  blocksProjectiles: boolean;
  /** Whether audio occlusion treats this material as a wall. */
  blocksAudio: boolean;
}

/** Per-kind physical defaults. Tuned to feel right for prototyping;
 *  every value can be overridden per entity via {@link MaterialComponent}. */
export const MATERIAL_DEFAULTS: Readonly<Record<MaterialKind, MaterialDefaults>> = {
  Solid:    { density: 1000, friction: 0.6,  restitution: 0.1,  drag: 0.0, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: true,  blocksAudio: true  },
  Metal:    { density: 7800, friction: 0.4,  restitution: 0.05, drag: 0.0, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: true,  blocksAudio: true  },
  Glass:    { density: 2500, friction: 0.2,  restitution: 0.0,  drag: 0.0, opacity: 0.3,  blocksLineOfSight: true,  blocksProjectiles: false, blocksAudio: true  },
  Wood:     { density: 600,  friction: 0.6,  restitution: 0.15, drag: 0.0, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: true,  blocksAudio: true  },
  Stone:    { density: 2400, friction: 0.8,  restitution: 0.05, drag: 0.0, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: true,  blocksAudio: true  },
  Cloth:    { density: 200,  friction: 0.9,  restitution: 0.0,  drag: 0.6, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: false, blocksAudio: false },
  Flag:     { density: 200,  friction: 0.6,  restitution: 0.0,  drag: 0.4, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: false, blocksAudio: false },
  Foliage:  { density: 400,  friction: 0.7,  restitution: 0.1,  drag: 0.3, opacity: 0.95, blocksLineOfSight: false, blocksProjectiles: false, blocksAudio: false },
  Liquid:   { density: 1000, friction: 0.0,  restitution: 0.0,  drag: 2.0, opacity: 0.7,  blocksLineOfSight: false, blocksProjectiles: false, blocksAudio: true  },
  Particle: { density: 10,   friction: 0.0,  restitution: 0.2,  drag: 0.2, opacity: 0.6,  blocksLineOfSight: false, blocksProjectiles: false, blocksAudio: false },
  Smoke:    { density: 1,    friction: 0.0,  restitution: 0.0,  drag: 0.3, opacity: 0.4,  blocksLineOfSight: false, blocksProjectiles: false, blocksAudio: false },
  Emissive: { density: 1000, friction: 0.6,  restitution: 0.1,  drag: 0.0, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: true,  blocksAudio: true  },
  Custom:   { density: 1000, friction: 0.6,  restitution: 0.1,  drag: 0.0, opacity: 1.0,  blocksLineOfSight: true,  blocksProjectiles: true,  blocksAudio: true  },
};

/** Per-entity material overrides. `kind` selects the registry slot; any
 *  other field, when set, replaces the per-kind default. The visual
 *  fields (color/metalness/roughness/emissive) keep the legacy
 *  pre-Material-system meaning so older scenes load unchanged. */
export interface MaterialComponent {
  /** Registry slot. Defaults to `"Solid"` when unset (matches legacy
   *  scenes whose material only carried color/metalness/roughness). */
  kind?: MaterialKind;

  // ── Visual (PBR) ──
  color?: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  /** Optional opacity override. When unset the renderer falls back to
   *  the per-kind default. */
  opacity?: number;

  // ── Physical overrides ──
  /** Override per-kind density (kg/m³). */
  density?: number;
  /** Override per-kind Coulomb friction. */
  friction?: number;
  /** Override per-kind restitution (bounciness 0…1). */
  restitution?: number;
  /** Override per-kind linear-velocity drag. */
  drag?: number;

  // ── Gameplay flags ──
  blocksLineOfSight?: boolean;
  blocksProjectiles?: boolean;
  blocksAudio?: boolean;
}

/** Look up the resolved physical defaults for a material — applies any
 *  per-entity overrides on top of the per-kind registry defaults. Pass
 *  `undefined` to get the `"Solid"` baseline (the safe default for
 *  entities that have no Material component yet). */
export function resolveMaterialDefaults(
  m: MaterialComponent | undefined,
): MaterialDefaults & { kind: MaterialKind } {
  const kind: MaterialKind = m?.kind ?? "Solid";
  const base = MATERIAL_DEFAULTS[kind];
  return {
    kind,
    density: m?.density ?? base.density,
    friction: m?.friction ?? base.friction,
    restitution: m?.restitution ?? base.restitution,
    drag: m?.drag ?? base.drag,
    opacity: m?.opacity ?? base.opacity,
    blocksLineOfSight: m?.blocksLineOfSight ?? base.blocksLineOfSight,
    blocksProjectiles: m?.blocksProjectiles ?? base.blocksProjectiles,
    blocksAudio: m?.blocksAudio ?? base.blocksAudio,
  };
}

/** Kinds safe for bulk recolor via `apply_palette`. Excludes Cloth /
 *  Flag / Glass / Particles plus the obvious colour-bound kinds
 *  (Liquid / Smoke / Foliage / Emissive). */
export const PALETTE_FRIENDLY_KINDS: readonly MaterialKind[] = [
  "Solid",
  "Metal",
  "Wood",
  "Stone",
  "Custom",
];

export function isPaletteFriendly(kind: MaterialKind | undefined): boolean {
  return PALETTE_FRIENDLY_KINDS.includes((kind ?? "Solid") as MaterialKind);
}
