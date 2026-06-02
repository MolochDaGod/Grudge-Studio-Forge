---
name: threejs-volume-rendering
description: WebGPU volumetric rendering patterns — `Data3DTexture` + `RaymarchingBox` for opaque volumes (clouds, magic clouds, smoke), and `VolumeNodeMaterial` with depth-aware post-pass for volumetric lighting (god rays, dust shafts, fog with native lights/shadows). Covers building a 3D Perlin texture, choosing step counts, denoising at quarter resolution + Gaussian blur, depth occlusion against scene geometry, and the WebGPU-only requirement. Use when adding clouds, fog volumes, light shafts, magic AoE clouds, or any raymarched effect.
---

# Three.js Volume Rendering — WebGPU Patterns

Volumetric effects (clouds, fog, god rays) are raymarched: for each screen pixel, march N steps through a 3D volume and accumulate. This is **WebGPU only** in three.js (TSL nodes) — it does not work on the WebGL2 path.

The renderer must be `THREE.WebGPURenderer`. The Forge editor's main viewport runs WebGL2 + R3F today; volume effects belong in **dedicated WebGPU surfaces** (FX previewer, cinematic mode), not the default viewport.

---

## 1. The two volume patterns

| Pattern | What it draws | Cost | When to use |
| ------- | ------------- | ---- | ----------- |
| **Opaque raymarch** (`RaymarchingBox`) | A solid blob shape sampled from a 3D texture — first hit > threshold paints the surface | Fixed: N steps per pixel inside the box | Magic clouds, jelly/slime, isosurfaces, voxel terrain previews |
| **VolumeNodeMaterial + post-pass** | Participating media — light scatters through, geometry occludes correctly | N steps × per light × screen pixels (run at quarter-res + Gaussian blur to recover) | Fog, dust shafts, god rays, smoke that responds to lights |

Pick by intent: "make a thing that looks solid-fuzzy" → opaque. "Make the *space between* things look hazy" → VolumeNodeMaterial.

---

## 2. Generating a 3D noise texture

Both patterns sample from a `Data3DTexture` filled offline. 128³ is the sweet spot — 2 MB, looks crisp, fits any GPU.

```ts
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

const size = 128;
const data = new Uint8Array(size * size * size);
const perlin = new ImprovedNoise();
const v = new THREE.Vector3();

let i = 0;
for (let z = 0; z < size; z++) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      v.set(x, y, z).divideScalar(size);
      const d = perlin.noise(v.x * 6.5, v.y * 6.5, v.z * 6.5);
      data[i++] = d * 128 + 128;                 // 0..255
    }
  }
}

const tex = new THREE.Data3DTexture(data, size, size, size);
tex.format = THREE.RedFormat;
tex.minFilter = THREE.LinearFilter;
tex.magFilter = THREE.LinearFilter;
tex.unpackAlignment = 1;
tex.needsUpdate = true;
```

For animated volumes (smoke that swirls), don't regenerate the texture — instead, sample with a time-offset (`positionRay + vec3(time, 0, time*0.3)`) and `WrapRepeat` on `wrapS/T`.

---

## 3. Opaque raymarched volume

Render a `BoxGeometry` with `BackSide` so we march from the back face inward. The TSL `RaymarchingBox` helper handles the math:

```ts
import { vec4, texture3D, uniform, Fn, If, Break } from "three/tsl";
import { RaymarchingBox } from "three/addons/tsl/utils/Raymarching.js";

const threshold = uniform(0.6);
const steps = uniform(200);

const colorFn = Fn(({ texture, steps, threshold }) => {
  const finalColor = vec4(0).toVar();
  RaymarchingBox(steps, ({ positionRay }) => {
    const v = texture.sample(positionRay.add(0.5)).r.toVar();
    If(v.greaterThan(threshold), () => {
      const p = positionRay.add(0.5);
      finalColor.rgb.assign(texture.normal(p).mul(0.5).add(positionRay.mul(1.5).add(0.25)));
      finalColor.a.assign(1);
      Break();                                    // first hit wins
    });
  });
  return finalColor;
});

const material = new THREE.NodeMaterial();
material.colorNode = colorFn({ texture: texture3D(tex, null, 0), steps, threshold });
material.side = THREE.BackSide;
material.transparent = true;

const blob = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
```

