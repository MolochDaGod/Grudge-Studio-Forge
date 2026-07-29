/**
 * Export FAST_ASSETS to public/catalog/fast-assets.json for SPA + edge worker.
 * Run: node scripts/export-fast-assets.mjs  (from artifacts/game-forge)
 * Or from root: node artifacts/game-forge/scripts/export-fast-assets.mjs
 *
 * Parses src/lib/fastAssets.ts without a TS loader (simple object-literal extract).
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
const start = src.indexOf("export const FAST_ASSETS");
if (start < 0) throw new Error("FAST_ASSETS not found");
// Skip TypeScript array type annotation: FAST_ASSETS: FastAsset[] = [
const eq = src.indexOf("=", start);
const bracket = src.indexOf("[", eq >= 0 ? eq : start);
let depth = 0;
let end = -1;
for (let i = bracket; i < src.length; i++) {
  const c = src[i];
  if (c === "[") depth++;
  else if (c === "]") {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
if (end < 0) throw new Error("Could not find end of FAST_ASSETS array");
// Strip TS-only trailing commas before } and type assertions — eval as JS
let lit = src.slice(bracket, end);
// Strip line + block comments so Function() can eval
lit = lit.replace(/\/\*[\s\S]*?\*\//g, "");
lit = lit.replace(/\/\/[^\n]*/g, "");
// Remove trailing commas in objects/arrays
lit = lit.replace(/,(\s*[}\]])/g, "$1");
let items;
try {
  items = Function(`"use strict"; return (${lit});`)();
} catch (e) {
  throw new Error(`Parse FAST_ASSETS failed: ${e.message}\n${lit.slice(0, 180)}`);
}
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
