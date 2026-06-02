---
name: threejs-tsl
description: Reference for Three.js Shading Language (TSL) — the node-based shader system that targets WebGPU (and back-ports to WebGL2). Covers the core primitives (`Fn`, `uniform`, `texture`, `uv`, `positionLocal`, `time`), composing material output via `colorNode` / `outputNode` / `positionNode`, the VFX pattern (twisted cylinders, billboarded sprites, layered noise + gradients for tornados/flames), bloom post-pipeline, and the GLSL→TSL transpiler workflow for porting existing shaders. Use whenever authoring custom materials, VFX prefabs, or migrating GLSL to a renderer-agnostic node graph.
---

# Three.js Shading Language (TSL) — Grudge Studio

TSL is a JavaScript-DSL for shaders. You write what looks like normal JS (`uv().add(time).mul(0.5)`), and three.js compiles to WGSL (WebGPU) or GLSL (WebGL2) depending on the renderer.

The win: **one shader source, two backends, full type safety in the editor**. The cost: you have to learn a new vocabulary (`vec3`, `Fn`, `toVar`, `assign`).

---

## 1. The vocabulary you actually need

| Imported from `three/tsl` | What it is | Example |
| ------------------------- | ---------- | ------- |
| `vec2 vec3 vec4`          | Constructors             | `vec3(1, 0, 0)` |
| `uv()`                    | Per-fragment UV          | `uv().x.mul(2)` |
| `positionLocal`           | Object-space position    | reposition vertices |
| `positionWorld`           | World-space position     | for distance fades |
| `normalLocal/World`       | Normals                  | dot with light dir |
| `time`                    | Auto-incrementing uniform | animate without raf |
| `texture(t, uv, lod?)`    | Sample a 2D texture      | `.r .g .b .a` accessors |
| `texture3D(t, p, lod?)`   | Sample a 3D texture      | for volumes |
| `uniform(value)`          | Editable uniform         | bound to GUI sliders |
| `color('#hex')`           | sRGB color helper        | use instead of literal `vec3` |
| `Fn((args) => { ... })`   | Define a reusable function | core of every effect |
| `If / Break / Continue`   | Control flow nodes       | TSL has no native `if` — wrap in `If()` |
| `sin cos atan length step smoothstep mix mod min max remap` | Math nodes | drop-in for GLSL counterparts |

Crucial style rules:
- Use `.toVar()` when you'll mutate a value later (`const x = expr.toVar(); x.addAssign(...)`).
- Use `.assign(...)` and `.addAssign(...)` for mutation; never `=` on a node.
- `Fn(() => {})()` (called with `()` at the end) returns the *output node* once. `Fn(() => {})` (no `()`) returns the function itself for reuse.

---

## 2. Wiring TSL into a material

```ts
import * as THREE from "three/webgpu";
import { uv, time, vec3, vec4, Fn } from "three/tsl";

const mat = new THREE.MeshBasicNodeMaterial({ transparent: true });

mat.colorNode = Fn(() => {
  const stripes = uv().y.add(time.mul(0.5)).fract();
  return vec4(vec3(stripes), 1);
})();
```

Material slots that accept node graphs:
- `colorNode` — fragment color (most common).
- `outputNode` — fragment output incl. alpha (for transparent VFX).
- `positionNode` — vertex displacement.
- `normalNode` — override normals (procedural bumpmaps).
- `emissiveNode`, `roughnessNode`, `metalnessNode` — PBR channel overrides.
- `vertexNode = billboarding()` — make sprites face the camera horizontally.

Materials: `MeshBasicNodeMaterial`, `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, `SpriteNodeMaterial`, `NodeMaterial` (raw), `VolumeNodeMaterial`.

---

## 3. The VFX pattern (tornado / flames / fire / portal)

Effects in three.js examples follow a recipe — copy this structure for every VFX prefab.

```ts
const emissive = uniform(color("#ff8b4d"));
const timeScale = uniform(0.2);

// 1) Geometry warp (vertex):
mat.positionNode = twistedCylinder(positionLocal, ...);

