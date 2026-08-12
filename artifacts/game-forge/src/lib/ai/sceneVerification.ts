/**
 * Scene verification SSOT for Forge AI Worker + diagnose_scene.
 *
 * SI size checks, material/texture flags, character/anim readiness,
 * and Rapier controller hints — pure functions over scene-schema entities
 * (no Three.js runtime required). Aligns with grudge-character-correctness
 * + threejs production / Rapier skills.
 */

import type { SceneEntity } from "@workspace/scene-schema";

export type VerifySeverity = "error" | "warn" | "info" | "ok";

export type VerifyFinding = {
  rule: string;
  severity: VerifySeverity;
  message: string;
  entityIds?: string[];
  hint?: string;
  /** Structured numbers for agents (metres, ratios). */
  metrics?: Record<string, number | string | boolean | null>;
};

/** Humanoid play height band (metres). */
export const HUMAN_HEIGHT_M = 1.8;
export const HERO_HEIGHT_MIN_M = 1.45;
export const HERO_HEIGHT_MAX_M = 2.2;
/** Classic 100× unit bug: scale ~100 on character-like entities. */
export const UNIT_BUG_SCALE = 50;

const PLACEHOLDER_URL =
  /meshy|placeholder|capsule|toon-shooter|mutant|replit\.app|localhost|blob:/i;
const CDN_OK = /assets\.grudge-studio\.com|builtin:|polyhaven|cloudflare|r2/i;
const CHARACTERISH =
  /character|hero|player|npc|grudge6|race|warrior|orc|elf|dwarf|blake|toon|humanoid|enemy/i;
const WEAPONISH = /weapon|sword|bow|arrow|rifle|pistol|shield|staff|projectile/i;
const TERRAINISH = /terrain|ground|heightfield|floor|island|map-|landscape/i;

function scaleOf(e: SceneEntity): [number, number, number] {
  const s = e.transform?.scale as number[] | undefined;
  if (!s || s.length < 3) return [1, 1, 1];
  return [
    Number(s[0]) || 1,
    Number(s[1]) || 1,
    Number(s[2]) || 1,
  ];
}

function maxAbsScale(e: SceneEntity): number {
  const [x, y, z] = scaleOf(e);
  return Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
}

function looksCharacter(e: SceneEntity): boolean {
  if (e.controllerKind && e.controllerKind !== "none") return true;
  if (e.behavior && /player|enemy|ally|npc|boss|animal/i.test(String(e.behavior))) {
    return true;
  }
  const name = `${e.name ?? ""} ${e.model?.builtin ?? ""} ${e.model?.url ?? ""}`;
  return CHARACTERISH.test(name);
}

function looksWeapon(e: SceneEntity): boolean {
  const name = `${e.name ?? ""} ${e.model?.builtin ?? ""} ${e.model?.url ?? ""}`;
  return WEAPONISH.test(name);
}

function looksTerrain(e: SceneEntity): boolean {
  if (e.layer === "Terrain" || e.surface === "Walk") return true;
  const name = `${e.name ?? ""} ${e.model?.builtin ?? ""}`;
  return TERRAINISH.test(name) || e.type === "plane";
}

function modelRef(e: SceneEntity): string {
  return String(e.model?.url || e.model?.builtin || "");
}

/**
 * SI / size audit for models and controllers.
 * Does not force 1.8 m on weapons/props — only flags likely unit bugs.
 */
