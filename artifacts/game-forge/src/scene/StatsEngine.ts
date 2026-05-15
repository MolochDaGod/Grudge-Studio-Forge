/**
 * Play-session-scoped stats engine.
 *
 * Owns the live stat blocks for every entity that carries a
 * {@link StatsComponent}. Scripts interact through `ctx.stats.*`;
 * the engine handles modifier stacking, duration ticking, dirty
 * tracking, and re-derivation so scripts never need to manually
 * recompute stats.
 *
 * Lifecycle:
 *   1. `init(entities)` — called once when play mode starts.
 *   2. `tick(delta)` — called once per frame from PlayScriptRuntime.
 *   3. `reset()` — called when play mode stops.
 */

import {
  type StatsComponent,
  type StatModifier,
  type ResolvedStats,
  type Attribute,
  type DerivedStat,
  resolveStats,
} from "@workspace/scene-schema";

let nextModId = 0;

/** Generate a unique modifier id. */
function modId(): string {
  return `mod_${++nextModId}_${Math.random().toString(36).slice(2, 6)}`;
}

interface EntityEntry {
  /** Frozen copy of the persisted component (base + level + xp). */
  component: StatsComponent;
  /** Active runtime modifiers. */
  modifiers: StatModifier[];
  /** Cached resolved stats — re-derived on modifier change. */
  resolved: ResolvedStats;
  /** Dirty flag — set whenever modifiers change, cleared after re-derive. */
  dirty: boolean;
}

export class StatsEngine {
  private entries = new Map<string, EntityEntry>();

  /** Populate from the scene's entity list at play-mode start. Only
   *  entities with a `stats` component are registered. */
  init(entities: ReadonlyArray<{ id: string; stats?: StatsComponent }>): void {
    this.entries.clear();
    nextModId = 0;
    for (const e of entities) {
      if (!e.stats) continue;
      const component: StatsComponent = JSON.parse(JSON.stringify(e.stats));
      this.entries.set(e.id, {
        component,
        modifiers: [],
        resolved: resolveStats(component),
        dirty: false,
      });
    }
  }

  /** Get the fully-resolved stat block (attributes + derived + level).
   *  Returns `undefined` when the entity has no stats component. */
  get(id: string): ResolvedStats | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.dirty) this.rederive(entry);
    return entry.resolved;
  }

  /** Get just the base persisted component (no modifiers applied). */
  getBase(id: string): StatsComponent | undefined {
    return this.entries.get(id)?.component;
  }

  /** Add a runtime modifier. Returns the modifier's id (auto-generated
   *  when `mod.id` is empty). Handles stack enforcement. */
  modify(
    entityId: string,
    mod: Omit<StatModifier, "id"> & { id?: string },
  ): string | undefined {
    const entry = this.entries.get(entityId);
    if (!entry) return undefined;

    const m: StatModifier = { ...mod, id: mod.id || modId() };

    // Stack enforcement: if stackId is set, cap concurrent modifiers.
    if (m.stackId) {
      const maxStacks = m.maxStacks ?? 1;
      const sameStack = entry.modifiers.filter((x) => x.stackId === m.stackId);
      while (sameStack.length >= maxStacks) {
        // Remove the oldest (first) in the stack.
        const oldest = sameStack.shift()!;
        const idx = entry.modifiers.indexOf(oldest);
        if (idx >= 0) entry.modifiers.splice(idx, 1);
      }
    }

    entry.modifiers.push(m);
    entry.dirty = true;
    return m.id;
  }

  /** Remove a specific modifier by id. Returns true if found. */
  remove(entityId: string, modifierId: string): boolean {
    const entry = this.entries.get(entityId);
    if (!entry) return false;
    const idx = entry.modifiers.findIndex((m) => m.id === modifierId);
    if (idx < 0) return false;
    entry.modifiers.splice(idx, 1);
    entry.dirty = true;
    return true;
  }

  /** Remove all modifiers from a given source on an entity. */
  removeBySource(entityId: string, source: string): number {
    const entry = this.entries.get(entityId);
    if (!entry) return 0;
    const before = entry.modifiers.length;
    entry.modifiers = entry.modifiers.filter((m) => m.source !== source);
    const removed = before - entry.modifiers.length;
    if (removed > 0) entry.dirty = true;
    return removed;
  }

  /** Tick durations down and remove expired modifiers. Call once per
   *  frame from the play-mode runtime. Only touches entries that have
   *  at least one timed modifier — the fast path (no timed mods) is a
   *  single Map iteration with zero allocations. */
  tick(delta: number): void {
    for (const entry of this.entries.values()) {
      if (entry.modifiers.length === 0) continue;
      let anyExpired = false;
      for (const m of entry.modifiers) {
        if (m.duration === undefined) continue;
        m.duration -= delta;
        if (m.duration <= 0) anyExpired = true;
      }
      if (anyExpired) {
        entry.modifiers = entry.modifiers.filter(
          (m) => m.duration === undefined || m.duration > 0,
        );
        entry.dirty = true;
      }
    }
    // Re-derive any dirty entries after sweep.
    for (const entry of this.entries.values()) {
      if (entry.dirty) this.rederive(entry);
    }
  }

  /** Produce a `RaceStats`-shaped view for backward compatibility with
   *  existing deathmatch behaviors that read `ctx.races[raceId]`. */
  toRaceStats(id: string): { health: number; speed: number; damage: number } | undefined {
    const r = this.get(id);
    if (!r) return undefined;
    return {
      health: r.derived.maxHealth,
      speed: r.derived.moveSpeed,
      damage: r.derived.attackDamage,
    };
  }

  /** List all active modifiers on an entity (read-only snapshot). */
  listModifiers(entityId: string): readonly StatModifier[] {
    return this.entries.get(entityId)?.modifiers ?? [];
  }

  /** Drop everything. Called by `resetPlaySession`. */
  reset(): void {
    this.entries.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private rederive(entry: EntityEntry): void {
    entry.resolved = resolveStats(entry.component, entry.modifiers);
    entry.dirty = false;
  }
}
