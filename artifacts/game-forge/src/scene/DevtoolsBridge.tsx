import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import {
  ensureThreeDevtools,
  observeForDevtools,
  disposeForDevtools,
} from "@/lib/threeDevtools";

/**
 * Mount inside ANY R3F `<Canvas>` to register that Canvas's scene +
 * renderer with the official three.js devtools extension. Without it
 * the extension only ever sees the first Canvas it noticed at page load
 * — additional viewport tabs would be invisible to the inspector.
 *
 * The component renders nothing; it only side-effects on mount.
 *
 * Optionally annotates the scene with a human-readable name so multiple
 * tabs are easy to tell apart in the inspector tree (Scene / Model /
 * Prefab / etc.).
 */
export function DevtoolsBridge({ label }: { label?: string }) {
  const { scene, gl } = useThree();

  useEffect(() => {
    ensureThreeDevtools();
    if (label) scene.name = label;
    observeForDevtools(scene);
    observeForDevtools(gl);
    return () => {
      disposeForDevtools(scene);
      disposeForDevtools(gl);
    };
  }, [scene, gl, label]);

  return null;
}