export function verifyMeshScale(
  entities: readonly SceneEntity[],
): VerifyFinding[] {
  const out: VerifyFinding[] = [];
  for (const e of entities) {
    if (e.type !== "model" && !e.controllerKind) continue;
    const [sx, sy, sz] = scaleOf(e);
    const maxS = maxAbsScale(e);
    const isChar = looksCharacter(e);
    const isWeap = looksWeapon(e);

    if (![sx, sy, sz].every((n) => Number.isFinite(n) && Math.abs(n) > 1e-6)) {
      out.push({
        rule: "scale-invalid",
        severity: "error",
        message: `"${e.name}" has non-finite or zero scale — mesh/physics will fail.`,
        entityIds: [e.id],
        hint: "Set transform.scale to positive metres, e.g. [1,1,1].",
        metrics: { sx, sy, sz },
      });
      continue;
    }

    if (maxS >= UNIT_BUG_SCALE) {
      out.push({
        rule: "scale-unit-bug-100x",
        severity: "error",
        message: `"${e.name}" max scale ${maxS.toFixed(1)} — classic cm-as-metres / 100× unit bug.`,
        entityIds: [e.id],
        hint: isChar
          ? "Fit character height ~1.8 m (SI). Never leave 100× giants."
          : "Divide scale by 100 (or convert author units). SI: 1 unit = 1 m.",
        metrics: { maxScale: maxS, sx, sy, sz },
      });
    } else if (isChar && maxS > HERO_HEIGHT_MAX_M * 2 && maxS < UNIT_BUG_SCALE) {
      out.push({
        rule: "character-oversized",
        severity: "warn",
        message: `Character-like "${e.name}" scale max ${maxS.toFixed(2)} m — likely too large vs ${HUMAN_HEIGHT_M} m human.`,
        entityIds: [e.id],
        hint: `Target height ~${HUMAN_HEIGHT_M} m (band ${HERO_HEIGHT_MIN_M}–${HERO_HEIGHT_MAX_M}).`,
        metrics: { maxScale: maxS, humanYardstick: HUMAN_HEIGHT_M },
      });
    } else if (isChar && maxS > 0 && maxS < 0.2) {
      out.push({
        rule: "character-undersized",
        severity: "warn",
        message: `Character-like "${e.name}" scale max ${maxS.toFixed(3)} — likely too small (cm leftovers).`,
        entityIds: [e.id],
        hint: "Scale up toward ~1.8 m human height.",
        metrics: { maxScale: maxS },
      });
    }

    if (isWeap && Math.abs(sy - HUMAN_HEIGHT_M) < 0.05 && Math.abs(sx - HUMAN_HEIGHT_M) < 0.05) {
      out.push({
        rule: "weapon-fitted-to-human-height",
        severity: "warn",
        message: `Weapon-like "${e.name}" scale ≈ 1.8 on axes — do not fit weapons to human height.`,
        entityIds: [e.id],
        hint: "Weapons ~0.8–1.2 m; arrows ~0.6–0.9 m. Category-blind fit is banned.",
        metrics: { sx, sy, sz },
      });
    }

    if (isChar && maxS >= HERO_HEIGHT_MIN_M && maxS <= HERO_HEIGHT_MAX_M) {
      out.push({
        rule: "character-scale-ok",
        severity: "ok",
        message: `"${e.name}" scale in hero band (~${maxS.toFixed(2)} m).`,
        entityIds: [e.id],
        metrics: { maxScale: maxS },
      });
    }
  }
  return out;
}

/**
 * Texture / material verification from entity schema fields.
 * Runtime GPU maps aren't available here — flags missing maps, bad hosts, placeholders.
 */
