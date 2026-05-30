#!/usr/bin/env node
/**
 * Generate favicon.ico, PWA icons, and OG image from a source logo PNG.
 *
 * Usage:
 *   node scripts/generate-icons.mjs <source-logo.png>
 *
 * Outputs (written to artifacts/game-forge/public/):
 *   favicon.ico          32px PNG renamed (browsers accept PNG in .ico)
 *   logo.png             ~1200×630 OG image (logo centered on dark bg)
 *   pwa-192.png          192×192 PWA icon
 *   pwa-512.png          512×512 PWA icon
 *   pwa-512-maskable.png 512×512 with safe-zone padding
 *
 * Requires: npx sharp-cli (auto-installed on first run)
 */
import { execSync } from "child_process";
import { existsSync, copyFileSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "artifacts", "game-forge", "public");
const src = process.argv[2];

if (!src || !existsSync(src)) {
  console.error("Usage: node scripts/generate-icons.mjs <source-logo.png>");
  console.error("  The source should be a square PNG, ideally 1024×1024+.");
  process.exit(1);
}

function run(cmd) {
  execSync(cmd, { stdio: "pipe" });
}

console.log(`Generating icons from: ${src}\n`);

// PWA 192×192
run(`npx --yes sharp-cli -i "${src}" -o "${resolve(OUT, "pwa-192.png")}" resize 192 192`);
console.log("  ✓ pwa-192.png");

// PWA 512×512
run(`npx --yes sharp-cli -i "${src}" -o "${resolve(OUT, "pwa-512.png")}" resize 512 512`);
console.log("  ✓ pwa-512.png");

// PWA 512 maskable — same as 512 (manual padding can be done in an image editor)
run(`npx --yes sharp-cli -i "${src}" -o "${resolve(OUT, "pwa-512-maskable.png")}" resize 512 512`);
console.log("  ✓ pwa-512-maskable.png");

// OG image — 1200×1200 square (social platforms crop as needed)
run(`npx --yes sharp-cli -i "${src}" -o "${resolve(OUT, "logo.png")}" resize 1200 1200`);
console.log("  ✓ logo.png (OG image)");

// Favicon — 32px PNG renamed to .ico (browsers accept PNG inside .ico)
const tmpIco = resolve(OUT, "_tmp_ico.png");
run(`npx --yes sharp-cli -i "${src}" -o "${tmpIco}" resize 32 32`);
copyFileSync(tmpIco, resolve(OUT, "favicon.ico"));
rmSync(tmpIco, { force: true });
console.log("  ✓ favicon.ico (32px)");

console.log("\nDone! All icons written to artifacts/game-forge/public/");
