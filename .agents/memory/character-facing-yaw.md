---
name: builtin:character faces +Z (player-faces-camera bug)
description: Why the bundled character model needs a per-player yaw offset, not a global one
---

- **`builtin:character` (the bundled GLB) is authored facing +Z**, same as the `race:*` rigs and the mutant — NOT -Z. (An old code comment in `builtinModels.ts` wrongly claimed it "already faces -Z"; that misdiagnosis caused a failed earlier fix attempt.)
  **Proof:** deathmatch templates rotate enemies `rotation = [0, angle + Math.PI, 0]` and comment "face the player". That formula only points a model at the ring center if its native forward is +Z.

- **The half-turn for `builtin:character` is applied per-player, NOT in the `BUILTIN_MODEL_YAW_OFFSETS` registry.**
  **Why:** the deathmatch templates use `builtin:character` for BOTH the player AND the enemies. Enemies hand-author a compensating yaw tuned to the raw +Z facing, so a global registry offset would flip every enemy backward. Only third-person players using this model get `model.yawOffset = Math.PI` in the scene-template builders.
  **How to apply:** if a NEW third-person template player uses `builtin:character`, give it `model.yawOffset: Math.PI` (regression test in `lib/scene-templates/src/index.test.ts` enforces this). The `race:*` rigs differ — they ARE normalized in the registry, so race-based players need nothing.

- **Changing template content requires bumping `TEMPLATES_VERSION`** (`lib/scene-templates/src/index.ts`, `yyyymmdd.n`). The API server reseeds versioned copies to R2 on boot; `ensurePublicJson` re-uploads when byte size differs. Old versions stay immutable so existing share links resolve.