export function verifyTextures(
  entities: readonly SceneEntity[],
): VerifyFinding[] {
  const out: VerifyFinding[] = [];
  for (const e of entities) {
    if (e.type !== "model" && e.type !== "box" && e.type !== "plane") continue;
    const ref = modelRef(e);
    const mat = e.material as
      | {
          map?: string;
          colorMap?: string;
          albedo?: string;
          color?: string;
          metalness?: number;
          roughness?: number;
        }
      | undefined;

    if (ref && PLACEHOLDER_URL.test(ref)) {
      out.push({
        rule: "texture-placeholder-host",
        severity: "error",
        message: `"${e.name}" model ref looks like placeholder/banned host: ${ref.slice(0, 80)}`,
        entityIds: [e.id],
        hint: "Use builtin: or https://assets.grudge-studio.com (grudge6 / Fast assets). No Meshy/capsule heroes.",
      });
    }

    if (ref && /^https?:\/\//i.test(ref) && !CDN_OK.test(ref) && !/github|khronos|polyhaven/i.test(ref)) {
      out.push({
        rule: "texture-untrusted-cdn",
        severity: "warn",
        message: `"${e.name}" loads from non-fleet CDN — may 404 or break CORS: ${ref.slice(0, 72)}`,
        entityIds: [e.id],
        hint: "import_asset_from_url → R2, or spawn_fast_asset / assets.grudge-studio.com.",
      });
    }

    const mapUrl = mat?.map || mat?.colorMap || mat?.albedo;
    if (mapUrl && PLACEHOLDER_URL.test(mapUrl)) {
      out.push({
        rule: "material-map-placeholder",
        severity: "error",
        message: `"${e.name}" material map is placeholder/banned.`,
        entityIds: [e.id],
        hint: "generate_texture or set_material_map with durable R2 URL; sRGB color textures.",
      });
    }

    if (looksCharacter(e) && !ref) {
      out.push({
        rule: "character-missing-model",
        severity: "error",
        message: `Character-like "${e.name}" has no model url/builtin.`,
        entityIds: [e.id],
        hint: "spawn_fast_asset grudge6 / race kit or add_model_entity with builtin:grudge6:*.",
      });
    }

    if (e.type === "model" && ref && !mat?.map && !mat?.colorMap) {
      // Info only — embeds often carry textures inside GLB
      if (!/\.glb|\.gltf|builtin:/i.test(ref)) {
        out.push({
          rule: "material-no-map-hint",
          severity: "info",
          message: `"${e.name}" has no explicit material map — ensure GLB embeds or set_material_map.`,
          entityIds: [e.id],
          hint: "list_materials → set_material / set_material_map. Color maps = SRGBColorSpace.",
        });
      }
    }
  }
  return out;
}

/**
 * Animation + character controller readiness (schema-level).
 */
export function verifyCharacterAnimation(
  entities: readonly SceneEntity[],
): VerifyFinding[] {
  const out: VerifyFinding[] = [];
  for (const e of entities) {
    if (!looksCharacter(e) && !(e.controllerKind && e.controllerKind !== "none")) {
      continue;
    }
    const clip = (e.model as { clip?: string } | undefined)?.clip;
    const hasController = !!(e.controllerKind && e.controllerKind !== "none");
    const ph = e.physics;

    if (hasController) {
      if (!ph || ph.bodyType === "dynamic") {
        out.push({
          rule: "controller-prefer-kinematic",
          severity: "warn",
          message: `Player/controller "${e.name}" should use kinematic CCT, not free dynamic body.`,
          entityIds: [e.id],
          hint: "set_physics bodyType=kinematicPosition, capsule colliders (halfHeight~0.9, radius~0.3).",
        });
      }
      if (
        ph &&
        ph.colliderType &&
        ph.colliderType !== "cylinder" &&
        !ph.capsuleHalfHeight &&
        ph.colliderType !== "ball"
      ) {
        out.push({
          rule: "controller-capsule-hint",
          severity: "info",
          message: `"${e.name}" controller without capsule metrics — CCT works best with capsule/cylinder.`,
          entityIds: [e.id],
          hint: "set_physics capsuleHalfHeight≈0.9 capsuleRadius≈0.3 (SI metres).",
        });
      }
    }

    if (looksCharacter(e) && !clip) {
      out.push({
        rule: "character-no-clip",
        severity: "info",
        message: `"${e.name}" has no model.clip — will T-pose until list_animations → apply_animation.`,
        entityIds: [e.id],
        hint: "apply_animation({ entityId, clip:'idle'|'walk'|'run'|'attack' }). One mixer; Bip001 packs; strip position tracks.",
      });
    }

    if (clip && /mixamo/i.test(clip) && /grudge6|bip001|race:/i.test(modelRef(e))) {
      out.push({
        rule: "mixamo-on-bip001",
        severity: "warn",
        message: `"${e.name}" clip looks Mixamo on grudge6/Bip001 kit — rematch will fail.`,
        entityIds: [e.id],
        hint: "Use Bip001 packs (sword_shield, longbow, magic) not mixamorig tracks.",
      });
    }

    const ref = modelRef(e);
    if (ref && PLACEHOLDER_URL.test(ref)) {
      out.push({
        rule: "character-placeholder-mesh",
        severity: "error",
        message: `Character "${e.name}" uses banned/placeholder mesh.`,
        entityIds: [e.id],
        hint: "Toon RTS grudge6 GLB only for play heroes — no Meshy/capsule.",
      });
    }
  }
  return out;
}

