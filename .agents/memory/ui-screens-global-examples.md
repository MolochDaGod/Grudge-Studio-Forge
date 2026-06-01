---
name: UI screen global examples vs project scope
description: Why example HUD screens seeded into the "global" bucket must be merged into numeric projects.
---

## The trap

`useUIScreens` (`store/uiScreens.ts`) keys screens by `ProjectKey =
number | "global"`. Shipped example HUD screens are seeded once into the
`"global"` bucket (no project open yet). But normal editor usage loads a
template into a **numeric** project id, and the UI editor / AI tools list
screens by that numeric key.

**Lesson:** screens authored under `"global"` are invisible in the
project-scoped flow unless `listScreens` / `getScreen` explicitly merge or
fall back to the `"global"` bucket. Seeding alone is not enough.

## How it's solved

- `listScreens(numericProject)` merges the project's own screens with the
  `"global"` examples (project-scoped wins on id collision).
- `getScreen` falls back to `"global"` when the numeric bucket lacks the id.
- Mutations (rename/delete/widget edits) route through an `owningKey`
  resolver so editing/deleting a global example while a numeric project is
  open persists in the bucket that actually owns it (the global bucket) —
  otherwise the mutation silently no-ops against the project bucket.

**Why:** a code review rejected seed-only-into-global as a real-usage gap —
the HUDs existed but were undiscoverable once a project was loaded.

**How to apply:** any new shared/default screens belong in `"global"`; make
sure every read path merges global and every write path resolves the owning
bucket.
