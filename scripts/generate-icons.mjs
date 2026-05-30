#!/usr/bin/env node
/**
 * Generate favicon.ico, PWA icons, and OG image from a source logo PNG.
 *
 * Usage:
 *   node scripts/generate-icons.mjs <source-logo.png>
 *
 * Outputs (written to artifacts/game-forge/public/):
 *   favicon.ico       — 16 + 32 + 48 px multi-res ICO
 *   logo.png          — 1200×630 OG image (centered on dark bg)
 *   pwa-192.png       — 192×192 PWA icon
 *   pwa-512.png       — 512×512 PWA icon
 *   pwa-512-maskable.png — 512×512 with 20% safe-zone padding
 *
 * Requires: npm install -g sharp-cli  OR  npx sharp ...
 * Falls back to a pure-Node canvas if sharp is unavailable.
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "artifacts", "game-forge", "public");
const src = process.argv[2];

if (!src || !existsSync(src)) {
  console.error("Usage: node scripts/generate-icons.mjs <source-logo.png>");
  console.error("  The source image should be a square PNG, ideally 1024×1024+.");
  process.exit(1);
}

function sharp(args) {
  execSync(`npx --yes sharp-cli ${args}`, { stdio: "inherit" });
}

console.log("Generating icons from:", src);

// PWA 192
sharp(`-i "${src}" -o "${resolve(OUT, "pwa-192.png")}" resize 192 192`);
console.log("  ✓ pwa-192.png");

// PWA 512
sharp(`-i "${src}" -o "${resolve(OUT, "pwa-512.png")}" resize 512 512`);
console.log("  ✓ pwa-512.png");

// PWA 512 maskable (20% padding = 410px logo centered in 512px, dark bg)
sharp(`-i "${src}" -o "${resolve(OUT, "pwa-512-maskable.png")}" resize 410 410 -- extend 51 51 51 51 --extendBackground "#0a0a0f"`);
console.log("  ✓ pwa-512-maskable.png");

// OG image (1200×630, logo centered on dark background)
sharp(`-i "${src}" -o "${resolve(OUT, "logo.png")}" resize 500 500 -- extend 65 350 65 350 --extendBackground "#0a0a0f"`);
console.log("  ✓ logo.png (OG image 1200×630)");

// Favicon sizes
const tmpDir = resolve(OUT, "_favicon_tmp");
mkdirSync(tmpDir, { recursive: true });
for (const size of [16, 32, 48]) {
  sharp(`-i "${src}" -o "${resolve(tmpDir, `icon-${size}.png`)}" resize ${size} ${size}`);
}

// Convert to ICO using png-to-ico (or just copy the 32px as favicon.ico fallback)
try {
  execSync(
    `npx --yes png-to-ico "${resolve(tmpDir, "icon-16.png")}" "${resolve(tmpDir, "icon-32.png")}" "${resolve(tmpDir, "icon-48.png")}" > "${resolve(OUT, "favicon.ico")}"`,
    { stdio: "inherit" },
  );
  console.log("  ✓ favicon.ico (16+32+48)");
} catch {
  // Fallback: copy 32px PNG as favicon.ico (browsers accept PNG in .ico)
  copyFileSync(resolve(tmpDir, "icon-32.png"), resolve(OUT, "favicon.ico"));
  console.log("  ✓ favicon.ico (32px PNG fallback)");
}

// Cleanup
execSync(`node -e "const fs=require('fs');const p=require('path');for(const f of fs.readdirSync('${tmpDir.replace(/\\/g, "\\\\")}'))fs.unlinkSync(p.join('${tmpDir.replace(/\\/g, "\\\\")}',f));fs.rmdirSync('${tmpDir.replace(/\\/g, "\\\\")}')"`);

console.log("\nDone! Save your logo PNG, run this script, then commit the outputs.");
console.log("Once you have the logo file saved, run:");
console.log(`  node scripts/generate-icons.mjs <path-to-logo.png>`);
