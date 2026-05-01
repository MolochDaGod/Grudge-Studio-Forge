---
name: animation-and-skinned-meshes
description: Reference for cloning, animating, and rendering many skinned (rigged) meshes in three.js + R3F. Covers SkeletonUtils.clone, AnimationMixer / AnimationAction lifecycle, drei's useAnimations hook, the shared-skeleton crowd optimization (DetachedBindMode), cross-fading between clips, material tinting per-instance without breaking shared GLB materials, and proper disposal. Use whenever spawning multiple animated characters (zombies, NPCs, players), debugging T-pose / wrong-pose / no-animation bugs, or optimizing crowd render cost.
---

# Animation & Skinned Meshes

A single source of truth for **how to render many animated rigged characters from a shared GLB** without (a) collapsing into T-poses, (b) leaking memory, or (c) eating the frame budget on bone updates.

All examples target **three.js + @react-three/fiber + @react-three/drei**, with `SkeletonUtils` from `three-stdlib`.
This repo's reference site: `artifacts/game-forge/src/scene/EntityRenderer.tsx` (the `LoadedModel` component already implements the per-instance pattern).

---

## 0. Mental model — three ways to render N animated copies of one GLB

| Mode                     | Bone updates / frame | Independent state? | When to use                                  |
| ------------------------ | -------------------- | ------------------ | -------------------------------------------- |
| **Independent skeletons**| N × bones            | yes — each its own | Few characters (<50) with distinct anims/poses (player + a handful of NPCs) |
| **Shared skeleton**      | 1 × bones            | no — all in lockstep | Background crowds (large groups doing the same thing — packed-in zombies, audience, marching army) |
| **InstancedMesh**        | 0 (no bones)         | no                 | Static decoration (rocks, grass, props) — **not** for skinned meshes |

The 80/20 rule:
- **Player + named NPCs** → independent skeletons, one mixer each.
- **Crowds of 20+ identical actors all doing the same loop** → shared skeleton, one mixer for all.
- **Static props duplicated 100+ times** → `InstancedMesh` (different skill — not skinned).

---

## 1. Cloning a skinned GLB the right way

### 1.1 Why `Object3D.clone()` breaks

A skinned mesh holds a `skeleton` (list of `Bone` objects + `boneMatrices` buffer) plus a `bindMatrix`. `Object3D.clone()` does a shallow copy: the second instance points at the **first instance's bones**, so as soon as the original moves or is re-bound, every clone snaps to a T-pose.

### 1.2 The fix: `SkeletonUtils.clone()`

```ts
import { SkeletonUtils } from "three-stdlib";

const cloned = SkeletonUtils.clone(gltf.scene);
```

This recursively clones the scene **and** rebuilds bone references so each clone has its own functioning skeleton. Cost: O(bones); negligible per-spawn.

### 1.3 Where this lives in the repo

`EntityRenderer.tsx` → `LoadedModel`:

```ts
const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf]);
```

Memoized on `gltf` so each entity clones exactly once per GLB load (HMR-safe).

### 1.4 The animations come from the cached GLB, not the clone

```ts
const { actions, names } = useAnimations(gltf.animations, groupRef);
```

`gltf.animations` is the array of `AnimationClip`s parsed from the GLB. Drei's `useAnimations` builds an `AnimationMixer` bound to the ref and pre-creates one `AnimationAction` per clip, keyed by clip name. **Reuse the clips across instances** — they're stateless data, not playback state.

---

## 2. AnimationMixer / AnimationAction lifecycle

### 2.1 The objects

- **`AnimationClip`** — pure data parsed from the GLB. Stateless, share freely.
- **`AnimationMixer`** — owns playback state for one root object. **One mixer per character** (independent mode) or one mixer for the shared-skeleton root (shared mode).
- **`AnimationAction`** — a clip + a mixer + playback state (time, weight, loop mode, fade). Created via `mixer.clipAction(clip)`.

### 2.2 The minimum viable loop

```ts
const mixer = new THREE.AnimationMixer(model);
const action = mixer.clipAction(animations[0]);
action.play();

// In your render loop (R3F: useFrame)
useFrame((_, delta) => mixer.update(delta));
```

Drei's `useAnimations` does both halves automatically — no `useFrame` needed when using it.

### 2.3 Picking the right clip

Most authored characters export several clips (`idle`, `run`, `walk`, `attack`, …). Match by name with a fallback heuristic:

```ts
const requested = clip && names.includes(clip) ? clip : null;
const chosen =
  requested ??
  names.find((n) => /idle/i.test(n)) ??
  names.find((n) => /loop/i.test(n)) ??
  names[0];
```

Already implemented in `LoadedModel`. Keep it as the canonical pattern.

### 2.4 Cross-fading between clips (no-pop transitions)

Always **fade**, never hard-swap. The two-line idiom:

```ts
action.reset().fadeIn(0.2).play();
return () => { action.fadeOut(0.2); };
```

For a true cross-fade between two named clips:

```ts
const from = actions["idle"];
const to   = actions["run"];
to.reset().play();
from?.crossFadeTo(to, 0.25, false); // 250ms blend
```

