# uMMORPG → Forge validation

**Generated:** 2026-08-02T03:40:45.016Z  
**Unity vault (read-only):** `C:/Users/nugye/Desktop/FRESH GRUDGE/Assets/uMMORPG`  
**Live Forge:** https://forge.grudge-studio.com  

## What was validated into Forge source

| Artifact | Path |
|----------|------|
| Placeables JSON | `artifacts/game-forge/public/data/ummorpg-placeables.json` (118 items, 111 spawnable) |
| Skills JSON | `artifacts/game-forge/public/data/ummorpg-skills.json` (134 skills) |
| TS helpers | `artifacts/game-forge/src/lib/ummorpgCatalog.ts` |
| ObjectStore API | `ummorpg-placeables-for-forge.json`, `ummorpg-skills-for-forge.json` |
| Systems map | ObjectStore `assets/ummorpg-extract/systems-map.json` |
| C# reference | ObjectStore `assets/ummorpg-extract/scripts/core/` |
| Best practices | ObjectStore `docs/UMMORPG_TO_WARLORDS_BEST_PRACTICES.md` |

## How Forge should use this

1. **Placeables:** `fetchUmmorpgPlaceables()` → filter spawnable → `import_asset_from_url` / add_model_entity with `modelUrl` on assets CDN.
2. **Skills:** `fetchUmmorpgSkills()` → map to Warlords hotbar (weapon category folders: Skills Sword, Bow, etc.).
3. **Do not** load Mirror/NetworkManager into the browser — patterns only.
4. **Unity Safe Mode** is irrelevant to this catalog; regenerate from disk:

```bash
cd F:/GitHub/ObjectStore
node scripts/extract-ummorpg-for-warlords.mjs
node scripts/build-ummorpg-forge-catalog.mjs
node scripts/publish-static-json.mjs ummorpg-skills-for-forge ummorpg-placeables-for-forge ummorpg-extract-index
```

## Spawnable groups (sample)

Buildings / characters / vehicles / props from warlords entity CDN mesh status `cdn_ready`.

## Agent rules

- ROOT Unity extract: **Desktop\\FRESH GRUDGE** only  
- ROOT Forge: **F:\\GitHub\\Grudge-Studio-Forge**  
- DONE for placeable: modelUrl 200 + spawns in Forge  
- DONE for skill port: presses in Warlords client (separate slice)
