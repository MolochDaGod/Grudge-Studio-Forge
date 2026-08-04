# v0.4.2 — Forge AI orchestrator · Routing settings · real CDN builtins

**Live editor:** https://forge.grudge-studio.com/editor  
**Docs:** https://molochdagod.github.io/Grudge-Studio-Forge/  
**Orchestrator:** [docs/FORGE_AI_ORCHESTRATOR.md](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/docs/FORGE_AI_ORCHESTRATOR.md)  
**Changelog:** [CHANGELOG.md](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/CHANGELOG.md)

### Highlights

- **No model dropdown.** Forge AI picks the best available provider and fails over (fleet Groq/Together → Puter → BYOK → Ollama).
- **Improve the system yourself** via **⚙ Routing**: custom system prompt, allowed APIs, offline / prefer Ollama, auto-start + Ollama URL check.
- **Builtin meshes are real GLBs again** — R2 CDN + edge proxy; no more HTML-as-GLB wireframe boxes.

### Added

| Item | Detail |
|------|--------|
| Orchestrator | Intent chips, knowledge packs, `buildFailoverChain` / `probeRouting` |
| System prompt | Optional user prompt appended every turn (SI / CDN policy protected) |
| Allowed APIs | Per-provider allowlist for failover |
| Ollama options | Offline only, prefer when running, auto-start, URL + Start/check |
| Settings store | `localStorage` key `grudge.ai.userSettings.v1` |

### Fixed

| Issue | Fix |
|-------|-----|
| Library assets looked like shapes / wireframe | Builtin path → `assets.grudge-studio.com` / Worker `/builtin` → R2 |

### Deploy mechanisms

| Path | Mechanism |
|------|-----------|
| SPA | GHA **Deploy Forge SPA** → Vercel prebuilt → `grudge-gameforge-web` |
| Free AI / catalog | `cd workers/forge-free-ai && wrangler deploy` |
| Edge SPA proxy | `cd workers/gameforge-web && wrangler deploy` |

### Smoke

```bash
node scripts/smoke-forge-prod.mjs
# hard-refresh editor (Ctrl+Shift+R) after SPA deploy
```

Open AI Worker → **⚙ Routing** to set prompt / APIs / Ollama.
