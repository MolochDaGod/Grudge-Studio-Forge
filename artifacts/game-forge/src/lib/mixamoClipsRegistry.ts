import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { create } from "zustand";
import { extendGltfLoader } from "./gltfLoaderConfig";
import { isMixamoSkeleton } from "./mixamoBoneRemap";
import { retargetMixamoGltf } from "./animationRetarget";

/**
 * Project-scoped Mixamo clip pack registry.
 *
 * Why this is a separate module: the AssetBrowser drop-zone for Mixamo
 * GLBs needs to (a) verify the file is actually Mixamo, (b) make the
 * clips inside it available to every character of every race in the
 * project at runtime, and (c) survive page reloads. Doing all three
 * inline in EntityRenderer or AssetBrowser would couple two unrelated
 * subsystems. This module owns the source-of-truth list and provides
 * one tiny zustand store plus one async loader.
 *
 * Persistence: per-project source URL list is stored in `localStorage`
 * under `grudge.mixamo.<projectId>` as a JSON array of strings. We
 * picked localStorage over the server-side `assets` table for two
 * reasons: (1) avoids a schema migration just to ship the MVP, and
 * (2) the source URLs already live in the assets table — this only
 * tracks WHICH of those rows the user opted into as Mixamo clip packs.
 * If the underlying asset is deleted, the URL becomes a 404 on next
 * load and the registry silently drops it (caught + logged in the
 * loader).
 *
 * Runtime flow:
 *   1. AssetBrowser button → `useMixamoRegistry.getState().add(url)`
 *   2. Store change triggers `loadAndRetargetSource(url)` — loads
 *      the source GLB once, verifies the skeleton, caches the parsed
 *      `gltf` (scene + animations) in a module-level Map.
 *   3. EntityRenderer's `useRetargetedClips(targetScene)` subscribes
 *      to the store + the source-cache version, computes retargeted
 *      clips for the entity's target scene via `retargetMixamoGltf`
 *      (which itself caches per (clip, targetScene)), and returns
 *      them. LoadedModel concatenates these in front of the
 *      synthesized clips so the resolver-priority "retargeted >
 *      baked > synthesized" is preserved.
 */

const STORAGE_PREFIX = "grudge.mixamo.";

function storageKey(projectId: number | null | undefined): string | null {
  if (projectId == null) return null;
  return `${STORAGE_PREFIX}${projectId}`;
}