Set `from.warp` / `to.warp` if you need to time-stretch the source so loops align (usually only matters for run↔walk pairs at different cadence).

### 2.5 Loop modes

- `THREE.LoopRepeat` (default) — loops forever.
- `THREE.LoopOnce` + `action.clampWhenFinished = true` — plays once, stops on last frame (great for attack/death).
- `THREE.LoopPingPong` — back-and-forth (rarely useful for character anims).

```ts
action.setLoop(THREE.LoopOnce, 1);
action.clampWhenFinished = true;
mixer.addEventListener("finished", (e) => { /* trigger next state */ });
```

---

## 3. The shared-skeleton crowd optimization

For dozens of identical characters doing the same loop, **share one skeleton** and bind multiple `SkinnedMesh` instances to it. Only the shared skeleton is animated; every mesh just renders its cached vertex weights against the same bone matrices.

### 3.1 The pattern (from the official three.js demo)

```ts
const sharedRoot = SkeletonUtils.clone(gltf.scene);
const sharedSkin = sharedRoot.getObjectByName("character_Mesh") as THREE.SkinnedMesh;
const sharedSkeleton = sharedSkin.skeleton;
const sharedRootBone = sharedRoot.getObjectByName("mixamorigHips") as THREE.Bone;

// The bone hierarchy must be in the scene exactly once for the mixer to update it.
scene.add(sharedRootBone);

// N copies of the *mesh*, all bound to the *same* skeleton.
const copies = [];
for (let i = 0; i < N; i++) {
  const m = sharedSkin.clone();
  m.bindMode = THREE.DetachedBindMode;        // critical: don't re-bind on add
  m.bind(sharedSkeleton, new THREE.Matrix4()); // identity = use shared bones as-is
  m.position.set(i * 2, 0, 0);
  scene.add(m);
  copies.push(m);
}

// One mixer drives the shared skeleton — every mesh follows.
const mixer = new THREE.AnimationMixer(sharedRootBone);
mixer.clipAction(animations[0]).play();
```

### 3.2 Three rules you cannot break

1. **`bindMode = DetachedBindMode`** before `.bind()`. Default `AttachedBindMode` re-binds to the local parent's transform, which un-shares the skeleton.
2. **The shared root bone must be added to the scene exactly once.** It's what the mixer animates; if it's not in the graph, nothing moves.
3. **All instances are in lockstep.** No per-instance state, no per-instance clip. If you need any of that, fall back to independent skeletons.

### 3.3 When this is worth it

Bone updates dominate skinned-mesh CPU cost. With 50 zombies and a 60-bone rig, independent mode is **3000 bone matrices/frame**; shared mode is **60**. Always profile first — for under 20 instances the win is invisible.

### 3.4 Variation tricks despite shared skeleton

- **Per-instance position / rotation / scale** — set on the cloned `SkinnedMesh`, not the bones. Just like normal `Object3D` transforms.
- **Per-instance tint / material variants** — clone the material per copy (see §5).
- **Animation-time offset** — shared skeleton means **identical phase**. To break the visual sync, alternate spawn locations and rotations so the eye doesn't pick up the pattern.

---

## 4. Drei's `useAnimations` (the R3F idiom we use)

```ts
const { actions, names, mixer } = useAnimations(gltf.animations, groupRef);
```

- `actions` — record of `{ clipName: AnimationAction }`.
- `names` — array of clip names in declaration order.
- `mixer` — the `AnimationMixer` (already wired into `useFrame`).

### 4.1 What it does for you

- Creates the mixer bound to `groupRef.current`.
- Pre-creates one action per clip.
- Calls `mixer.update(delta)` every frame.
- Disposes the mixer on unmount.

### 4.2 What you still must do

