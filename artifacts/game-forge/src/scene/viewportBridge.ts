/**
 * Module-level singleton holding the current Three.js renderer / scene /
 * camera / orbit-controls for the active editor viewport. Populated by a
 * tiny `<ViewportBridge />` component mounted inside the R3F Canvas.
 *
 * Lets non-React code (AI tools, screenshot capture, camera framing) reach
 * the live renderer without prop-drilling or React Context. There is only
 * ever one editor Canvas mounted at a time, so a singleton is sufficient.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three";

export interface ViewportBridgeRef {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** OrbitControls instance (when present in edit mode). */
  controls: { target: THREE.Vector3; update?: () => void } | null;
}

let current: ViewportBridgeRef | null = null;

export function setViewportBridge(b: ViewportBridgeRef | null): void {
  current = b;
}

export function getViewportBridge(): ViewportBridgeRef | null {
  return current;
}

/** Mount inside the R3F Canvas. Renders nothing. */
export function ViewportBridge(): null {
  const { gl, scene, camera, controls } = useThree();
  useEffect(() => {
    setViewportBridge({
      gl,
      scene,
      camera,
      controls: (controls as ViewportBridgeRef["controls"]) ?? null,
    });
    return () => {
      if (current?.gl === gl) setViewportBridge(null);
    };
  }, [gl, scene, camera, controls]);
  return null;
}
