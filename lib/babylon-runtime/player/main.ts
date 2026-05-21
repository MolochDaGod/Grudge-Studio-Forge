/**
 * Grudge GameForge — Babylon.js standalone player.
 *
 * Reads a scene URL from `?scene=<url>` query param (or falls back to
 * `./scene.json` for local dev). Boots a Babylon Engine, creates a
 * GrudgeBabylonLoader, loads the scene, and starts the render loop.
 *
 * Usage:
 *   pnpm --filter @workspace/babylon-runtime run dev
 *   open http://localhost:4200?scene=https://assets.grudge-studio.com/ai-snapshots/demo/scene.gfscene.json
 */
import { Engine } from "@babylonjs/core";
import { GrudgeBabylonLoader } from "@babylon-runtime/loader";
import type { SceneData } from "@workspace/scene-schema";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const loadingEl = document.getElementById("loading")!;
const errorEl = document.getElementById("error")!;

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
  loadingEl.classList.add("hidden");
}

async function boot() {
  // Resolve scene URL
  const params = new URLSearchParams(window.location.search);
  const sceneUrl = params.get("scene") || "./scene.json";

  // Fetch scene JSON
  let sceneData: SceneData;
  try {
    const res = await fetch(sceneUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sceneData = (await res.json()) as SceneData;
    if (!sceneData.entities || !Array.isArray(sceneData.entities)) {
      throw new Error("Invalid scene: missing entities array");
    }
  } catch (err) {
    showError(`Failed to load scene: ${(err as Error).message}\n${sceneUrl}`);
    return;
  }

  // Boot Babylon
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
  });

  const loader = new GrudgeBabylonLoader(engine, canvas, {
    builtinBaseUrl: params.get("builtins") || "",
    apiBaseUrl: params.get("api") || "",
    enablePhysics: false, // Havok not loaded in this minimal player
    onEntityCreated: (id, node) => {
      console.log(`[babylon-player] Entity "${node.name}" (${id})`);
    },
  });

  try {
    await loader.load(sceneData);
  } catch (err) {
    showError(`Scene build failed: ${(err as Error).message}`);
    return;
  }

  // Hide loading overlay
  loadingEl.classList.add("hidden");

  // Render loop
  engine.runRenderLoop(() => {
    loader.scene.render();
  });

  // Resize
  window.addEventListener("resize", () => {
    engine.resize();
  });

  // Expose for console debugging
  (window as unknown as Record<string, unknown>).__grudge = {
    engine,
    loader,
    scene: loader.scene,
  };
}

boot();