- Decide which action to `.play()`.
- Fade in / out around state changes.
- Pick the clip name (drei doesn't auto-play anything).

### 4.3 Gotcha: `groupRef` must wrap the cloned scene

```tsx
<group ref={groupRef}>
  <primitive object={cloned} />
</group>
```

If the ref is on the `<primitive>` itself, the mixer can target it but bone lookups inside `useAnimations` may pick up the original `gltf.scene` instead of the clone. Wrapping in a `<group>` is the safe pattern.

---

## 5. Per-instance tinting without breaking shared materials

Cached GLB materials are shared across every clone. Setting `material.color` on one will recolor every instance.

### 5.1 The fix: clone the material on each tinted copy

Already implemented in `LoadedModel`:

```ts
cloned.traverse((child) => {
  if (!(child instanceof THREE.Mesh)) return;
  const apply = (m: THREE.Material): THREE.Material => {
    if (m instanceof THREE.MeshStandardMaterial /* … */) {
      const cm = m.clone();
      cm.color.copy(tintColor);
      cm.needsUpdate = true;
      return cm;
    }
    return m;
  };
  const orig = child.material;
  child.material = Array.isArray(orig) ? orig.map(apply) : apply(orig);
  restorers.push(() => { child.material = orig; });
});
```

### 5.2 Cleanup matters

Clone-and-replace creates a new `Material` per instance — which means a new shader program if uniforms differ, plus its own GPU-side state. On unmount, restore the original (as the `restorers` callback does) **and** dispose if you owned the clone:

```ts
clonedMaterial.dispose();
```

Skipping disposal leaks GPU memory until the GLB is fully evicted from the drei cache.

---

## 6. Disposal

Skinned meshes hold three things that need releasing on unmount:

```ts
// 1. Stop all actions on the mixer (prevents further mixer.update churn).
for (const a of Object.values(actions)) a.stop();

// 2. Dispose the skeleton (releases the bone matrices buffer).
cloned.traverse((c) => {
  if ((c as THREE.SkinnedMesh).isSkinnedMesh) {
    (c as THREE.SkinnedMesh).skeleton.dispose();
  }
});

// 3. Dispose any per-instance cloned materials (see §5.2).
```

Drei's `useAnimations` handles (1) automatically when the component unmounts. (2) and (3) are on you.

**Do NOT** dispose `gltf.scene` itself or `gltf.animations` — they live in the drei cache and may be reused by the next spawn. Dispose only what **you** cloned.

---

## 7. Pitfalls (read this before debugging)

- **All clones T-pose** → you used `Object3D.clone()` instead of `SkeletonUtils.clone()`.
- **Animation plays once then freezes** → `LoopOnce` set somewhere, or `mixer.update(delta)` is being called with `delta=0` (timer not connected).
- **Animation plays at wrong speed across instances** → independent mixers running with different deltas (rare in R3F because `useFrame` shares one delta).
- **One character's tint bleeds into all** → material not cloned per instance (see §5).
- **Shared-skeleton bones don't move** → forgot to `scene.add(sharedRootBone)`, or skipped `bindMode = DetachedBindMode`.
- **Memory grows every scene reload** → not disposing per-instance cloned materials and skeletons.
- **`actions[name]` is undefined** → clip name mismatch. Always log `names` first when wiring a new clip.
- **Animation plays but mesh stays put** → mixer is on the wrong root. For independent mode the root must be the cloned scene; for shared mode it must be the shared bone hierarchy root.
- **Cross-fade pops** → both actions must be `.play()`-ing simultaneously during the fade window. Calling `crossFadeTo` on a stopped source skips the blend.
- **Drei `useGLTF` returns the same skeleton across HMR reloads** → expected; clear the cache with `useGLTF.clear(url)` if you change the GLB on disk and stale skeletons appear.

---

## 8. Quick-reference: pick the right pattern

```
1 player or main character             → independent skeleton + own mixer
3–10 named NPCs with distinct anims    → independent skeletons, one mixer each
20+ background crowd, same animation   → shared skeleton + DetachedBindMode
50+ swarm with light variation         → shared skeleton + per-instance transform jitter
Static props, repeated 100+            → InstancedMesh (different skill — not skinned)
Need per-instance facial expressions   → independent skeletons (morph targets aren't shareable cheaply)
```

---

## 9. Codebase recipes

### 9.1 Spawn a single animated character (current `LoadedModel` pattern)

`EntityRenderer.tsx` already does this — copy the structure if you build a new surface.

### 9.2 Spawn a crowd of 30 zombies all doing the same shamble

```tsx
function ZombieCrowd({ url, count = 30 }: { url: string; count?: number }) {
  const gltf = useGLTF(url);
  const sharedRoot = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf]);
  const { skeleton, rootBone, skin } = useMemo(() => {
    const skin = sharedRoot.getObjectByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh;
    const rootBone = skin.skeleton.bones[0]; // or look up by name
    return { skeleton: skin.skeleton, rootBone, skin };
  }, [sharedRoot]);

  const groupRef = useRef<THREE.Group>(null);
  useAnimations(gltf.animations, groupRef);

  const positions = useMemo(() =>
    Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 8, 0, Math.sin(angle) * 8);
    }), [count]);

  return (
    <group ref={groupRef}>
      <primitive object={rootBone} />
      {positions.map((p, i) => (
        <SharedSkin key={i} sourceSkin={skin} skeleton={skeleton} position={p} />
      ))}
    </group>
  );
}

function SharedSkin({ sourceSkin, skeleton, position }: {
  sourceSkin: THREE.SkinnedMesh; skeleton: THREE.Skeleton; position: THREE.Vector3;
}) {
  const mesh = useMemo(() => {
    const m = sourceSkin.clone();
    m.bindMode = THREE.DetachedBindMode;
    m.bind(skeleton, new THREE.Matrix4());
    return m;
  }, [sourceSkin, skeleton]);
  return <primitive object={mesh} position={position} />;
}
```

For our zombies-in-tps-zombies use case, this is the upgrade path when crowd size grows past ~20.

### 9.3 Switch a character from idle → run (animation state machine)

```ts
function setState(next: "idle" | "run" | "attack") {
  const from = currentActionRef.current;
  const to   = actions[next];
  if (!to || from === to) return;
  to.reset().play();
  from?.crossFadeTo(to, 0.2, false);
  currentActionRef.current = to;
}
```

Wire `setState("run")` from input, `setState("attack")` from a fire button, etc. Always cross-fade.
