import * as React from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { SceneData } from "@workspace/scene-schema";
import type { Script } from "@workspace/api-client-react";
import { useEditor } from "./playerStore";
import { PlayerScene } from "./PlayerScene";

/**
 * Entry point for the standalone player.
 *
 * Boot sequence:
 *   1. Fetch `./scene.json` (sibling of this HTML on Puter hosting).
 *   2. Fetch `./scripts.json` in parallel — the published bundle's
 *      compiled scripts the runtime ticks each frame. Always present
 *      (publishScene writes `[]` when the project has no scripts).
 *   3. Validate that scene.json is a SceneData-shaped object.
 *   4. Push both into the player store, mount `<PlayerScene/>`.
 *
 * Any failure renders a clear error screen rather than a blank canvas.
 * Scripts that fail to load are non-fatal: we render the scene without
 * scripted behavior rather than refuse to start.
 */

interface ErrorScreenProps {
  message: string;
  detail?: string;
}

function ErrorScreen({ message, detail }: ErrorScreenProps): React.ReactElement {
  return (
    <div className="player-status" style={{ color: "#ff6b6b" }}>
      <div style={{ fontWeight: 600 }}>{message}</div>
      {detail ? (
        <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7, maxWidth: 480, textAlign: "center" }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function App(): React.ReactElement {
  // Read a dedicated `loaded` flag rather than `entities.length > 0`:
  // an intentionally empty published scene (e.g. a blank skybox the
  // user shipped on purpose) must still render the empty world, not
  // hang on a "Loading scene…" spinner forever.
  const loaded = useEditor((s) => s.loaded);
  if (!loaded) {
    return (
      <div className="player-status">
        <div className="spinner" />
        <div>Loading scene…</div>
      </div>
    );
  }
  return <PlayerScene />;
}

async function fetchScripts(): Promise<Script[]> {
  try {
    const res = await fetch("./scripts.json", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as Script[]) : [];
  } catch {
    // Network/parse failure → render without scripts rather than aborting.
    return [];
  }
}

async function bootstrap(): Promise<void> {
  const root = createRoot(document.getElementById("root")!);
  try {
    const [sceneRes, scripts] = await Promise.all([
      fetch("./scene.json", { cache: "no-store" }),
      fetchScripts(),
    ]);
    if (!sceneRes.ok) {
      throw new Error(`scene.json fetch failed: ${sceneRes.status} ${sceneRes.statusText}`);
    }
    const json = (await sceneRes.json()) as unknown;
    if (
      !json ||
      typeof json !== "object" ||
      !Array.isArray((json as { entities?: unknown }).entities)
    ) {
      throw new Error("scene.json is not a valid SceneData object");
    }
    useEditor.getState().setScene(json as SceneData);
    useEditor.getState().setScripts(scripts);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    root.render(<ErrorScreen message="Could not load scene" detail={detail} />);
  }
}

void bootstrap();
