import { useEffect, useRef } from "react";

export function useKeyboardState(active: boolean) {
  const keysRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!active) {
      keysRef.current = {};
      return;
    }
    const down = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
      keysRef.current[e.key] = true;
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
      keysRef.current[e.key] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [active]);

  return keysRef;
}
