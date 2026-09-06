/**
 * Export FAST_ASSETS to public/catalog/fast-assets.json for SPA + edge worker.
 * Run: node scripts/export-fast-assets.mjs  (from artifacts/game-forge)
 * Or from root: node artifacts/game-forge/scripts/export-fast-assets.mjs
 *
 * Transpiles src/lib/fastAssets.ts with esbuild (CJS) and writes JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcPath = path.join(root, "src/lib/fastAssets.ts");
const outDir = path.join(root, "public/catalog");
const outPath = path.join(outDir, "fast-assets.json");

const src = fs.readFileSync(srcPath, "utf8");
const { transformSync } = await import("esbuild");
const { code } = transformSync(src, { loader: "ts", format: "cjs", target: "node18" });
const mod = { exports: {} };
Function("module", "exports", code)(mod, mod.exports);
const items = mod.exports.FAST_ASSETS;
if (!Array.isArray(items) || items.length === 0) {
  throw new Error("Parsed FAST_ASSETS empty");
}

const payload = {
  version: 1,
  generated: new Date().toISOString(),
  source: "lib/fastAssets.ts",
  count: items.length,
  items,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
// Also emit a compact copy for the free-ai worker to import as static
const workerDir = path.resolve(root, "../../workers/forge-free-ai");
fs.mkdirSync(workerDir, { recursive: true });
fs.writeFileSync(
  path.join(workerDir, "fast-assets.json"),
  JSON.stringify(payload),
  "utf8",
);
console.log(`Wrote ${items.length} items → ${outPath}`);
console.log(`Wrote worker copy → workers/forge-free-ai/fast-assets.json`);
