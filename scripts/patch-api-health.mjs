import fs from "node:fs";

const p =
  "F:/GitHub/Grudge-Studio-Forge/Grudge-Studio-Forge/artifacts/api-server/dist-worker/index.js";
let c = fs.readFileSync(p, "utf8");
const re =
  /router\.get\(\s*"\/healthz"\s*,\s*\(c\)\s*=>\s*\{\s*const data = HealthCheckResponse\.parse\(\{\s*status:\s*"ok"\s*\}\);\s*return c\.json\(data\);\s*\}\s*\);/;
if (!re.test(c)) {
  console.error("pattern not found");
  // show nearby
  const i = c.indexOf('"/healthz"');
  console.error(JSON.stringify(c.slice(Math.max(0, i - 40), i + 160)));
  process.exit(1);
}
c = c.replace(
  re,
  `router.get("/healthz", (c) => { const data = HealthCheckResponse.parse({ status: "ok" }); return c.json(data); });
router.get("/health", (c) => { const data = HealthCheckResponse.parse({ status: "ok" }); return c.json(data); });`,
);
fs.writeFileSync(p, c);
const n = (c.match(/router\.get\(\s*"\/health/g) || []).length;
console.log("patched health routes:", n);
