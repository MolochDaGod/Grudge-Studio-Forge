/**
 * Built-in starter scenes ("templates" / "example maps") for the Grudge
 * GameForge editor.
 *
 * The builders are pure functions returning {@link SceneData} — no DOM,
 * no Three.js, no React. They are consumed by:
 *
 *   • the api-server, which on boot materializes each builder's output to
 *     object storage at `templates/<version>/<key>.gfscene.json` and
 *     serves them over the REST API;
 *   • the editor (game-forge), which fetches them through that REST API
 *     and shows a real progress-bar while the JSON streams in.
 *
 * Bumping {@link TEMPLATES_VERSION} triggers the seeder to upload a fresh
 * versioned copy on next boot — old versions stay in object storage for
 * already-published scenes that may have linked the older URL.
 */
import type { SceneData } from "@workspace/scene-schema";

import {
  characterShowcaseScene,
  cyberpunkDeathmatchScene,
  deserttownDeathmatchScene,
  encampmentDeathmatchScene,
  fortRoyaleDeathmatchScene,
  fpsArenaScene,
  tpsZombieDemoScene,
  winterBaseDeathmatchScene,
  yardDeathmatchScene,
} from "./builders.js";

/** Bump when ANY built-in template's content changes so the seeder writes
 *  a fresh, immutable, versioned object key. The previous version's
 *  files are intentionally left in place so older `?scene=…` links keep
 *  resolving. Format: yyyymmdd.n */
export const TEMPLATES_VERSION = "20260501.1";

export interface TemplateManifestEntry {
  /** URL-safe key — also the object-storage filename. */
  key: string;
  /** User-facing label shown in the picker. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  /** Pure function that returns the scene JSON. The api-server invokes
   *  this exactly once per version during the seed step. */
  build: () => SceneData;
}

export const SCENE_TEMPLATES: TemplateManifestEntry[] = [
  {
    key: "character-showcase",
    label: "Character + Rifle Showcase",
    description:
      "A single rigged character holding the bundled rifle on a lit ground plane — quick asset reference.",
    build: characterShowcaseScene,
  },
  {
    key: "tps-zombies",
    label: "TPS — Zombie Graveyard",
    description:
      "Third-person sandbox: rigged character player with parented rifle, 6 NPC zombies, crypt walls, brazier light.",
    build: tpsZombieDemoScene,
  },
  {
    key: "fps-arena",
    label: "FPS — Turret Arena",
    description:
      "First-person arena: cylinder player with parented rifle GLB, 3 turrets, crates, spotlight.",
    build: fpsArenaScene,
  },
  {
    key: "dm-cyberpunk",
    label: "Deathmatch — Cyberpunk City",
    description:
      "First-to-10 deathmatch on the neon cyberpunk map. 6 Yuka-driven AI enemies, multi-spawn respawn, full HUD.",
    build: cyberpunkDeathmatchScene,
  },
  {
    key: "dm-encampment",
    label: "Deathmatch — Forest Encampment",
    description:
      "First-to-10 deathmatch in the wooded encampment. 7 AI enemies, warm firelight, full HUD.",
    build: encampmentDeathmatchScene,
  },
  {
    key: "dm-deserttown",
    label: "Deathmatch — Desert Town",
    description:
      "First-to-10 deathmatch in the sun-baked desert town. 6 AI enemies, harsh midday sun, full HUD.",
    build: deserttownDeathmatchScene,
  },
  {
    key: "dm-fort-royale",
    label: "Deathmatch — Fort Royale",
    description:
      "First-to-10 deathmatch inside a small medieval fort. 6 AI enemies, four corner braziers, fastest-loading map.",
    build: fortRoyaleDeathmatchScene,
  },
  {
    key: "dm-yard",
    label: "Deathmatch — Yard",
    description:
      "First-to-10 deathmatch in an open industrial yard. 6 AI enemies, broad daylight, full HUD.",
    build: yardDeathmatchScene,
  },
  {
    key: "dm-winter-base",
    label: "Deathmatch — Winter Base",
    description:
      "First-to-10 deathmatch in a snowy fortified base. 6 AI enemies, cool overcast lighting, full HUD.",
    build: winterBaseDeathmatchScene,
  },
];

/** Lightweight summary surfaced over the REST API and used by the editor's
 *  picker UI. Distinct from {@link TemplateManifestEntry} because the API
 *  does NOT ship the `build` function — it ships a reference plus byte
 *  metadata so the client can render an accurate progress bar. */
export interface TemplateApiManifest {
  key: string;
  label: string;
  description: string;
  /** Number of root + descendant entities, computed from build output. */
  entityCount: number;
  /** Stringified JSON byte length — drives the progress bar denominator. */
  byteSize: number;
  /** Versioned object-storage path the download endpoint streams from. */
  storagePath: string;
  /** Schema version this template was built against. */
  version: string;
}

export {
  characterShowcaseScene,
  cyberpunkDeathmatchScene,
  deserttownDeathmatchScene,
  encampmentDeathmatchScene,
  fortRoyaleDeathmatchScene,
  fpsArenaScene,
  tpsZombieDemoScene,
  winterBaseDeathmatchScene,
  yardDeathmatchScene,
  withIdScope,
} from "./builders.js";
