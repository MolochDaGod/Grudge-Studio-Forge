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
| ⚙ Routing | Offline Ollama, BYOK keys (advanced) |

## Architecture

```
AIWorkerPanel → runOrchestratedConversation
  → classifyIntent
  → packsForIntent (knowledge)
  → buildFailoverChain (probe fleet / Puter / BYOK / Ollama)
  → runConversation (existing tool loop + CommandStack)
```

**Extend, never fork:** one `aiClient`, one `AI_TOOLS` registry, one free-ai Worker.

## Failover order (default)

1. Fleet Groq  
2. Fleet Together  
3. Puter (signed-in)  
4. BYOK OpenRouter / Gemini / …  
5. Ollama  
6. Error with Routing guidance  

## Knowledge packs

Injected by intent (max ~2 + core): three-r185, r3f-viewport, rapier, navmesh, gltf-import, vfx, scripts-js, blazor-hybrid, deploy-forge, fleet-assets.

## Related

- [Best practices]({% link best-practices.md %})
- [Hybrid C#]({% link HYBRID_CSHARP.md %})
- [three.js editor parity]({% link THREEJS_EDITOR_PARITY.md %})
