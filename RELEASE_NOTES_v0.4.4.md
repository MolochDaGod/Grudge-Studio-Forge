# v0.4.4 — Pull child meshes · pack parent/child · Super Terrain

**Live editor:** https://forge.grudge-studio.com/editor  
**Docs:** https://molochdagod.github.io/Grudge-Studio-Forge/  
**Changelog:** [CHANGELOG.md](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/CHANGELOG.md)  
**Info catalog:** https://forge.grudge-studio.com/catalog/forge-editor.json

### Highlights

- **Every mesh in an asset GLB becomes a real entity.** Pack root stays the parent; each child can move, script, edit physics, prefab, and deploy on its own.
- Nested meshes keep parent/child (lid stays on crate). Unparent with **Ctrl+P**.
- Play kits (skinned + bones) and map shells stay **one fused body**.
- Super Terrain worlds from the fleet Cloudflare catalog (harbor-atoll, volcanic-ridge, …).
- Editor: **F** frames only when asked, **G** ground snap, **H** hide, KTX2 bind.

### Added

| Item | Detail |
|------|--------|
| Mesh pull | `explodeGlbHierarchy` / `spawnModelAndPull` — isolate `model.subNode`, pack `childrenOnly` |
| Hierarchy | `pack` / `mesh` badges, breadcrumb `parent › child`, right-click **Pull child meshes** |
| Schema | `ModelComponent.subNode` + `childrenOnly` (`@workspace/scene-schema`) |
| Super Terrain | Fleet catalog `info.grudge-studio.com/api/v1/super-terrain.json` |
| Seeded camps | RTS enemy/ally camps with race-kit occupants |
| Player aliases | Windows `symlink=false` `@workspace/*` in `artifacts/player` |

### Changed

| Item | Detail |
|------|--------|
| Spawn Fast / catalog / drop | Auto-pulls child meshes after spawn |
| `spawn_fast_asset` | Returns `pulledMeshes` count |
| **F** | Frame selection only (no auto-frame) |
| Viewport hint | LMB orbit · RMB/MMB pan · W/E/R · F · G · H |

### Kept fused (do not pull)

Play kits (`SkinnedMesh` + ≥8 bones). Map shells (`pirate-islands`, `map-mistytown`, `map-cyberpunk`, `map-encampment`, `map-fort`, `map-underground`, `map-pirate`). Packs with more than 128 meshes stay fused so leftover geometry is not hidden.

### Deploy

| Path | Mechanism |
|------|-----------|
| SPA | Prebuilt `artifacts/game-forge/dist/public` → Vercel `grudge-studio-forge` → `forge.grudge-studio.com` |
| Fast catalog | `workers/forge-free-ai/fast-assets.json` (export from SPA) |
| Player | Bundled `player.html` (same EntityRenderer isolate path) |

### Smoke

```bash
pnpm run smoke:forge
# editor: spawn a Kenney / nature pack → hierarchy shows pack + mesh children
# play kit / pirate-islands → stays one entity
```