function readPersisted(projectId: number | null | undefined): string[] {
  // Defensive: localStorage access throws in private-mode Safari + on
  // SSR. The registry is purely additive (a load failure means clips
  // don't appear), so swallow + log without crashing the editor.
  const k = storageKey(projectId);
  if (!k) return [];
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writePersisted(projectId: number | null | undefined, urls: string[]): void {
  const k = storageKey(projectId);
  if (!k) return;
  try {
    window.localStorage.setItem(k, JSON.stringify(urls));
  } catch {
    // Quota / privacy mode — non-fatal.
  }
}

interface RegistryState {
  /** Currently-active project. Null when no project is loaded; the
   *  store ignores add/remove calls in that case so background
   *  React effects mounting before project hydration don't write
   *  to a phantom key. */
  projectId: number | null;
  /** Source URLs the user has opted in as Mixamo clip packs. Order
   *  preserved so the AssetBrowser can show them in registration
   *  order, but uniqueness is enforced via Set semantics in
   *  `add`/`remove`. */
  sources: string[];
  /** Monotonic counter bumped any time the set of *available*
   *  retargeted clips for this project changes. Two triggers:
   *    (a) a source GLB finishes loading + parsing (so a previously
   *        unavailable clip pack becomes available), and
   *    (b) the active set of source URLs changes (add/remove/
   *        setProject) — including same-length project switches
   *        where the URL identity changes but the count does not.
   *
   *  Consumers (`LoadedModel`) MUST depend on this version, not on
   *  the sources array length, because (b) would otherwise be
   *  invisible to a length-only memo dependency. */
  loadVersion: number;

  setProject: (projectId: number | null) => void;
  add: (url: string) => void;
  remove: (url: string) => void;
}

export const useMixamoRegistry = create<RegistryState>((set, get) => ({
  projectId: null,
  sources: [],
  loadVersion: 0,
  setProject: (projectId) => {
    const persisted = readPersisted(projectId);
    // Bump loadVersion on EVERY project switch — even when both
    // projects had cached, identical-length source lists, the
    // *identity* of the active sources has changed and any
    // already-mounted LoadedModel must recompute its retargeted
    // clip set against the new list.
    set((s) => ({
      projectId,
      sources: persisted,
      loadVersion: s.loadVersion + 1,
    }));
    // Kick off async load for every persisted source so the next
    // LoadedModel render finds them in the cache. Cached/in-flight
    // URLs short-circuit harmlessly inside loadAndRetargetSource.
    for (const url of persisted) {
      void loadAndRetargetSource(url);
    }
  },
  add: (url) => {
    const { projectId, sources } = get();
    if (projectId == null) return;
    if (sources.includes(url)) return;
    const next = [...sources, url];
    writePersisted(projectId, next);
    // Bump loadVersion alongside the sources change so LoadedModel
    // recomputes immediately. The async load will bump again when
    // the parsed clips actually become available — safe to bump
    // twice; recomputation is cheap (cache hit on retargetMixamoGltf).
    set((s) => ({ sources: next, loadVersion: s.loadVersion + 1 }));
    void loadAndRetargetSource(url);
  },
  remove: (url) => {
    const { projectId, sources } = get();
    if (projectId == null) return;
    if (!sources.includes(url)) return;
    const next = sources.filter((u) => u !== url);
    writePersisted(projectId, next);
    // Bump loadVersion so consumers immediately drop the clips
    // contributed by the removed source. The source cache stays
    // populated (cheap) in case the user re-adds it.
    set((s) => ({ sources: next, loadVersion: s.loadVersion + 1 }));
  },
}));

/** Cached parsed source GLBs keyed by URL. Module-level (not in the
 *  zustand store) because parsed `gltf.scene` objects aren't structurally
 *  cloneable and zustand's devtools middleware would explode. Survives
 *  store reset on project switch — the URL is the cache key, so a
 *  re-added project picks up its sources for free. */
interface SourceEntry {
  scene: THREE.Object3D;
  clips: readonly THREE.AnimationClip[];
}
const SOURCE_CACHE = new Map<string, SourceEntry>();
const IN_FLIGHT = new Map<string, Promise<SourceEntry | null>>();

/** True when the URL has been loaded AND verified as a Mixamo source.
 *  Used by the AssetBrowser to render a "Loaded" / "Pending" badge. */
export function isSourceLoaded(url: string): boolean {
  return SOURCE_CACHE.has(url);
}

/** Load a source GLB through the shared loader config, verify it's
 *  Mixamo, and cache it. Idempotent: concurrent calls share one
 *  promise; a second call after success resolves immediately from
 *  cache. Returns `null` when the GLB isn't Mixamo or the load fails.
 *
 *  Side-effect: on first successful load of a URL, bumps the store's
 *  `loadVersion` so subscribed `LoadedModel` instances recompute
 *  their retargeted clip set. We do this from inside the load
 *  resolver (rather than via a caller-supplied callback) so that
 *  every concurrent caller — including ones that arrived while a
 *  load was already in-flight — observes the new clips: the previous
 *  callback-per-call design dropped bumps when multiple callers
 *  shared the same in-flight promise. */
export function loadAndRetargetSource(url: string): Promise<SourceEntry | null> {
  const cached = SOURCE_CACHE.get(url);
  if (cached) return Promise.resolve(cached);
  const inFlight = IN_FLIGHT.get(url);
  if (inFlight) return inFlight;

  const loader = new GLTFLoader();
  extendGltfLoader(loader);
  const promise = new Promise<SourceEntry | null>((resolve) => {
    loader.load(
      url,
      (gltf) => {
        if (!isMixamoSkeleton(gltf.scene)) {
          IN_FLIGHT.delete(url);
          resolve(null);
          return;
        }
        const entry: SourceEntry = { scene: gltf.scene, clips: gltf.animations };
        SOURCE_CACHE.set(url, entry);
        IN_FLIGHT.delete(url);
        // Single bump per successful load — observed by every
        // caller via store subscription.
        useMixamoRegistry.setState((s) => ({ loadVersion: s.loadVersion + 1 }));
        resolve(entry);
      },
      undefined,
      () => {
        IN_FLIGHT.delete(url);
        resolve(null);
      },
    );
  });
  IN_FLIGHT.set(url, promise);
  return promise;
}

/** Detect whether a URL points at a Mixamo file WITHOUT registering
 *  it. Used by the AssetBrowser button to show a "Detect" affordance
 *  on .glb rows the user hasn't opted into yet. Returns the parsed
 *  source entry on success (so we don't redo the load if the caller
 *  immediately registers it), or null on failure. */
export function detectMixamoSource(url: string): Promise<SourceEntry | null> {
  return loadAndRetargetSource(url);
}

/** Return retargeted Mixamo clips for the given target scene, drawn
 *  from every loaded source in the registry. Pure with respect to
 *  inputs (no DOM / no THREE mutation); the underlying retargeter
 *  caches per (sourceClip, targetScene) so this stays O(1) after
 *  warmup.
 *
 *  Returns an empty array if no sources are loaded yet — caller is
 *  expected to merge this in front of the synthesized clips and let
 *  the unified-clip resolver handle name collisions. */
export function getRetargetedClipsForTarget(targetScene: THREE.Object3D): THREE.AnimationClip[] {
  const sources = useMixamoRegistry.getState().sources;
  const out: THREE.AnimationClip[] = [];
  for (const url of sources) {
    const entry = SOURCE_CACHE.get(url);
    if (!entry) continue;
    const retargeted = retargetMixamoGltf({
      sourceClips: entry.clips,
      sourceScene: entry.scene,
      targetScene,
    });
    out.push(...retargeted);
  }
  return out;
}

/** Test-only reset. Vitest's module isolation handles most of this
 *  for us; this hook is just for the rare suite that wants to nuke
 *  caches mid-test. */
export function __resetMixamoRegistryForTests(): void {
  SOURCE_CACHE.clear();
  IN_FLIGHT.clear();
  useMixamoRegistry.setState({ projectId: null, sources: [], loadVersion: 0 });
}
