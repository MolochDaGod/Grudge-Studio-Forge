import { create } from "zustand";
import { nanoid } from "nanoid";

/**
 * Multi-viewport tab system for Grudge Studio Forge.
 *
 * Each tab is an independent viewer surface — opening a model, prefab,
 * rigging session, animation editor, or converter does NOT mutate any
 * other tab. The "scene" tab is special: it is always the first tab and
 * cannot be closed; it backs the main editor scene state in
 * `useEditor`. All other tab kinds carry their own self-contained payload
 * so each Canvas can mount/unmount in isolation.
 *
 * Why a separate store (and not part of `useEditor`)?
 *  - The main editor store is already large and is mutated by hot paths
 *    (TransformControls drags, scripts at 60 fps). Tab state changes are
 *    rare and shouldn't force every selector subscriber to re-evaluate.
 *  - Tabs are a UI-shell concern; the scene store should remain agnostic
 *    to whether the scene is being shown in tab #0, tab #3, or no tab at
 *    all (e.g. while a model viewer tab is active).
 */

export type ViewportTabKind =
  | "scene"
  | "model"
  | "prefab"
  | "rigging"
  | "animation"
  | "convert"
  | "ui-screen";

/** Payload for a model-viewer tab. The blob URL keeps a dropped file alive
 *  for the lifetime of the tab without re-uploading; `assetUrl` is set when
 *  the source is an already-uploaded asset (object storage). One of the two
 *  is always present. */
export interface ModelTabPayload {
  /** Display name (from the original file). */
  name: string;
  /** Object-URL for an in-memory file (revoked when the tab closes). */
  blobUrl?: string;
  /** Remote URL for an asset that already lives in object storage. */
  assetUrl?: string;
  /** Lowercased extension without the dot (e.g. "glb", "gltf", "fbx"). */
  ext: string;
  /** Bytes — useful for the inspector header. */
  size?: number;
}

export interface PrefabTabPayload {
  prefabId: number;
  prefabName: string;
}

export interface RiggingTabPayload {
  /** The model the rig is being authored for. Same shape as model tab. */
  source: ModelTabPayload;
}

export interface AnimationTabPayload {
  source: ModelTabPayload;
}

export interface ConvertTabPayload {
  /** Files queued for batch conversion in this tab. */
  files: { name: string; ext: string; blobUrl: string; size: number }[];
}

/** Payload for a 2D UI Screen editor tab. The screen itself lives in the
 *  `useUIScreens` store keyed by project + screenId; this payload only
 *  carries the lookup keys + a snapshot of the name for the tab title.
 *  Renaming a screen via the inspector should also call `renameTab()`. */
export interface UIScreenTabPayload {
  screenId: string;
  screenName: string;
  /** `number` for a real DB project, `"global"` for screens authored
   *  before any project is open. Mirrors `ProjectKey` in `store/uiScreens`. */
  project: number | "global";
}

export type ViewportTabPayload =
  | { kind: "scene" }
  | { kind: "model"; data: ModelTabPayload }
  | { kind: "prefab"; data: PrefabTabPayload }
  | { kind: "rigging"; data: RiggingTabPayload }
  | { kind: "animation"; data: AnimationTabPayload }
  | { kind: "convert"; data: ConvertTabPayload }
  | { kind: "ui-screen"; data: UIScreenTabPayload };

export interface ViewportTab {
  id: string;
  /** Mirror of `payload.kind` for ergonomic access in selectors. */
  kind: ViewportTabKind;
  title: string;
  payload: ViewportTabPayload;
  /** Scene tab cannot be closed (it is the editor's home). */
  closable: boolean;
}

interface ViewportTabsState {
  tabs: ViewportTab[];
  activeId: string;

  /** Open a new tab and activate it. Returns the new tab id. If a tab with
   *  the same kind+payload key already exists (e.g. opening the same prefab
   *  twice), focuses the existing tab instead of duplicating. */
  openTab: (
    payload: ViewportTabPayload,
    opts?: { title?: string; activate?: boolean; dedupeKey?: string },
  ) => string;
  /** Close a tab. If the active tab closes, focus falls back to the scene
   *  tab. The scene tab itself can never be closed. Revokes any blob URLs
   *  the tab held so we don't leak memory across long sessions. */
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  renameTab: (id: string, title: string) => void;
}

const SCENE_TAB_ID = "scene-root";

