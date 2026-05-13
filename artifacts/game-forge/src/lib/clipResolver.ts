import type * as THREE from "three";

/**
 * Single point of truth for "which AnimationClip should this rig play
 * for clip name `X`?" — used by `EntityRenderer.LoadedModel` and the
 * AssetBrowser preview both.
 *
 * Priority order (first match wins):
 *
 *   1. **Retargeted Mixamo clips** — user-imported. Always preferred
 *      because they're authored, hand-tuned content the project
 *      explicitly opted into.
 *   2. **GLB-baked clips** — from `gltf.animations`. Some non-toon-rts
 *      character GLBs (e.g. our bundled `builtin:character`) ship with
 *      real animations and we want those over the synthesizer.
 *   3. **Procedurally synthesized clips** — `synthesizeBipedClips`.
 *      The fallback for the toon-rts pack (which ships with zero
 *      baked animations).
 *
 * Why a separate module rather than inlining in LoadedModel: the
 * AssetBrowser drop-zone preview, the prefab editor's viewport, and
 * any future clip-debugger UI all need the SAME priority decision. A
 * single function keeps them in lockstep — adding a new clip source
 * (e.g. cloud-cached retargets) becomes a one-line edit.
 *
 * Pure: no THREE imports beyond types. Lookups are by clip NAME
 * (`"idle"`, `"walk"`, `"rifle_aim"`, …) which is the only stable
 * identifier across all three sources.
 */

export interface ClipSources {
  /** Retargeted Mixamo clips, typically produced by the asset-browser
   *  drop-zone after running `retargetMixamoClip` against the entity's
   *  race rig. May be undefined when no Mixamo content has been
   *  imported for this race. */
  retargeted?: readonly THREE.AnimationClip[];
  /** Clips baked into the source GLB (`gltf.animations`). Will be
   *  empty for the toon-rts character pack — the synthesizer fallback
   *  picks up the slack in that case. */
  baked: readonly THREE.AnimationClip[];
  /** Procedural fallback clips from `synthesizeBipedClips`. Empty for
   *  any rig that isn't a Bip001 biped. */
  synthesized?: readonly THREE.AnimationClip[];
}

/** Resolve a single clip by name across the three sources. Returns
 *  `undefined` when no source has the clip — caller must handle this
 *  (typically by falling back to "idle", or skipping the crossfade
 *  entirely so the current pose holds). */
export function resolveClip(
  name: string,
  sources: ClipSources,
): THREE.AnimationClip | undefined {
  if (sources.retargeted) {
    const r = sources.retargeted.find((c) => c.name === name);
    if (r) return r;
  }
  const b = sources.baked.find((c) => c.name === name);
  if (b) return b;
  if (sources.synthesized) {
    const s = sources.synthesized.find((c) => c.name === name);
    if (s) return s;
  }
  return undefined;
}

/** Build the unified clip array `useAnimations` consumes — the union
 *  of all three sources, deduped by name with the same priority order
 *  as {@link resolveClip}. drei's `useAnimations` keys actions by
 *  `clip.name`, so a duplicate name from a lower-priority source would
 *  silently win the binding contest in unspecified order. Deduping
 *  here makes the priority deterministic.
 *
 *  Returns a fresh array — never mutates the input arrays — so the
 *  caller can pass the result straight to React state without worrying
 *  about referential aliasing. */
export function unifyClips(sources: ClipSources): THREE.AnimationClip[] {
  const seen = new Set<string>();
  const out: THREE.AnimationClip[] = [];
  const layers: ReadonlyArray<readonly THREE.AnimationClip[] | undefined> = [
    sources.retargeted,
    sources.baked,
    sources.synthesized,
  ];
  for (const layer of layers) {
    if (!layer) continue;
    for (const c of layer) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
  }
  return out;
}
