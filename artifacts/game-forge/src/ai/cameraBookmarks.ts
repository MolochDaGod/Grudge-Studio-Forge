/**
 * Lightweight in-memory store for named camera bookmarks. Used by the
 * AI design tools (`frame_camera`) so the model can recall a previously
 * framed shot, restore it, or list available bookmarks. Lives outside the
 * editor zustand store on purpose — bookmarks are a non-undoable,
 * non-persisted convenience, not part of the scene document.
 */

export interface CameraBookmark {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  /** Optional single-line description recorded by the AI. */
  note?: string;
  /** Wall-clock ms when this bookmark was set. */
  createdAt: number;
}

const bookmarks = new Map<string, CameraBookmark>();

export function setCameraBookmark(b: Omit<CameraBookmark, "createdAt">): CameraBookmark {
  const entry: CameraBookmark = { ...b, createdAt: Date.now() };
  bookmarks.set(b.name, entry);
  return entry;
}

export function getCameraBookmark(name: string): CameraBookmark | undefined {
  return bookmarks.get(name);
}

export function listCameraBookmarks(): CameraBookmark[] {
  return Array.from(bookmarks.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function removeCameraBookmark(name: string): boolean {
  return bookmarks.delete(name);
}

/** Test-only — clear the entire store. */
export function __resetCameraBookmarksForTests(): void {
  bookmarks.clear();
}