// 2) Surface look (fragment):
mat.outputNode = Fn(() => {
  const scaledTime = time.mul(timeScale);

  // sample noise A (low freq)
  const noiseA = texture(perlin, uvA(scaledTime), 1).r.remap(0.45, 0.7);
  // sample noise B (high freq, animated)
  const noiseB = texture(perlin, uvB(scaledTime), 1).g.remap(0.45, 0.7);

  // shape mask (gradient / smoothstep)
  const fade = min(uv().y.smoothstep(0, 0.1), oneMinus(uv().y).smoothstep(0, 0.4));

  // combine
  const effect = noiseA.mul(noiseB).mul(fade);

  return vec4(emissive.rgb, effect.smoothstep(0, 0.1));
})();
```

The mental model: **two noise samples** at different speeds + **a shape mask** → multiply → that's the alpha. Color comes from a uniform or a gradient texture. This is how the three.js `webgpu_tsl_vfx_flames` and `webgpu_tsl_vfx_tornado` examples are built.

For billboarded sprites (campfires, magic charges):
```ts
import { billboarding } from "three/tsl";
spriteMat.vertexNode = billboarding();
```

---

## 4. Post-processing — bloom for emissive VFX

VFX without bloom look flat. The render-pipeline pattern:

```ts
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const bloomPass = bloom(scenePass.getTextureNode("output"), /*strength*/ 1, /*radius*/ 0.1, /*threshold*/ 1);
pipeline.outputNode = scenePass.add(bloomPass);

// In your loop:
pipeline.render();      // replaces renderer.render(scene, camera)
```

Bloom thresholds:
- `1.0` — only HDR pixels (`color * intensity > 1`) bloom. Crisp.
- `0.7` — soft glow on bright UI. Cinematic, mushy.
- `0.0` + low strength — everything blooms. Use sparingly.

---

## 5. Porting GLSL → TSL via the Transpiler

`three/addons/transpiler/Transpiler.js` converts existing GLSL functions to TSL automatically. The interactive editor at `webgpu_tsl_transpiler.html` is the easiest way to test:

```ts
import Transpiler from "three/addons/transpiler/Transpiler.js";
import GLSLDecoder from "three/addons/transpiler/GLSLDecoder.js";
import TSLEncoder from "three/addons/transpiler/TSLEncoder.js";

const transpiler = new Transpiler(new GLSLDecoder(), new TSLEncoder());
const tsl = transpiler.parse(glslSource);    // string of TSL code
```

Workflow for migrating an existing GLSL shader from another project:
1. Paste GLSL into the transpiler.
2. Read the TSL output; fix any decorations the transpiler can't auto-derive (uniforms, samplers).
3. Drop into a `Fn(() => {...})` and bind to a material node slot.

You can also encode to WGSL directly (for hand-tuning the WebGPU path).

---

## 6. Forge integration

TSL belongs to the **WebGPU surface track** (same constraint as `threejs-volume-rendering`). The right home:
- A new "Shader Lab" / "FX Sandbox" surface alongside `ModelSurface`.
- Save the TSL source as a string field on a `MaterialPrefab` in the scene schema; compile it lazily when the prefab is instantiated.
- Expose uniforms as scene-schema knobs so non-coders can tweak `timeScale`, `emissiveColor`, etc. through the inspector.

Never compile arbitrary user TSL on the main editor canvas — sandbox it in the FX surface so a broken shader doesn't bring down the editor.

---

## 7. Gotchas

- **WebGPU primary, WebGL2 fallback.** Most TSL works on both renderers, but some nodes (compute, `pass`) are WebGPU only. Test on both before shipping.
- **`If(cond, () => {})`** does not return a value. Assign to a `.toVar()` declared outside.
- **`time` is in seconds**, auto-incrementing. Don't drive it manually.
- **Color spaces**: `color('#fff')` returns linear sRGB; raw `vec3(1,1,1)` is also linear. Tone-mapping converts to display sRGB at the end.
- **Don't `console.log` a node** — they're proxies, not values. Use `renderer.inspector` (TSL Inspector) for debugging.

---

## See also

- `threejs-volume-rendering` — same WebGPU track; uses TSL for raymarching.
- `forge-editor` — where the FX Sandbox surface should slot in.
- `threejs-positional-audio` — for feeding `AudioAnalyser` data into TSL via a `texture()` uniform.