Step count: 100 is OK for previews, 200 for hero shots, 300+ is wasteful unless the volume is very translucent.

---

## 4. VolumeNodeMaterial — fog with real lights

`VolumeNodeMaterial` does proper light scattering: it samples each light at each step and accumulates. Marry it to a post-pass with depth occlusion so it can't bleed *through* world geometry.

```ts
import { vec3, time, texture3D, screenUV, uniform, pass } from "three/tsl";
import { bayer16 } from "three/addons/tsl/math/Bayer.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";

const LAYER_VOL = 10;                            // dedicated layer for the volume mesh

const mat = new THREE.VolumeNodeMaterial();
mat.steps = 12;                                  // 12 is enough at 1/4-res + blur
mat.offsetNode = bayer16(screenCoordinate);      // dither — kills banding cheaply
mat.scatteringNode = Fn(({ positionRay }) => {
  const t = vec3(time, 0, time.mul(0.3));
  return texture3D(noiseTex, positionRay.add(t).mul(0.1).mod(1), 0).r.add(0.5);
});

const fogBox = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), mat);
fogBox.layers.disableAll(); fogBox.layers.enable(LAYER_VOL);

// Post-pipeline:
const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
mat.depthNode = scenePass.getTextureNode("depth").sample(screenUV);  // occlusion

const volPass = pass(scene, camera, { depthBuffer: false });
volPass.setLayers(volLayer);
volPass.setResolutionScale(0.25);                                    // 1/4-res — huge win

pipeline.outputNode = scenePass.add(gaussianBlur(volPass, 0.6));
```

The three magic moves:
1. **`offsetNode = bayer16(...)`** — per-pixel ray offset kills banding without more steps.
2. **`setResolutionScale(0.25)`** — render the volume at 1/4 resolution, then blur.
3. **`depthNode`** — feed the scene's depth back in so the volume gets occluded by walls/floor.

---

## 5. Performance budget

- Opaque raymarch in a small box (≤2m): 200 steps, runs 60 FPS on integrated GPUs.
- Full-scene VolumeNodeMaterial at 1/4-res + blur: 12 steps, ~3 ms on a mid-range discrete GPU.
- **Never raymarch the whole screen at full res.** That's a slideshow.

Watch for: full-resolution volume + many dynamic lights = doubled cost per light. Limit shadow-casting lights inside volumes to **one or two**.

---

## 6. Forge integration

This is a WebGPU-only stack. Add volumes through a separate "FX Sandbox" surface (parallel to `ModelSurface`/`PrefabPreviewSurface` in `artifacts/game-forge/src/editor/ViewportHost.tsx`) that mounts a `<Canvas gl={{ renderer: 'webgpu' }}>` with the volume effect. Don't try to retrofit them into the main editor's WebGL renderer.

When a user saves a "volume effect prefab," persist:
- Noise texture seed + scale + repeat factor (regenerate on load — don't ship the 2 MB blob).
- Step count, threshold, color, density curves.
- Light layer assignments.

---

## 7. Gotchas

- **WebGPU only.** Browser support: Chrome/Edge stable, Firefox behind a flag, Safari TP. Render a fallback (regular fog) for WebGL2.
- **`Data3DTexture` is RAM**, not VRAM stable across drivers. 256³ = 16 MB; 512³ = 128 MB. Cap at 128³.
- **Tone mapping**: volumes look better with `NeutralToneMapping`, not ACES — ACES crushes the highlights you actually want bloomed.
- **Don't put a volume inside another volume** — the scattering math is single-volume.

---

## See also

- `threejs-tsl` — for authoring custom `Fn` nodes and TSL fundamentals.
- `forge-editor` — for where the FX Sandbox surface should slot in.
