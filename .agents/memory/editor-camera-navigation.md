---
name: Editor viewport camera navigation
description: Why right-click pan doesn't work in the editor viewport and how navigation is configured.
---

## Right-click pan is unavailable — the viewport is wrapped in a context menu

The editor `Viewport` is wrapped in a Radix `<ContextMenu>` whose trigger is
the viewport div. So RIGHT-click is owned by the entity-aware context menu,
and OrbitControls' default `RIGHT = pan` can never usefully fire (the menu
opens and interrupts any pan).

**Consequence to remember:** with bare `<OrbitControls makeDefault />` the
only working navigation was LEFT-drag (orbit — always changes look
direction) and wheel-zoom toward the orbit pivot. Users (correctly) said it
"doesn't work like an editor": no pan, and zoom felt stuck.

## The navigation config

OrbitControls is configured for editor-standard feel:
- **MIDDLE-drag = PAN** — the real "move without rotating" path, since RIGHT
  is taken by the menu.
- **zoomToCursor** — wheel dollies toward the cursor, not a stale pivot.
- **screenSpacePanning** — pan parallel to the screen, preserving look dir.
- **enableDamping** — smooth motion.
- LEFT stays orbit (and still selects on click via onPointerMissed).

**Why:** LEFT must remain orbit+select and RIGHT must remain the menu, so
PAN has to live on MIDDLE. If you ever want right-drag pan, you must add
drag-vs-click detection to suppress the Radix menu on a right-drag.

**How to apply:** the `F` key / "Focus camera" tween (`FocusCameraController`)
parks the orbit pivot at the selected entity — intended, user-initiated;
don't confuse it with the always-on navigation above.