/**
 * Terrain + raycast readiness (schema): fixed ground, layers, surfaces.
 */
export function verifyTerrainPhysics(
  entities: readonly SceneEntity[],
): VerifyFinding[] {
  const out: VerifyFinding[] = [];
  const grounds = entities.filter(
    (e) =>
      looksTerrain(e) ||
      e.type === "plane" ||
      (e.physics?.bodyType === "fixed" &&
        (e.type === "box" || e.type === "model" || e.type === "plane")),
  );
  if (grounds.length === 0) {
    out.push({
      rule: "terrain-missing",
      severity: "warn",
      message: "No terrain/ground fixed body — CCT raycasts / feet will free-fall.",
      hint: "Add plane or fixed heightfield/mesh; layer=Terrain; surface=Walk. Raycast down for ground.",
    });
  }

  for (const e of grounds) {
    if (e.physics && e.physics.bodyType !== "fixed" && e.type !== "plane") {
      out.push({
        rule: "terrain-not-fixed",
        severity: "warn",
        message: `Ground-like "${e.name}" is not bodyType=fixed.`,
        entityIds: [e.id],
        hint: "Terrain colliders must be fixed (trimesh/heightfield/cuboid).",
      });
    }
    if (e.layer && e.layer !== "Terrain" && e.layer !== "Default") {
      out.push({
        rule: "terrain-layer-odd",
        severity: "info",
        message: `"${e.name}" ground layer=${e.layer} — prefer Terrain for matrix filters.`,
        entityIds: [e.id],
      });
    }
  }

  const dynamicsOnTerrainLayer = entities.filter(
    (e) => e.layer === "Terrain" && e.physics?.bodyType === "dynamic",
  );
  if (dynamicsOnTerrainLayer.length) {
    out.push({
      rule: "dynamic-on-terrain-layer",
      severity: "warn",
      message: `${dynamicsOnTerrainLayer.length} dynamic bodies on Terrain layer — usually wrong.`,
      entityIds: dynamicsOnTerrainLayer.map((e) => e.id),
      hint: "Terrain layer = static walkable; players = Player layer + kinematic CCT.",
    });
  }

  return out;
}

export type VerificationReport = {
  ok: boolean;
  counts: Record<VerifySeverity, number>;
  findings: VerifyFinding[];
  /** Agent-facing summary line. */
  summary: string;
};

export function runFullSceneVerification(
  entities: readonly SceneEntity[],
  opts?: { includeOk?: boolean },
): VerificationReport {
  const raw = [
    ...verifyMeshScale(entities),
    ...verifyTextures(entities),
    ...verifyCharacterAnimation(entities),
    ...verifyTerrainPhysics(entities),
  ];
  const findings = opts?.includeOk ? raw : raw.filter((f) => f.severity !== "ok");
  const counts: Record<VerifySeverity, number> = {
    error: 0,
    warn: 0,
    info: 0,
    ok: 0,
  };
  for (const f of findings) counts[f.severity]++;
  for (const f of raw) if (f.severity === "ok") counts.ok++;

  const ok = counts.error === 0;
  const summary = ok
    ? `Verification clean (${counts.warn} warns, ${counts.info} info, ${counts.ok} scale-ok).`
    : `Verification failed: ${counts.error} errors, ${counts.warn} warns — fix scale/textures/characters before deploy.`;

  return { ok, counts, findings, summary };
}

/** Convert findings to diagnose Issue shape. */
export function findingsAsDiagnoseIssues(
  findings: readonly VerifyFinding[],
): Array<{
  rule: string;
  severity: "error" | "warn" | "info";
  message: string;
  entityIds?: string[];
  hint?: string;
}> {
  return findings
    .filter((f) => f.severity !== "ok")
    .map((f) => ({
      rule: f.rule,
      severity: f.severity === "ok" ? "info" : f.severity,
      message: f.message,
      entityIds: f.entityIds,
      hint: f.hint,
    }));
}
