/**
 * Physics debug gate for R3F <Physics debug={…}>.
 * No @grudge-studio/* import — safe on Vercel SPA without monorepo link.
 *
 * Enable: ?physicsDebug=1  or  localStorage grudge_physics_debug=1
 */
export function forgePhysicsDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("physicsDebug") === "1" || q.get("physics_debug") === "1") return true;
    if (localStorage.getItem("grudge_physics_debug") === "1") return true;
  } catch {
    /* private mode / SSR */
  }
  return false;
}
