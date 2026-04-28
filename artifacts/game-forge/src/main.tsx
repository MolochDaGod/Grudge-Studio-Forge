import { createRoot } from "react-dom/client";
import App from "./App";
import { schedulePrefetchViewport } from "@/lib/prefetch";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Warm the heavy 3D viewport chunk in the background once the editor
// shell has had a chance to paint. The actual import happens on the next
// idle frame so it never competes with the critical render path. By the
// time the user opens or creates a project (the typical first action),
// the lazy import in `App.tsx` resolves from cache and the
// "Loading 3D viewport…" Suspense fallback is skipped entirely. See
// `src/lib/prefetch.ts` for the rationale and the Save-Data opt-out.
schedulePrefetchViewport();
