import { Suspense, lazy, useMemo } from "react";
import { useViewportTabs, type ViewportTab } from "@/store/viewportTabs";
import {
  RiggingSurface,
  AnimationSurface,
  ConvertSurface,
} from "@/editor/surfaces/PlaceholderSurface";

/**
 * Routes the active tab to its surface component.
 *
 * Mounting model:
 *  - The Scene tab is **always mounted** but visually hidden when not
 *    active. The main scene Canvas owns expensive transient state — orbit
 *    camera, drei `<Stats>` accumulators, post-processing pipelines —
 *    that we don't want to throw away every time the user peeks at a
 *    model viewer tab. Hiding via `display:none` keeps WebGL alive and
 *    only one extra context exists at a time (well under Chrome's ~16
 *    cap).
 *  - All other tabs (model / prefab / rigging / animation / convert) are
 *    mounted **only when active**. They are file-session viewers — losing
 *    a fresh camera angle on a model preview is a non-issue, and only one
 *    ever runs at a time so we never accumulate WebGL contexts.
 *
 * Honest claim: opening five model tabs gives you five **persisted file
 * sessions** with one **live renderer** (the active one). When you click a
 * different model tab the previous model surface unmounts and a new one
 * mounts. The Scene tab is the lone exception — it stays warm.
 */

const Viewport = lazy(() =>
  import("@/editor/viewportPreload").then((m) => ({ default: m.Viewport })),
);
const ModelSurface = lazy(() =>
  import("@/editor/surfaces/ModelSurface").then((m) => ({
    default: m.ModelSurface,
  })),
);
const PrefabPreviewSurface = lazy(() =>
  import("@/editor/surfaces/PrefabPreviewSurface").then((m) => ({
    default: m.PrefabPreviewSurface,
  })),
);
const UIEditorSurface = lazy(() =>
  import("@/editor/UIEditorSurface").then((m) => ({
    default: m.UIEditorSurface,
  })),
);

function SurfaceFallback({ label }: { label: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-background grid-pattern">
      <div className="text-xs font-mono text-muted-foreground animate-pulse">
        {label}
      </div>
    </div>
  );
}

function renderTransientSurface(tab: ViewportTab) {
  switch (tab.payload.kind) {
    case "scene":
      // Scene is rendered separately, always-mounted. This branch is
      // only reachable if a malformed tab claims kind=scene; render
      // nothing so we don't double-mount the heavy viewport.
      return null;
    case "model":
      return (
        <Suspense fallback={<SurfaceFallback label="Loading model viewer…" />}>
          <ModelSurface payload={tab.payload.data} />
        </Suspense>
      );
    case "prefab":
      return (
        <Suspense fallback={<SurfaceFallback label="Loading prefab…" />}>
          <PrefabPreviewSurface payload={tab.payload.data} />
        </Suspense>
      );
    case "rigging":
      return <RiggingSurface payload={tab.payload.data} />;
    case "animation":
      return <AnimationSurface payload={tab.payload.data} />;
    case "convert":
      return <ConvertSurface payload={tab.payload.data} />;
    case "ui-screen":
      return (
        <Suspense fallback={<SurfaceFallback label="Loading UI editor…" />}>
          <UIEditorSurface payload={tab.payload.data} tabId={tab.id} />
        </Suspense>
      );
  }
}

export function ViewportHost() {
  const tabs = useViewportTabs((s) => s.tabs);
  const activeId = useViewportTabs((s) => s.activeId);
  const active = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? tabs[0],
    [tabs, activeId],
  );
  const sceneActive = active?.kind === "scene";

  return (
    <div className="w-full h-full relative">
      {/* Scene tab: always mounted, hidden when another tab is active.
          Keeps the main editor's renderer + camera + post-FX warm. */}
      <div
        className="absolute inset-0"
        style={{ visibility: sceneActive ? "visible" : "hidden" }}
        aria-hidden={!sceneActive}
      >
        <Suspense fallback={<SurfaceFallback label="Loading scene viewport…" />}>
          <Viewport />
        </Suspense>
      </div>

      {/* Transient surfaces: mounted only while their tab is active.
          The `key` forces a clean teardown + rebuild between distinct
          file-session tabs so React never reuses a Canvas DOM node
          across two unrelated models. */}
      {!sceneActive && active ? (
        <div key={active.id} className="absolute inset-0">
          {renderTransientSurface(active)}
        </div>
      ) : null}
    </div>
  );
}