function defaultTitle(p: ViewportTabPayload): string {
  switch (p.kind) {
    case "scene":
      return "Scene";
    case "model":
      return p.data.name;
    case "prefab":
      return `Prefab: ${p.data.prefabName}`;
    case "rigging":
      return `Rig: ${p.data.source.name}`;
    case "animation":
      return `Anim: ${p.data.source.name}`;
    case "convert":
      return p.data.files.length
        ? `Convert (${p.data.files.length})`
        : "Convert";
    case "ui-screen":
      return p.data.screenName || "UI Screen";
  }
}

/** Stable key for dedupe — tabs that point at the same underlying resource
 *  collapse so we don't spawn 12 windows of the same prefab. */
function defaultDedupeKey(p: ViewportTabPayload): string | null {
  switch (p.kind) {
    case "scene":
      return "scene";
    case "prefab":
      return `prefab:${p.data.prefabId}`;
    case "model":
      return p.data.assetUrl ? `model:asset:${p.data.assetUrl}` : null;
    case "rigging":
      return p.data.source.assetUrl
        ? `rigging:asset:${p.data.source.assetUrl}`
        : null;
    case "animation":
      return p.data.source.assetUrl
        ? `animation:asset:${p.data.source.assetUrl}`
        : null;
    case "convert":
      return null;
    case "ui-screen":
      return `ui-screen:${String(p.data.project)}:${p.data.screenId}`;
  }
}

/**
 * Revoke any blob URLs the payload owns.
 *
 * NOTE: This is deferred to a macrotask. When the user closes a tab, the
 * surface React-component is still mounted in the same render cycle —
 * GLTFLoader / fetch may still hold a live request against the blob URL.
 * Revoking synchronously cancels that request and surfaces a load error.
 * Pushing the revoke to the next macrotask gives React a chance to unmount
 * the surface (which aborts its loaders cleanly) before the URL goes away.
 *
 * For dedupe-hit cleanup (`openTab` discarding a fresh blob), we revoke
 * synchronously because no surface ever consumed it.
 */
function scheduleRevoke(p: ViewportTabPayload, immediate = false) {
  const urls: string[] = [];
  if (p.kind === "model" && p.data.blobUrl) urls.push(p.data.blobUrl);
  else if (
    (p.kind === "rigging" || p.kind === "animation") &&
    p.data.source.blobUrl
  )
    urls.push(p.data.source.blobUrl);
  else if (p.kind === "convert")
    for (const f of p.data.files) urls.push(f.blobUrl);

  if (urls.length === 0) return;
  const revoke = () => {
    for (const u of urls) URL.revokeObjectURL(u);
  };
  if (immediate) revoke();
  else setTimeout(revoke, 0);
}

export const useViewportTabs = create<ViewportTabsState>((set, get) => ({
  tabs: [
    {
      id: SCENE_TAB_ID,
      kind: "scene",
      title: "Scene",
      payload: { kind: "scene" },
      closable: false,
    },
  ],
  activeId: SCENE_TAB_ID,

  openTab: (payload, opts = {}) => {
    const dedupeKey = opts.dedupeKey ?? defaultDedupeKey(payload);
    if (dedupeKey) {
      const existing = get().tabs.find(
        (t) => (defaultDedupeKey(t.payload) ?? "") === dedupeKey,
      );
      if (existing) {
        // Free the freshly-allocated blob URL the caller may have created
        // for a dedupe-hit so it doesn't leak. Safe to revoke synchronously
        // because no surface has consumed it yet.
        scheduleRevoke(payload, /* immediate */ true);
        if (opts.activate !== false) set({ activeId: existing.id });
        return existing.id;
      }
    }

    const id = nanoid();
    const tab: ViewportTab = {
      id,
      kind: payload.kind,
      title: opts.title ?? defaultTitle(payload),
      payload,
      closable: payload.kind !== "scene",
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeId: opts.activate === false ? s.activeId : id,
    }));
    return id;
  },

  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !tab.closable) return;
    scheduleRevoke(tab.payload);
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id
          ? (tabs[tabs.length - 1]?.id ?? SCENE_TAB_ID)
          : s.activeId;
      return { tabs, activeId };
    });
  },

  setActive: (id) => {
    if (get().tabs.some((t) => t.id === id)) set({ activeId: id });
  },

  renameTab: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    })),
}));

/** Stable id of the scene tab so callers can navigate back to it. */
export const SCENE_TAB = SCENE_TAB_ID;
