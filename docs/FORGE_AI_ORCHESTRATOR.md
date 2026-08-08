---
layout: default
title: Forge AI Orchestrator
nav_order: 13
---

# Grudge Forge AI Orchestrator

**Live:** https://forge.grudge-studio.com/editor  
**Code:** `artifacts/game-forge/src/lib/ai/orchestrator/`

## Product rule

Users **do not pick models**. Forge AI picks the **best available** provider for the task and **fails over** automatically.

| Control | Where |
|---------|--------|
| Intent chips | Auto / Scene / Assets / Physics / Script / Fix / Deploy |
| Status chip | e.g. `Scene · Fleet · Llama 3.3 70B (Groq)` |
| ⚙ Routing | System prompt, allowed APIs, Ollama auto-start, BYOK keys |

## User settings (⚙ Routing)

Stored in `localStorage` (`grudge.ai.userSettings.v1`) via `lib/ai/aiUserSettings.ts`. UI: `editor/AiRoutingSettings.tsx`.

| Setting | Effect |
|---------|--------|
| **System prompt** | Appended every turn (cannot override SI units / CDN policy) |
| **Allowed APIs** | Allowlist for orchestrator failover (Groq, Together, Puter, BYOK, Ollama, …) |
| **Offline only** | Ollama chain only |
| **Prefer Ollama when running** | Local models first even when fleet is up |
| **Auto-start Ollama** | On panel open / offline: probe; desktop IPC if available; else show `ollama serve` |
| **Ollama URL** | Default `http://localhost:11434` + Start/check |
| **BYOK keys** | Existing FreeApiKeysPanel (unchanged) |

Browser cannot spawn processes. Desktop may expose `window.desktop.startOllama()`.

## Architecture

```
AIWorkerPanel → runOrchestratedConversation
  → classifyIntent
  → packsForIntent (knowledge)
  → loadAiUserSettings (prompt + allowlist)
  → buildFailoverChain (probe fleet / Puter / BYOK / Ollama)
  → runConversation (existing tool loop + CommandStack)
```

**Extend, never fork:** one `aiClient`, one `AI_TOOLS` registry, one free-ai Worker.

## Failover order (default · **Auto**)

Subject to **Usage mode**, **Allowed APIs**, and offline/prefer-Ollama flags:

1. **Grudge AI Legion** (`ai.grudge-studio.com` via `/api/free-ai/chat?provider=grudge-ai`) — needs Grudge ID JWT or worker `GRUDGE_AI_KEY`  
2. Fleet Groq / Together (free-ai Worker secrets)  
3. Puter (signed-in user-pays)  
4. BYOK OpenRouter / Gemini / … (settings → Free API keys)  
5. Ollama (local)  
6. Error with Routing guidance  

Auth baseline: **Puter** for cloud FS/KV · **Grudge ID** for Legion + Railway bag.

## Knowledge packs

Injected by intent (max ~2 + core): three-r185, r3f-viewport, rapier, navmesh, gltf-import, vfx, scripts-js, blazor-hybrid, deploy-forge, fleet-assets.

## Related

- [Best practices]({% link best-practices.md %})
- [Hybrid C#]({% link HYBRID_CSHARP.md %})
- [three.js editor parity]({% link THREEJS_EDITOR_PARITY.md %})
