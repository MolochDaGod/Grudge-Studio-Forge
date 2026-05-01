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
  // The Replit browser-console capture only mirrors log/info/debug, so we
  // use console.log (NOT console.error) for these debug breadcrumbs. We
  // also POST the same payload to the dev server so a copy lands in the
  // workflow log even if the browser console gets cleared/rotated. Keep
  // it gated behind import.meta.env.DEV so it never ships to prod.
  const reportToServer = (kind: string, message: string, stack: string) => {
    try {
      void fetch("/__forge_debug_log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, message, stack }),
      });
    } catch {
      /* best-effort */
    }
  };
  window.addEventListener("error", (evt) => {
    const msg = evt.error?.message ?? String(evt.message ?? "(no message)");
    const stack = evt.error?.stack ?? "(no stack)";
    // eslint-disable-next-line no-console
    console.log("[forge-debug] window error:", msg, "\nRAW STACK:\n", stack);
    reportToServer("error", msg, stack);
  });
  window.addEventListener("unhandledrejection", (evt) => {
    const reason = evt.reason as { message?: string; stack?: string } | null;
    const msg = reason?.message ?? String(reason);
    const stack = reason?.stack ?? "(no stack)";
    // eslint-disable-next-line no-console
    console.log("[forge-debug] unhandled rejection:", msg, "\nRAW STACK:\n", stack);
    reportToServer("rejection", msg, stack);
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
