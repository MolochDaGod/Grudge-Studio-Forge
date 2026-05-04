/** Module-scope gate shared between TransformControls' `dragging-changed`
 *  event and the various pointer handlers in Viewport.tsx that need to
 *  ignore the trailing click at the end of a gizmo drag.
 *
 *  Lives in its own module (rather than inside Viewport.tsx) so that
 *  Viewport.tsx exports only its React component — exporting a
 *  non-component value alongside a component breaks Vite's React Fast
 *  Refresh and forces a full reload that surfaces as
 *  "Failed to fetch dynamically imported module" + "Invalid hook call"
 *  in the editor.
 *
 *  150 ms is empirically enough to swallow the trailing event without
 *  noticeably delaying a real follow-up click on a different entity. */
export const gizmoDragGate = {
  active: false,
  releasedAt: 0,
};

export function isGizmoSwallowingClick(): boolean {
  if (gizmoDragGate.active) return true;
  return performance.now() - gizmoDragGate.releasedAt < 150;
}
