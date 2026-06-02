---
name: threejs-positional-audio
description: Reference for three.js Web Audio integration — `AudioListener`, `AudioLoader`, `Audio`, `PositionalAudio`, and `AudioAnalyser`. Covers the gesture-gated startup ritual that browsers require, perfect-timing playback (sync sound to physics events), 3D-positional sources with directional cones and occluders, FFT-driven visualizers, and the listener-on-camera convention. Use when adding footsteps, weapon SFX, ambient zones, music, or audio-reactive shaders to the Forge.
---

# Three.js Positional Audio — Grudge Studio

Three.js wraps the Web Audio API in `THREE.Audio` and `THREE.PositionalAudio`. They share a single `AudioListener` that lives on the active camera. This skill is about wiring them up correctly so a footstep sound actually plays at the foot, not in the user's left ear.

---

## 1. The startup ritual (the part everyone forgets)

Browsers require a user gesture before any AudioContext can play. The three.js examples wrap init in a Play button:

```ts
startButton.addEventListener("click", () => {
  startButton.remove();
  init();   // creates renderer, listener, loads sounds
});
```

The Forge editor should:
1. Show an unobtrusive "Click to enable audio" pill on first play-mode entry.
2. On click, create the `AudioListener`, attach to camera, load buffers.
3. Persist a `useEditor.audioReady = true` flag so subsequent play sessions don't re-prompt.

Never call `audio.play()` before the user has interacted — Chrome will silently drop the call and log a warning.

---

## 2. Listener + source — the three roles

```
┌── AudioListener (one) ───── attached to the camera ──┐
│                                                       │
│  AudioLoader  ── decodes a URL into an AudioBuffer    │
│                                                       │
│  Audio        ── non-positional (UI clicks, music)    │
│  PositionalAudio ── world-positioned (footsteps, SFX) │
└───────────────────────────────────────────────────────┘
```

```ts
const listener = new THREE.AudioListener();
camera.add(listener);                             // always parent to camera

const loader = new THREE.AudioLoader();
loader.load("/sounds/ping.mp3", (buffer) => {
  const sound = new THREE.PositionalAudio(listener);
  sound.setBuffer(buffer);
  sound.setRefDistance(2);                        // distance at which volume halves
  sound.setMaxDistance(30);
  sound.setRolloffFactor(1);
  ballMesh.add(sound);                            // position follows the parent
});
```

**Refdistance** is the single most important knob. Too low → sounds disappear 5 meters away. Too high → battlefield SFX bleed everywhere. Footsteps `1–2`, weapons `5–8`, explosions `15+`.

---

## 3. Perfect-timing playback (sync to physics / animation events)

To play a sound at the *exact* moment a ball hits the floor (or a sword hits flesh), watch for the state change yourself instead of relying on a generic "every N seconds" timer:

```ts
const previousY = ball.position.y;
ball.position.y = bounceCurve(t);
const goingDown = ball.position.y < previousY;

if (!goingDown && ball.userData.wasDown) {
  ball.children[0].play();                        // exactly at the bottom of the arc
  ball.userData.wasDown = false;
}
ball.userData.wasDown = goingDown;
```

For physics events, hook Rapier's contact-event stream and `play()` from the contact handler. Don't poll `body.linvel()` — you'll miss the impact frame.

---

## 4. Directional cones (megaphones, spotlights of sound)

Make a sound radiate forward more than backward (talking NPC, alarm, boombox):

```ts
positionalAudio.setDirectionalCone(
  innerAngleDeg,    // full volume within this cone (e.g., 180)
  outerAngleDeg,    // attenuating from inner to outer (e.g., 230)
  outerGain,        // volume outside the outer cone (0..1, e.g., 0.1)
);
```

The audio source uses the parent object's `+Z` as the cone axis. Rotate the parent to aim the cone.

For debugging, `PositionalAudioHelper` (from `three/addons/helpers/PositionalAudioHelper.js`) draws the cone in-scene — turn on only when an "Audio debug" toggle is set in the editor store.

---

## 5. Audio-reactive visualizers / shaders

`AudioAnalyser` reads FFT data each frame. Upload it into a `DataTexture` and any shader can react to it (TSL nodes too — see `threejs-tsl`):

```ts
const fftSize = 128;
const analyser = new THREE.AudioAnalyser(audio, fftSize);

const tAudio = new THREE.DataTexture(
  analyser.data,
  fftSize / 2, 1,
  THREE.RedFormat,
);

// In useFrame / animate():
analyser.getFrequencyData();
tAudio.needsUpdate = true;
```

Pass `tAudio` as a uniform to a shader; sample `texture2D(tAudioData, vec2(vUv.x, 0)).r` to drive bar heights, glow pulses, or geometry displacement. This pattern is what powers our "music-reactive emissive" prefab.

---

## 6. Streaming long audio (music) — use `setMediaElementSource`

`AudioLoader.load()` decodes the entire file into memory. For a 5-minute music track that's 50+ MB of PCM. Stream instead:

```html
<audio id="music" preload="auto" src="/music/track.mp3"></audio>
```
```ts
const el = document.getElementById("music");
el.play();
const positional = new THREE.PositionalAudio(listener);
positional.setMediaElementSource(el);
```

iOS Safari can't stream from `<audio>` reliably into Web Audio — feature-detect and fall back to `AudioLoader.load()` on iOS.

---

## 7. Occluders (sound-through-walls dampening)

Native Web Audio has **no** built-in occlusion. To simulate "the sound is behind a wall":

1. Raycast from listener to source on each "movement event" tick (not every frame).
2. If the ray hits an obstacle, ramp the source's volume to 0.3–0.5 over ~100 ms.
3. Restore on next clear ray.

For the editor, this is overkill — only add it in the Play runtime, and only for important sources flagged `userData.occludable = true`.

---

## 8. Gotchas

- **Listener on the camera, always.** If you parent it to the player body, third-person spatial audio gets confused because the camera and player aren't at the same point.
- **One listener per scene.** Multiple listeners is undefined behavior in WebAudio.
- **`audio.detune` and `audio.playbackRate`** can pitch-shift effects on the fly (footstep variation). Avoid loading 6 identical footstep variants when one + random detune does the job.
- **`audio.setLoop(true)` plus `audio.play()` in `useFrame`** is a foot-gun — `play()` restarts the buffer. Check `audio.isPlaying` first.
- **Dispose**: `audio.disconnect()` + `audio.context.close()` only when tearing down the whole listener. Per-source bodies are GC'd with their parents.

---

## See also

- `threejs-tsl` — for piping `tAudioData` into a TSL node graph.
- `forge-editor` — for where the Play-mode startup gesture should live (PlayHUD / Toolbar).
- `rapier-physics-patterns` — for the contact-event source of weapon / footstep triggers.
