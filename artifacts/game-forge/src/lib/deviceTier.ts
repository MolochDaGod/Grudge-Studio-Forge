/**
 * Device-tier render quality using detect-gpu.
 * Only applies when the user has not forced a quality preference.
 */
import { getGPUTier } from "detect-gpu";
import { useEditor } from "@/store/editor";

const PREF_KEY = "grudge.forge.renderQuality.user";

export type RenderQuality = "high" | "perf";

export function getUserRenderQualityPref(): RenderQuality | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "high" || v === "perf") return v;
  } catch {
    /* private mode */
  }
  return null;
}

export function setUserRenderQualityPref(q: RenderQuality): void {
  try {
    localStorage.setItem(PREF_KEY, q);
  } catch {
    /* ignore */
  }
  useEditor.getState().setRenderQuality(q);
}

/**
 * Probe GPU tier once at boot. Tier 0–1 → perf; 2+ → high.
 * Skipped if the user already chose quality in the View menu.
 */
export async function applyDetectedRenderQuality(): Promise<RenderQuality> {
  const forced = getUserRenderQualityPref();
  if (forced) {
    useEditor.getState().setRenderQuality(forced);
    return forced;
  }
  try {
    const result = await getGPUTier();
    // detect-gpu: 0 = fallback/unknown, 1 = low, 2 = mid, 3 = high
    const q: RenderQuality =
      result.isMobile || result.tier <= 1 ? "perf" : "high";
    useEditor.getState().setRenderQuality(q);
    return q;
  } catch {
    useEditor.getState().setRenderQuality("high");
    return "high";
  }
}
