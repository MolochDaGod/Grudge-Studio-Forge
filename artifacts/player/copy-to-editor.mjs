#!/usr/bin/env node
/**
 * Post-build hook: copy the player's single-file bundle into the editor's
 * `public/` directory so the deployed editor serves it at
 * `/player.html`.
 *
 * `puterPublish.ts` fetches `${editorOrigin}player.html` at publish time
 * and uploads the bytes to the user's Puter hosting bucket alongside
 * `scene.json`.
 *
 * Run as part of `pnpm --filter @workspace/player run build`. Idempotent.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "dist", "index.html");
const DEST = resolve(__dirname, "..", "game-forge", "public", "player.html");

if (!existsSync(SRC)) {
  console.error(`[player] build output not found: ${SRC}`);
  process.exit(1);
}

mkdirSync(dirname(DEST), { recursive: true });
copyFileSync(SRC, DEST);
console.log(`[player] copied ${SRC} -> ${DEST}`);
