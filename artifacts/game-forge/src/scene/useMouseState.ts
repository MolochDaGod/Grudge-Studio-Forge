import { useEffect, useRef } from "react";
import type { MouseState } from "./csTranspile";

/**
 * Tracks the canvas pointer for the script runtime — buttons, position,
 * per-frame delta, pointer-lock state. Returns a ref whose `.current` is
 * mutated in place (no re-renders).
 *
 * Mouse delta is accumulated across pointermove events between frames; the
 * caller must call `consumeDelta()` at the end of each frame to reset
 * `dx`/`dy`. (We expose this on the ref via a trailing function.)
 */
export interface MouseStateRef {
  state: MouseState;
  /** Reset dx/dy after consuming the per-frame delta. */
  consumeDelta(): void;
}

export function useMouseState(canvasEl: HTMLElement | null): MouseStateRef {
  const stateRef = useRef<MouseState>({
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    left: false,
    right: false,
    middle: false,
    locked: false,
  });

  // Expose a stable wrapper so the consumer can hold one reference.
  const wrapperRef = useRef<MouseStateRef>({
    state: stateRef.current,
    consumeDelta() {
      stateRef.current.dx = 0;
      stateRef.current.dy = 0;
    },
  });

  useEffect(() => {
    if (!canvasEl) return;

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvasEl.getBoundingClientRect();
      stateRef.current.x = e.clientX - rect.left;
      stateRef.current.y = e.clientY - rect.top;
      // movementX/Y is the per-event delta and works even under pointer-lock,
      // when clientX/Y stops changing.
      stateRef.current.dx += e.movementX || 0;
      stateRef.current.dy += e.movementY || 0;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) stateRef.current.left = true;
      if (e.button === 1) stateRef.current.middle = true;
      if (e.button === 2) stateRef.current.right = true;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 0) stateRef.current.left = false;
      if (e.button === 1) stateRef.current.middle = false;
      if (e.button === 2) stateRef.current.right = false;
    };
    const onPointerLeave = () => {
      // Drop button states when pointer leaves to avoid stuck "left" if mouseup
      // happens outside the canvas.
      stateRef.current.left = false;
      stateRef.current.middle = false;
      stateRef.current.right = false;
    };
    const onLockChange = () => {
      stateRef.current.locked = document.pointerLockElement === canvasEl;
    };
    const onContextMenu = (e: MouseEvent) => {
      // Right-click is a gameplay button, not a context menu, while play mode
      // is active and pointer is inside the canvas.
      if (e.target === canvasEl) e.preventDefault();
    };

    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerdown", onPointerDown);
    // pointerup must be on window so a release outside the canvas still clears.
    window.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("pointerlockchange", onLockChange);
    canvasEl.addEventListener("contextmenu", onContextMenu);

    return () => {
      canvasEl.removeEventListener("pointermove", onPointerMove);
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("pointerlockchange", onLockChange);
      canvasEl.removeEventListener("contextmenu", onContextMenu);
    };
  }, [canvasEl]);

  return wrapperRef.current;
}
