---
name: threejs-controls
description: Reference for picking and wiring three.js camera/input controls — OrbitControls, TransformControls, FlyControls, MapControls, DragControls — into the Forge editor viewport. Covers when to use each, R3F vs. vanilla three-stdlib usage, multi-controller arbitration (TransformControls disables OrbitControls while dragging), and the Grudge Studio "edit vs play vs orbit-cam-cinematic" mode switch. Use whenever adding viewport navigation modes, gizmo manipulation, RTS-style ground panning, or in-scene draggable handles.
---

# Three.js Controls — Grudge Studio Playbook

The Forge editor viewport already uses `OrbitControls` + `TransformControls` (from `@react-three/drei`). This skill exists so the next "add an RTS pan mode" or "add a build-mode drag handle" task lands on the correct controller without inventing a new one.

Reference site in repo: `artifacts/game-forge/src/editor/Viewport.tsx` (imports OrbitControls and TransformControls from drei).

---

## 1. Picking the right controller

| Controller         | Best for                                              | Forge use case                                              |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| `OrbitControls`    | Tumble around a target point                          | **Default editor camera.** Already wired in `Viewport.tsx`. |
| `MapControls`      | RTS / 2.5D top-down — right-button **pans** the floor | Future RTS / strategy editor sectors                        |
| `FlyControls`      | First-person fly-through, no fixed target             | Cinematic / walkthrough preview mode                        |
| `TransformControls`| Move/rotate/scale gizmo attached to a selected object | Already wired — `transformMode` lives in `useEditor` store  |
| `DragControls`     | Click-and-drag an object along a screen plane         | Quick prefab placement, building-mode put-down              |
| `PointerLockControls` | True FPS look (locks the cursor)                   | Play mode "first person" camera (not the editor)            |

Rule of thumb: **never bolt two camera controllers onto the same camera at once.** Switch by unmounting one before mounting the other (React unmount handles `dispose()` for you).

---

## 2. R3F wiring (the repo standard)

`@react-three/drei` re-exports OrbitControls / TransformControls / DragControls / PointerLockControls / FlyControls / MapControls as components. Use those — they auto-attach to the active R3F camera + canvas DOM element.

```tsx
import { OrbitControls, TransformControls } from "@react-three/drei";

<OrbitControls makeDefault enableDamping />
{selected ? (
  <TransformControls
    object={selectedObject}
    mode={transformMode}             // "translate" | "rotate" | "scale"
    onMouseDown={() => orbit.enabled = false}
    onMouseUp={()   => orbit.enabled = true}
  />
) : null}
```

The `makeDefault` flag on OrbitControls is **important**: it publishes the controls into the R3F state so `TransformControls` (and our `viewportBridge.ts` singleton) can grab them by `useThree(state => state.controls)`.

---

## 3. TransformControls ↔ OrbitControls arbitration

The gold-standard pattern from the three.js example: disable orbit while the gizmo is being dragged so the camera doesn't tumble away mid-edit.

```tsx
const orbit = useRef<any>(null);
<OrbitControls ref={orbit} makeDefault />
<TransformControls
  object={selected}
  onMouseDown={() => { if (orbit.current) orbit.current.enabled = false; }}
  onMouseUp={()   => { if (orbit.current) orbit.current.enabled = true; }}
/>
```

This is what `Viewport.tsx` does; mirror it for any new gizmo (e.g., a custom rotation ring).

---

## 4. MapControls — RTS pan mode

`MapControls` is OrbitControls with the mouse-button mapping inverted: **right button pans the ground plane** instead of orbiting. Perfect for top-down strategic editing.

```tsx
import { MapControls } from "@react-three/drei";

<MapControls
  makeDefault
  enableRotate={false}             // top-down only — no tumbling off the floor
  maxPolarAngle={Math.PI / 2.2}    // never look up
  screenSpacePanning={false}       // pan along the XZ plane, not the camera plane
/>
```

Pair with a clamped camera height (`useFrame` to clamp `camera.position.y`) for a sector editor or strategy view.

---

## 5. FlyControls — cinematic walkthrough

Free-fly, no target. Suitable for the "preview my level" mode but **not** for editing (you lose pivot semantics).

```tsx
import { FlyControls } from "@react-three/drei";

<FlyControls movementSpeed={5} rollSpeed={0.5} dragToLook />
```

Wire to a viewport tab toggle (`useEditor((s) => s.cinematicMode)`); on enter, swap OrbitControls for FlyControls and snap the camera position from the last orbit pose using `computeFramingPose()` from `artifacts/game-forge/src/lib/framing.ts`.

---

## 6. DragControls — building-mode placement

Use when the user is dragging a prefab into the scene with the mouse. Attach to a list of "ghost" meshes; commits to the scene on `dragend`.

```tsx
import { DragControls } from "three/addons/controls/DragControls.js";

const draggable = [ghostMesh];
const controls = new DragControls(draggable, camera, renderer.domElement);

controls.addEventListener("dragstart", () => (orbit.enabled = false));
controls.addEventListener("dragend",   () => (orbit.enabled = true));
controls.addEventListener("drag",      (e) => snapToNavmesh(e.object));
```

Snap the dragged object's position through the navmesh probe (`groundProbe()` in `artifacts/game-forge/src/scene/PlayRuntime.ts`) so the ghost sits on terrain.

---

## 7. Common gotchas

- **`controls.update()` is required** if you use `enableDamping` and you're driving the loop manually. R3F + drei does this for you.
- **TransformControls adds a Helper** to the scene — never serialize the helper into your scene JSON. The Forge scene schema does this by iterating `scene.children` and skipping anything whose `userData.isHelper === true`.
- **Touch input on Drag/Map controls**: set `touches: { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }` for predictable mobile behavior.
- **Multiple cameras** (e.g., picture-in-picture): each camera needs its own controls instance. Never share.
- **Dispose**: vanilla controls (not via drei) **must** be `.dispose()`'d on unmount, otherwise their event listeners stay glued to `window` and your next viewport remount accumulates them.

---

## 8. Where to wire new control modes in the Forge

1. Add the mode to `EditorState` in `artifacts/game-forge/src/store/editor.ts` (`viewportMode: "orbit" | "fly" | "map"`).
2. Switch on it in `Viewport.tsx` to mount the matching drei controls component.
3. Add a Toolbar button (`artifacts/game-forge/src/editor/Toolbar.tsx`) that toggles the mode.
4. If the new mode requires the AI tool runtime to know the camera state, publish via `viewportBridge.ts` — that singleton is already plumbed for screenshot + framing tools.

---

## See also

- `animation-and-skinned-meshes` — for what to do *to* the selected object once the gizmo moves it.
- `spatial-queries-and-surfaces` — for snapping DragControls outputs to terrain.
- `forge-editor` — overall architecture so you know where the toolbar / store lives.
