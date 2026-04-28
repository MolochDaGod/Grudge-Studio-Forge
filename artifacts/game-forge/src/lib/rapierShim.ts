/**
 * Vite alias target for `@dimforge/rapier3d-compat`.
 *
 * Why this exists:
 * `@react-three/rapier` (and our scripts inside the editor) hard-pin to the
 * `-compat` build of Rapier, which inlines its 1.5 MB WebAssembly binary as a
 * base64 string inside the JS module. That bloats the lazy `vendor-rapier`
 * chunk to ~2.2 MB minified — the heaviest single chunk in the editor —
 * because every byte of WASM is shipped through the JS parser even though it
 * is never read until the user presses Play.
 *
 * The non-`compat` build (`@dimforge/rapier3d`) ships the same API but loads
 * its WASM via a sibling `.wasm` file. With `vite-plugin-wasm` +
 * `vite-plugin-top-level-await` Vite emits the binary as a separate, browser-
 * cacheable asset under `dist/public/assets/` and streams its compilation in
 * parallel with the rest of the chunk download.
 *
 * Vite's `resolve.alias` rewrites every import of `@dimforge/rapier3d-compat`
 * — including the one inside `react-three-rapier.esm.js` — to this shim, so
 * neither our code nor the third-party library has to change. We re-export
 * the entire surface of the non-compat package, plus a no-op `init()` that
 * preserves the compat call signature: in the non-compat build the module
 * promise itself resolves only after WASM instantiation, so by the time
 * any consumer can call `init()` the engine is already ready.
 */
export * from "@dimforge/rapier3d";

/**
 * Shim for `rapier3d-compat`'s explicit `init()` step. The non-compat build
 * has no equivalent — WASM is instantiated by the module's own top-level
 * await — so we expose a resolved promise to keep `await r.init()` callers
 * working without a code change.
 */
export async function init(): Promise<void> {
  // No-op: WASM is already instantiated by the time this module is imported.
}
