/**
 * Fleet bridge stubs for Forge (no hard @grudge-studio/* dependency).
 *
 * Optional packages may be installed via optionalDependencies (^0.3.0) when
 * published from GrudgeStudioNPM (quality system: bake, character, units,
 * animator, engine, deploy). Production SPA / CI must typecheck without them.
 *
 * Physics debug: always available via ./physicsDebugGate.
 * Deployment SSOT: ./gameDeployments (FLEET_GAME_DEFS, wargus workflow).
 */

export { forgePhysicsDebugEnabled } from "./physicsDebugGate";

export const FORGE_DEFAULT_ANIM_PACK = "sword_shield";

/**
 * Detect optional SDK at runtime only (never a static import — CI has no package).
 */
export async function grudgeStudioSdkAvailable(): Promise<boolean> {
  try {
    // Dynamic string keeps tsc from resolving the optional package.
    const id = ["@", "grudge-studio", "/", "sdk"].join("");
    await import(/* @vite-ignore */ id);
    return true;
  } catch {
    return false;
  }
}

/** Placeholder until optional @grudge-studio/assets is installed in this workspace. */
export async function forgePackSummary(animPackId = FORGE_DEFAULT_ANIM_PACK): Promise<{
  id: string;
  note: string;
} | null> {
  return {
    id: animPackId,
    note: "optional @grudge-studio/assets not required for SPA; use fleet monorepo for pack introspect",
  };
}
