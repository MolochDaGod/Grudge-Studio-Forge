---
layout: default
title: Releases
nav_order: 4
permalink: /releases/
description: Semver, GitHub Releases, and desktop vs SPA ship process for Forge.
---

# Releases

## Versioning (semver)

| Bump | When |
|---|---|
| **MAJOR** | Breaking editor/API for users |
| **MINOR** | Features (agent edge, scripts, projects) |
| **PATCH** | Fixes only |

Tags: `vX.Y.Z` (e.g. `v0.4.2`). Latest product notes: root `RELEASE_NOTES_v*.md` + `CHANGELOG.md`.

## SPA (primary product)

1. Merge to **`main`**.
2. GHA **Deploy Forge SPA** builds + uploads prebuilt to Vercel.
3. Edge Worker serves SPA within ~minutes (CDN cache: hard-refresh if needed).
4. No GitHub Release required for web-only changes — still document in `CHANGELOG.md`.

## Desktop (Electron)

1. Ensure `main` is green.
2. Update `CHANGELOG.md` + bump desktop package version if needed.
3. `git tag vX.Y.Z -m "vX.Y.Z"` and `git push origin vX.Y.Z`.
4. GHA **Release — Windows Desktop** (`release.yml`) builds NSIS via electron-builder.
5. Review **draft** Release → publish when installer is attached.

```bash
git checkout main
git pull
# edit CHANGELOG.md
git add CHANGELOG.md
git commit -m "release: v0.4.0"
git tag v0.4.0 -m "v0.4.0"
git push origin main --follow-tags
```

## GitHub Release notes template

```markdown
## Highlights
- …

## Added
- …

## Changed
- …

## Fixed
- …

## Deploy
- SPA: forge.grudge-studio.com (GHA → Vercel → CF Worker)
- Edge: free-ai / catalog / agent jobs
```

## Verify after publish

```bash
gh release list --limit 5
gh release view v0.4.0 --web
curl -sS https://forge.grudge-studio.com/__edge/health
```

Live: [Releases on GitHub](https://github.com/MolochDaGod/Grudge-Studio-Forge/releases).
