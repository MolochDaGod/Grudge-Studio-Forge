---
name: threejs-html-overlays
description: Reference for overlaying real HTML/DOM elements on top of three.js scenes — `CSS2DRenderer` for screen-space labels (entity names, debug HUD, damage numbers) and `CSS3DRenderer` for diegetic in-world panels. Covers the dual-renderer rig (WebGL + CSS in lock-step), drei's `<Html />` shortcut, occlusion strategy, click-through control, and the Forge editor's entity-label / pin pattern. Use whenever you need clickable buttons, rich text, or live React components attached to a 3D position.
---

# Three.js HTML Overlays — Labels, HUDs, and Diegetic UI

Three.js can render HTML elements that track 3D positions through one of two CSS renderers. This skill is about picking the right one, wiring it into our R3F viewport, and not breaking input handling.

---

## 1. CSS2DRenderer vs CSS3DRenderer vs `<Html />`

| Tool                 | What it does                                       | When to use                                                                                  |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CSS2DRenderer`      | Projects an `Object3D`'s position to screen pixels; the element stays axis-aligned and unscaled. | **Default.** Entity name tags, debug tooltips, sector pins, damage numbers, kill-feed.       |
| `CSS3DRenderer`      | Renders a real DOM element in 3D space — rotated and scaled with the world.                      | Diegetic in-world UI: a billboard, a TV screen, an in-game monitor running React.            |
| drei `<Html />`      | R3F wrapper that does either, with `center`, `distanceFactor`, `occlude`, `transform`.            | The R3F-native way — prefer this unless you need raw control.                                |

If you reach for `CSS3DRenderer`, you're saying "the UI is part of the world." Otherwise, use `CSS2DRenderer` (or `<Html />` with no `transform` prop).

---

## 2. Vanilla three rig (two renderers, one camera)

```ts
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.top = "0px";
labelRenderer.domElement.style.pointerEvents = "none";  // critical: let mouse through
container.appendChild(labelRenderer.domElement);

// Per-entity:
const el = document.createElement("div");
el.className = "label";
el.textContent = entity.name;
const labelObj = new CSS2DObject(el);
labelObj.position.set(0, 1.2, 0);                       // 1.2u above the entity
entity3D.add(labelObj);

// Each frame:
renderer.render(scene, camera);
labelRenderer.render(scene, camera);                     // same scene, same camera
```

Two non-obvious rules:
- **The CSS layer must be `position: absolute` over the WebGL canvas**, not next to it.
- `pointerEvents: none` on the renderer's container, then re-enable per-element (`label.style.pointerEvents = 'auto'`) only if a specific label needs to be clicked.

---

## 3. R3F idiom — use `<Html />` from drei

This is what the Forge should default to. It handles the renderer for you and gives lifecycle-safe portal mounting.

```tsx
import { Html } from "@react-three/drei";

<mesh position={entity.position}>
  <Html
    position={[0, 1.2, 0]}        // local offset above the mesh
    center                          // center the element on the screen point
    distanceFactor={8}              // scale with distance (omit for fixed-size)
    occlude="blending"              // fade when something is in front (drei feature)
    style={{ pointerEvents: "none" }}
  >
    <div className="rounded bg-black/70 px-2 py-1 text-xs text-white">
      {entity.name}
    </div>
  </Html>
</mesh>
```

`occlude` modes:
- `false` (default) — label is always on top, even through walls.
- `true` — label is hidden behind geometry (uses depth read).
- `"blending"` — label fades as it goes behind something. Subtle, good for selection rings.

---

## 4. The Forge entity-label pattern

For selectable entities in the editor viewport:

1. Mount one `<Html />` per selected/hovered entity inside `EntityRenderer.tsx`.
2. Drive visibility from the editor store (`useEditor((s) => s.selectedId === id)`).
3. Use `pointerEvents: none` so clicks pass through to the WebGL canvas and don't fight raycasting.
4. For RTS-style "always-on name plates" (debug / multi-select), gate behind a viewport toggle (`useEditor((s) => s.showLabels)`).

For **sector pins on the world map** (RTS overworld), use one `<Html />` per sector with `pointerEvents: auto` and an `onClick` that dispatches `setActiveSector(id)` from the store.

---

## 5. Performance ceilings

- **Hundreds of labels are fine.** The CSS layout cost is just transforms — GPU-composited.
- **Thousands of labels are not.** Cull to "labels within `N` units of the camera," or only render labels for entities flagged with `userData.alwaysLabeled = true`.
- **Damage-number bursts** (combat numbers flying up): pool the DOM nodes. Create 32 once, reuse them, fade with CSS animations — never create + delete in `useFrame`.

---

## 6. Click-through and input ordering

The WebGL canvas and the CSS layer are siblings. If both can receive pointer events, the CSS layer wins because it's on top. Defaults:

```css
.css2d-root        { pointer-events: none; }   /* container */
.css2d-root button { pointer-events: auto; }   /* opt-in per element */
```

When a clickable HTML element is over a 3D object, **the 3D raycast does not fire** for that pixel. This is usually what you want. If you need the click to do both, dispatch the 3D action from your HTML `onClick` handler manually.

---

## 7. Gotchas

- **`renderer.setSize`** must be called on **both** the WebGL renderer and the CSS renderer on resize. R3F + drei `<Html />` handles this — vanilla code must do it.
- **CSS2DObject positions are local** (relative to their parent). Add them as children of the entity's group, not the scene root, so they follow the entity automatically.
- **`<Html occlude>` does a depth read** every frame — fine for a handful of labels, costly for hundreds. Disable for crowd labels.
- **z-fighting between labels**: there isn't any (CSS compositing has no depth), but elements at the exact same screen pixel will paint in DOM order. Sort manually if you care.

---

## See also

- `threejs-controls` — for keeping orbit / drag controls clean when a label is clicked.
- `forge-editor` — for where `EntityRenderer.tsx` lives and how the store drives selection.
