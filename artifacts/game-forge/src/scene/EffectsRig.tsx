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
    <EffectComposer multisampling={0}>
      <SSAO
        blendFunction={BlendFunction.MULTIPLY}
        samples={16}
        radius={0.12}
        intensity={18}
        luminanceInfluence={0.4}
        bias={0.025}
        worldDistanceThreshold={20}
        worldDistanceFalloff={5}
        worldProximityThreshold={0.4}
        worldProximityFalloff={0.1}
      />
      <Bloom
        intensity={0.55}
        luminanceThreshold={0.7}
        luminanceSmoothing={0.25}
        mipmapBlur
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette eskil={false} offset={0.18} darkness={0.5} />
      <SMAA />
    </EffectComposer>
  );
}
