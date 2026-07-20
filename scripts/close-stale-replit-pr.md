# PR hygiene (Grudge-Studio-Forge)

## Open PR

| PR | Title | Branch | Status |
|----|--------|--------|--------|
| #4 | Replit main | `replit-main` → `main` | **Outdated** |

- `main` is **ahead** of Replit with production features (sky, AI tools, templates, deploy docs).
- Merge-tree check: **0 content conflicts** with current `main`, but history is parallel Replit noise.
- Recommendation: **close PR #4** without merge; cherry-pick only useful commits later if needed.

## Branch strategy

- **`main` only** for production.
- Do not use GitHub Pages `static.yml` (uploads whole repo) — SPA deploys via Vercel project `grudge-studio-forge` or R2 `forge-spa/`.

## Deploy path

1. Build thin SPA: `pnpm --filter @workspace/game-forge run build` (strips `public/builtin` → R2).
2. Deploy `artifacts/game-forge/dist/public` → Vercel `grudge-studio-forge`.
3. Point CF Worker `grudge-gameforge-web` **ORIGIN** at `https://grudge-studio-forge.vercel.app`  
   **or** attach domain `forge.grudge-studio.com` to that Vercel project.
