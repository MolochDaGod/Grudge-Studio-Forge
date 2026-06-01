---
name: Web asset pipeline (converters, zip, R2)
description: Non-obvious constraints for in-browser model conversion, ZIP import, and the R2 storage layer
---

- **FBXLoader needs `fflate` as a DIRECT dep of game-forge.** `three/examples/jsm/loaders/FBXLoader.js` imports `fflate`, but pnpm does NOT hoist it into `artifacts/game-forge/node_modules`. Without `fflate` in game-forge's own `devDependencies` the FBX lazy-import fails *at runtime only* — typecheck still passes, so it's easy to miss. The same `fflate` powers `lib/zipImport.ts`.
  **Why:** pnpm strict node_modules; transitive deps of `three` aren't visible to app code.
  **How to apply:** if you add another `three/examples` loader, check whether it pulls a transitive dep (e.g. `fflate`, `draco3d`) and add it directly.

- **R2 env-var "duplication" is intentional fallback, not a bug.** `r2Storage.ts` reads `R2_BUCKET_ASSETS || OBJECT_STORAGE_BUCKET` and `OBJECT_STORAGE_PUBLIC_URL || OBJECT_STORAGE_PUBLIC_R2_URL` on purpose (canonical name + legacy compat). All R2 secrets are configured and the connection is healthy (boot logs show template sync; `/api/templates` → 200). Don't "fix" R2 by collapsing these.

- **In-browser model conversion all routes through one exporter.** `converters.ts` `objectToGlbFile()` is the single GLTFExporter path for obj/fbx/stl; pass FBX clips via the exporter's `animations` option to preserve them. `standardizeMaterials()` keeps existing PBR materials + texture maps, else falls back to brand gold `0xd4af37`.
