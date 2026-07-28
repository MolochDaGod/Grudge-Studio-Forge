# Warlords scene ↔ Forge automation

**Foundry pattern SSOT:** character-viewer `docs/WARLORDS_ERA_SCENE_PATTERN.md`  
**Live scene:** https://character.grudge-studio.com/scene/warlords  
**Forge:** https://forge.grudge-studio.com  

## Intent

Automate and streamline Forge so **baked, UUID-registered, game-ready prefabs** land in the Warlords airship scene without inventing a second asset DB.

## Streamlined process

```
Drop FBX/GLB → Convert (meshopt/WebP) → Quality gates → Register UUID
  → R2 upload → Bind deck slot / .gfscene entity → Foundry/client loads CDN
```

| Step | Forge UI / API | Production out |
|------|----------------|----------------|
| Import | AssetDropZone | working mesh |
| Convert | assetConverter + meshopt | production GLB |
| Quality | SI · sRGB · idle/walk · feet | pass/fail meta |
| Register | ObjectStore / D1 | asset uuid + r2_key |
| Deploy binary | R2 CDN | assets.grudge-studio.com |
| Bind scene | Prefab spawn on anchors | airship crew slot |

## Access to baked resources

| Resource | Key / path |
|----------|------------|
| Airship env | `models/warlords/foundry/warlords_crew_scene.glb` |
| grudge6 kits | `models/grudge6/WK_*.glb` (etc.) + Foundry `/assets/...` |
| Baked anims | CDN `/anims/baked` packs |
| HUD icons | R2 icons + ObjectStore |

## Open scene from Forge

- Embed: `https://character.grudge-studio.com/scene/warlords?embed=1`  
- Descriptor: Foundry sets `window.__GRUDGE_ERA_SCENE__` (schema `grudge.gfscene.handoff/v1`)  

## Database share

Player characters remain **Railway UUIDs**. Forge never becomes character SSOT.  
Definitions = ObjectStore. Binaries = R2.

## Prefab gates (must all pass)

uuid_stable · si_height_1_8m · srgb_maps · loco_idle_walk · root_motion_stripped · feet_grounded · shadows · era_tag_warlords · cdn_url

## Do / Don't

| Do | Don't |
|----|--------|
| One Warlords pattern first | Parallel era pipelines before Warlords is solid |
| R2 + Railway + ObjectStore | Replit / local-only as production |
| CommandStack edits in Forge | Silent scene mutations without undo |
| Foundry 4-circle HUD contract | Duplicate select UIs |
