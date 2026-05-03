/**
 * Cinematic post-processing pipeline.
 *
 * Composed effects (in render order):
 *   1. SSAO        — subtle screen-space contact shadows so primitives sit
 *                    in the world instead of floating.
 *   2. Bloom       — picks up emissive surfaces (gold trim, lights, fire VFX).
 *   3. Tone mapping — ACES filmic so highlights don't clip flat.
 *   4. Vignette    — soft darkening at the corners for cinematic framing.
 *   5. SMAA        — subpixel anti-aliasing; cheaper than MSAA at 4K and
 *                    plays nicely with the rest of the pipeline.
 *
 * The whole rig can be turned off (Performance mode) so weak GPUs can still
 * use the editor smoothly. We expose the "high quality" flag through the
 * editor store so a single Toolbar toggle drives every effect at once.
 */
import { EffectComposer, Bloom, Vignette, SMAA, ToneMapping, SSAO } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";

interface EffectsRigProps {
  /** When false, only SMAA + tone-mapping run (fast path). */
  highQuality?: boolean;
}

export function EffectsRig({ highQuality = true }: EffectsRigProps) {
  if (!highQuality) {
    return (
      <EffectComposer multisampling={0}>
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      {/*
        SSAO previously ran at intensity=18 / radius=0.12 — way above
        the postprocessing default (~5) — which painted heavy black
        blobs at every contact point and around any concave geometry,
        especially noticeable on the chicken_gun map textures. Dropped
        to a subtle intensity=2.5 / wider radius=0.25 so it grounds
        primitives without producing the "dirty smudges" you saw.
        World thresholds widened to match the new larger arena scale
        (~120 units across) so SSAO doesn't false-trigger across the
        whole map.
      */}
      <SSAO
        blendFunction={BlendFunction.MULTIPLY}
        samples={16}
        radius={0.25}
        intensity={2.5}
        luminanceInfluence={0.5}
        bias={0.04}
        worldDistanceThreshold={60}
        worldDistanceFalloff={15}
        worldProximityThreshold={1.2}
        worldProximityFalloff={0.4}
      />
      <Bloom
        intensity={0.55}
        luminanceThreshold={0.75}
        luminanceSmoothing={0.25}
        mipmapBlur
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/*
        Vignette darkness was 0.5 — unmistakable corner blackout on a
        wide viewport. 0.25 keeps the cinematic framing without
        crushing the corners.
      */}
      <Vignette eskil={false} offset={0.22} darkness={0.25} />
      <SMAA />
    </EffectComposer>
  );
}
