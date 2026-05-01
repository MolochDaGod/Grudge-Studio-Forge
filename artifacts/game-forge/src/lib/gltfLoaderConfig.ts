/**
 * Centralized GLTF loader extension — wires Meshopt + DRACO decoders into
 * any `GLTFLoader` instance so the engine can transparently load
 * compressed assets that ship at a fraction of the size of plain GLBs.
 *
 * Why this exists:
 *
 *   - Our `builtin/map-*.glb` files range from 10–44 MB uncompressed.
 *     Meshopt compression typically shrinks geometry buffers 5–10×; DRACO
 *     compresses geometry on the order of 4–8×. Wiring decoders once
 *     here means future re-exports (or any user-supplied compressed GLB)
 *     just work without per-callsite plumbing.
 *
 *   - Drei's `useGLTF` defaults to **meshopt off** in our pinned version,
 *     so we always pass `useGLTF(url, true, true, extendGltfLoader)`
 *     from EntityRenderer. The same `extendGltfLoader` function is used
 *     for our non-drei loader sites (`glbHierarchy.ts` SHARED_LOADER,
 *     `PlaceholderSurface`/`ModelSurface` `useLoader(GLTFLoader, ...)`).
 *
 *   - Decoders are singletons: creating one DRACO decoder spawns Web
 *     Workers + downloads ~200KB of WASM. We share a single instance
 *     across every loader to keep the cost paid once per session.
 *
 * Pattern documented in
 * `.agents/skills/animation-and-skinned-meshes/SKILL.md` (cached GLB
 * sharing) and the broader Three.js performance guidance.
 */

import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/** gstatic-hosted DRACO decoder. Has been stable for 5+ years; no need
 *  to bundle our own copy unless we ever go offline-first. */
const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/v1/decoders/";

let _dracoLoader: DRACOLoader | null = null;

function getDracoLoader(): DRACOLoader {
  if (_dracoLoader) return _dracoLoader;
  _dracoLoader = new DRACOLoader();
  _dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  // `setDecoderConfig({ type: 'js' })` would force the JS fallback;
  // default is WASM which is what we want for perf.
  return _dracoLoader;
}

/**
 * Attach Meshopt + DRACO decoders to a GLTFLoader instance. Idempotent —
 * safe to call multiple times on the same loader, the underlying decoder
 * setters just overwrite their references.
 *
 * Usage:
 *   - drei `useGLTF`:   `useGLTF(url, true, true, extendGltfLoader)`
 *   - bare GLTFLoader:  `extendGltfLoader(new GLTFLoader())`
 *   - `useLoader`:      `useLoader(GLTFLoader, url, extendGltfLoader)`
 */
export function extendGltfLoader(loader: GLTFLoader): void {
  loader.setDRACOLoader(getDracoLoader());
  // Meshopt's decoder exports a single object that exposes async `ready`
  // and `decodeGltfBuffer` — three's GLTFLoader detects the right shape
  // automatically.
  loader.setMeshoptDecoder(MeshoptDecoder);
}

/** Manually dispose decoders. Call this from a global teardown if you
 *  ever need to release the DRACO worker pool — typically not needed
 *  because the page lifecycle reclaims them. */
export function disposeGltfDecoders(): void {
  _dracoLoader?.dispose();
  _dracoLoader = null;
}
