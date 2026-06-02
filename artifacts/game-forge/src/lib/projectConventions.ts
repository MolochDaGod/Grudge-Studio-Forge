/**
 * Project Conventions — enforced naming patterns, UUID generation,
 * and auto-organization for Forge projects.
 *
 * Naming rules:
 *   - Entity names:    PascalCase ("Player", "EnemyPatrol", "MainLight")
 *   - Script names:    camelCase  ("playerHealth", "enemyPatrol")
 *   - File names:      kebab-case ("player-health.js", "enemy-group.prefab.json")
 *   - Prefab names:    PascalCase ("PlayerPrefab", "EnemyGroup")
 *   - Layer names:     PascalCase ("Default", "NPC", "Trigger", "Player")
 *
 * UUID:
 *   - Entity IDs: UUID v4 (globally unique across projects + GitHub sync)
 *   - Existing nanoid(8) IDs are preserved for backward compat but new
 *     entities should use generateEntityId() which returns UUID v4.
 */

// ── UUID v4 generation ───────────────────────────────────────────────

/** Generate a UUID v4 for entity IDs. Uses crypto.randomUUID when
 *  available (all modern browsers), falls back to a manual implementation. */
export function generateEntityId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Naming helpers ───────────────────────────────────────────────────

/** Convert any string to PascalCase: "enemy patrol" → "EnemyPatrol" */
export function toPascalCase(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/** Convert any string to camelCase: "Player Health" → "playerHealth" */
export function toCamelCase(s: string): string {
  const pascal = toPascalCase(s);
  return pascal[0]?.toLowerCase() + pascal.slice(1);
}

/** Convert any string to kebab-case: "Player Health" → "player-health" */
export function toKebabCase(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Naming validation ────────────────────────────────────────────────

export interface NamingIssue {
  entityId?: string;
  field: "entityName" | "scriptName" | "prefabName" | "layerName";
  current: string;
  suggested: string;
  rule: string;
}

/** Check entity names follow PascalCase convention. */
export function auditEntityNames(
  entities: Array<{ id: string; name: string }>,
): NamingIssue[] {
  const issues: NamingIssue[] = [];
  for (const e of entities) {
    const suggested = toPascalCase(e.name);
    if (suggested && suggested !== e.name && suggested.length > 0) {
      issues.push({
        entityId: e.id,
        field: "entityName",
        current: e.name,
        suggested,
        rule: "Entity names should use PascalCase",
      });
    }
  }
  return issues;
}

/** Check script names follow camelCase convention. */
export function auditScriptNames(
  scripts: Array<{ name: string }>,
): NamingIssue[] {
  const issues: NamingIssue[] = [];
  for (const s of scripts) {
    const suggested = toCamelCase(s.name);
    if (suggested && suggested !== s.name) {
      issues.push({
        field: "scriptName",
        current: s.name,
        suggested,
        rule: "Script names should use camelCase",
      });
    }
  }
  return issues;
}

// ── Project structure validation ─────────────────────────────────────

export interface ProjectAuditResult {
  namingIssues: NamingIssue[];
  /** Entities with duplicate names (within the same parent scope). */
  duplicateNames: Array<{ name: string; ids: string[] }>;
  /** Entities with no parent that probably should be grouped. */
  ungroupedEntities: string[];
  /** Total score 0-100 (higher = more organized). */
  score: number;
}

export function auditProject(opts: {
  entities: Array<{ id: string; name: string; parentId: string | null; type: string }>;
  scripts: Array<{ name: string }>;
}): ProjectAuditResult {
  const { entities, scripts } = opts;

  const namingIssues = [
    ...auditEntityNames(entities),
    ...auditScriptNames(scripts),
  ];

  // Find duplicate names at the same parent scope
  const byParent = new Map<string, Map<string, string[]>>();
  for (const e of entities) {
    const key = e.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, new Map());
    const scope = byParent.get(key)!;
    if (!scope.has(e.name)) scope.set(e.name, []);
    scope.get(e.name)!.push(e.id);
  }
  const duplicateNames: ProjectAuditResult["duplicateNames"] = [];
  for (const scope of byParent.values()) {
    for (const [name, ids] of scope) {
      if (ids.length > 1) duplicateNames.push({ name, ids });
    }
  }

  // Find root-level entities that are probably props/lights (should be grouped)
  const ungroupedEntities = entities
    .filter(
      (e) =>
        !e.parentId &&
        (e.type === "box" || e.type === "sphere" || e.type === "cylinder" || e.type === "light") &&
        !e.name.toLowerCase().includes("ground") &&
        !e.name.toLowerCase().includes("floor") &&
        !e.name.toLowerCase().includes("player"),
    )
    .map((e) => e.id);

  // Score: start at 100, deduct for issues
  let score = 100;
  score -= Math.min(30, namingIssues.length * 2);
  score -= Math.min(20, duplicateNames.length * 5);
  score -= Math.min(20, ungroupedEntities.length * 3);
  if (entities.length === 0) score = 0;

  return { namingIssues, duplicateNames, ungroupedEntities, score: Math.max(0, score) };
}
