// Install the three.js devtools bridge BEFORE any three.js / R3F module is
// imported. The official "three.js developer tools" Chrome extension hooks
// the `__THREE_DEVTOOLS__` global the moment it sees it, and observing
// scenes/renderers later still works — but creating the global up-front
// lets the extension capture object construction events for chunks that
// import three before the first React render.
import { ensureThreeDevtools } from "@/lib/threeDevtools";
ensureThreeDevtools();

import { createRoot } from "react-dom/client";
import App from "./App";
import { schedulePrefetchViewport } from "@/lib/prefetch";
import { registerPwa } from "@/lib/pwa";
import "./index.css";

registerPwa();

// TEMP DEBUG: Replit's runtime-error-modal plugin filters stack frames whose
// URLs aren't in the Vite moduleGraph, which leaves us with a useless empty
// stack in the workflow log. Mirror every uncaught error / rejection to the
// console with the RAW stack so the workflow log captures something we can
// actually grep. This runs alongside (not instead of) the modal.
if (import.meta.env.DEV) {
  window.addEventListener("error", (evt) => {
    // eslint-disable-next-line no-console
    console.error(
      "[forge-debug] window error:",
      evt.error?.message ?? evt.message,
      "\nRAW STACK:\n",
      evt.error?.stack ?? "(no stack)",
    );
  });
  window.addEventListener("unhandledrejection", (evt) => {
    const reason = evt.reason as { message?: string; stack?: string } | null;
    // eslint-disable-next-line no-console
    console.error(
      "[forge-debug] unhandled rejection:",
      reason?.message ?? String(reason),
      "\nRAW STACK:\n",
      reason?.stack ?? "(no stack)",
    );
  });
}

createRoot(document.getElementById("root")!).render(<App />);

// Warm the heavy 3D viewport chunk in the background once the editor
// shell has had a chance to paint. The actual import happens on the next
// idle frame so it never competes with the critical render path. By the
// time the user opens or creates a project (the typical first action),
// the lazy import in `App.tsx` resolves from cache and the
// "Loading 3D viewport…" Suspense fallback is skipped entirely. See
// `src/lib/prefetch.ts` for the rationale and the Save-Data opt-out.
schedulePrefetchViewport();
