---
layout: default
title: Forge storage dual-write
nav_order: 17
---

# Forge editor storage — Puter + local backup (delivery on next use)

**Live:** https://forge.grudge-studio.com/editor  
**Code:** `lib/cloud/puterDataProvider.ts` · `projectStorage.ts`

## Law (no assumptions)

| Plane | Role |
|-------|------|
| **Local** localStorage + IndexedDB | **Always** written. Survives reload, Puter outage, guest mode. |
| **Puter** KV + FS `Grudge/forge/*` | Written when Puter signed-in. Cross-device cloud. |
| **Railway** | Player bag/characters only — **not** Forge scenes. |
| **D1 agent jobs** | Queue tickets only — **not** project bodies. |

## Write path

```
save scene / update index
  → localPayloadWrite / localJsonSet   (always)
  → Puter FS/KV                        (if isPuterSignedIn)
  → stamp grudge.forge.lastSaveMeta
```

## Read path

```
if Puter signed-in:
  try Puter first → on hit, refresh local backup
  merge indexes by id/updatedAt with local
else:
  local only
```

## Sign-in

`ensureDualStorageAfterPuterSignIn()`:

1. `syncLocalProjectsToPuterCloud` (local → Puter)  
2. Re-read all collection indexes (Puter → warm local)

Triggered after Puter login and Puter session restore on boot.

## AI tools

- `project_storage_status`  
- `migrate_local_projects_to_puter`  
- `cloud_save_project` (dual-writes local + Puter)

## Next visit checklist (user)

1. Hard-refresh editor  
2. Guest: projects still in local index  
3. Puter sign-in: cloud + local both present  
4. Save (Ctrl+S) once after this deploy to stamp dual-write  

## Smoke

```bash
# Edge still up
curl -sS https://forge.grudge-studio.com/api/free-ai/status
# Agent jobs complete
curl -sS -X POST https://forge.grudge-studio.com/api/agent/jobs \
  -H 'content-type: application/json' \
  -d '{"kind":"verify-scene","prompt":"smoke"}'
```
