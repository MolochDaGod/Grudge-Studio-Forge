// Install the three.js devtools bridge BEFORE any three.js / R3F module is
// imported. The official "three.js developer tools" Chrome extension hooks
// the `__THREE_DEVTOOLS__` global the moment it sees it, and observing
// scenes/renderers later still works — but creating the global up-front
// lets the extension capture object construction events for chunks that
// import three before the first React render.
import { ensureThreeDevtools } from "@/lib/threeDevtools";
ensureThreeDevtools();

// Wire Monaco's web-worker environment (TS/JSON/CSS/HTML language services)
// before any module that may construct a Monaco editor is evaluated.
import "@/lib/monacoEnv";

import { createRoot } from "react-dom/client";
import { Router, Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import { LandingPage } from "@/pages/LandingPage";
import { schedulePrefetchViewport } from "@/lib/prefetch";
import { registerPwa } from "@/lib/pwa";
import "./index.css";

const App = lazy(() => import("./App"));

function Root() {
  return (
    <Router>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route>
          <Suspense fallback={
            <div className="h-screen w-screen flex items-center justify-center bg-[#050608] text-white/30 text-sm">
              Loading editor…
            </div>
          }>
            <App />
          </Suspense>
        </Route>
      </Switch>
    </Router>
  );
}

registerPwa();
createRoot(document.getElementById("root")!).render(<Root />);

// Warm the heavy 3D viewport chunk in the background once the editor
// shell has had a chance to paint. The actual import happens on the next
// idle frame so it never competes with the critical render path. By the
// time the user opens or creates a project (the typical first action),
// the lazy import in `App.tsx` resolves from cache and the
// "Loading 3D viewport…" Suspense fallback is skipped entirely. See
// `src/lib/prefetch.ts` for the rationale and the Save-Data opt-out.
schedulePrefetchViewport();
