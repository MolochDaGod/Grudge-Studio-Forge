# v0.4.1 — Viewport free while selected · sky shaders · uMMORPG catalogs

**Live editor:** https://forge.grudge-studio.com/editor  
**Docs:** https://molochdagod.github.io/Grudge-Studio-Forge/  
**Changelog:** [CHANGELOG.md](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/CHANGELOG.md)

### Highlights

- **Selecting an entity no longer hard-locks the viewport camera.** Pan and zoom stay free; LMB orbit only yields to the transform gizmo while you are actively dragging a handle.
- **Sky starfield / weather GLSL** — fixes three.js r185 `WebGLProgram` error (`uTime` precision mismatch between vertex and fragment).
- **uMMORPG extract catalogs** ship with the SPA for placeables and skills (CDN mesh + skill defs).

### Fixed

| Issue | Fix |
|-------|-----|
| Select something → cannot move camera | `OrbitGizmoArbitration` + gizmo unmount cleanup; never leave `OrbitControls.enabled === false` |
| Console: `Precisions of uniform 'uTime' differ…` | `CelestialSky` / `WeatherFx` both stages `precision highp float` |
| Fast assets stamp drift | Dual catalog timestamps refreshed for SPA + free-ai worker |

### Added

- `public/data/ummorpg-placeables.json`, `ummorpg-skills.json`
- `src/lib/ummorpgCatalog.ts` — local `/data/*` then ObjectStore
- `docs/UMMORPG_EXTRACT_FOR_FORGE.md`

### Deploy mechanisms

| Path | Mechanism |
|------|-----------|
| SPA | GHA **Deploy Forge SPA** → Vercel prebuilt → `grudge-gameforge-web` |
| Free AI / catalog | `cd workers/forge-free-ai && wrangler deploy` |
| Edge SPA proxy | `cd workers/gameforge-web && wrangler deploy` |

### Smoke

```bash
node scripts/smoke-forge-prod.mjs
# expect 12/12 on https://forge.grudge-studio.com
```

Hard-refresh the editor (Ctrl+Shift+R) after deploy so the browser drops the old JS chunk.
