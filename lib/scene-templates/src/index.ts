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
 *
 * The shipped set is intentionally curated:
 *   • Three deathmatch maps — one per visual biome (neon city /
 *     medieval fort / wooded forest) — each modeled after the
 *     Mugen87/dive sample game: full parent/child hierarchy, Yuka-driven
 *     AI prefabs, player + enemy behavior scripts, and a hidden
 *     GameManager entity running the gamemode-deathmatch script
 *     (score tracking + win/lose).
 *   • One RPG starter — a small desert-town village populated with one
 *     of each race (warrior / dwarf / frost-dwarf / elf / orc /
 *     skeleton). Player is the warrior; enemies use the existing
 *     enemy-deathmatch behavior so combat works out of the box.
 */
import type { SceneData } from "@workspace/scene-schema";

import {
  cyberpunkDeathmatchScene,
  encampmentDeathmatchScene,
  rtsFortRoyaleScene,
  rpgVillageScene,
} from "./builders.js";

/** Bump when ANY built-in template's content changes so the seeder writes
 *  a fresh, immutable, versioned object key. The previous version's
 *  files are intentionally left in place so older `?scene=…` links keep
 *  resolving. Format: yyyymmdd.n
 *
 *  20260514.1: Replaced the Fort Royale deathmatch (`dm-fort-royale`)
 *  with the new Warcraft-2-style RTS template (`rts-fort-royale`) —
 *  PR-1 of the RTS conversion. */
export const TEMPLATES_VERSION = "20260514.2";

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
    key: "dm-cyberpunk",
    label: "Deathmatch — Cyberpunk City",
    description:
      "First-to-10 deathmatch on the neon cyberpunk map. 6 Yuka-driven AI enemies, multi-spawn respawn, full HUD.",
    build: cyberpunkDeathmatchScene,
  },
  {
    key: "rts-fort-royale",
    label: "RTS — Fort Royale (Warcraft-2 style)",
    description:
      "Real-time strategy on the medieval fort map. Command a peon (auto-gathers gold) and a footman (auto-engages enemies) against a mirror enemy base. PR-1 foundation for the full WC2-style mode.",
    build: rtsFortRoyaleScene,
  },
  {
    key: "dm-encampment",
    label: "Deathmatch — Forest Encampment",
    description:
      "First-to-10 deathmatch in the wooded encampment. 7 AI enemies, warm firelight, full HUD.",
    build: encampmentDeathmatchScene,
  },
  {
    key: "rpg-village",
    label: "RPG — Village (All Races)",
    description:
      "Small desert-town village with one of each race (warrior, dwarf, frost-dwarf, elf, orc, skeleton). Great starting point for an RPG-style game.",
    build: rpgVillageScene,
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
  cyberpunkDeathmatchScene,
  encampmentDeathmatchScene,
  rtsFortRoyaleScene,
  rpgVillageScene,
  withIdScope,
} from "./builders.js";
