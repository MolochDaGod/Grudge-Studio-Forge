/**
 * Player-side stub for `@/lib/launchQueue`.
 *
 * The editor wires the browser's File System Access API "launch queue"
 * (drag-a-file-onto-the-installed-PWA) to its open-file flow. The player
 * has no project / file dialog, so we expose no-op shims that satisfy
 * the cross-imported module's call sites without dragging in any of the
 * editor's open-file UI machinery.
 */
export function consumeLaunchQueue(): void {
  /* no-op — the player never handles file launches */
}
export function isLaunchQueueSupported(): boolean {
  return false;
}
