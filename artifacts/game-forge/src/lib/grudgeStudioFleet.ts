/**
 * Fleet bridge for @grudge-studio/* (optional).
 *
 * Production SPA does **not** require monorepo file: installs.
 * Use npm optionalDependencies ^0.2.0 when packages are published.
 * Physics debug: always available via ./physicsDebugGate (no SDK).
 *
 * Host owns: R3F scene, Rapier world, camera.
 */

export { forgePhysicsDebugEnabled } from "./physicsDebugGate";

export const FORGE_DEFAULT_ANIM_PACK = "sword_shield";

/** True when optional @grudge-studio/sdk is resolvable at runtime */
export async function grudgeStudioSdkAvailable(): Promise<boolean> {
  try {
    await import("@grudge-studio/sdk");
    return true;
  } catch {
    return false;
  }
}

/**
 * Lazy pack summary — returns null if @grudge-studio/assets not installed.
 */
export async function forgePackSummary(animPackId = FORGE_DEFAULT_ANIM_PACK): Promise<{
  id: string;
  label?: string;
  note: string;
} | null> {
  try {
    const assets = await import("@grudge-studio/assets");
    const getAnimPack = (assets as { getAnimPack?: (id: string) => { id: string; label?: string; skeleton?: string; bakeStatus?: string; skills?: { skillId: string }[]; clips?: Record<string, unknown> } }).getAnimPack;
    if (!getAnimPack) return { id: animPackId, note: "assets package missing getAnimPack" };
    const pack = getAnimPack(animPackId);
    return {
      id: pack.id,
      label: pack.label,
      note: "ok",
    };
  } catch {
    return null;
  }
}
