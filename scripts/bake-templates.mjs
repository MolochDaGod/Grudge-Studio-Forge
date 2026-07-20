/**
 * Bake scene-templates into game-forge public/builtin for offline fallback.
 * Usage: node --import tsx scripts/bake-templates.mjs
 *    or: npx tsx scripts/bake-templates.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { SCENE_TEMPLATES, TEMPLATES_VERSION } = await import(
  "../lib/scene-templates/src/index.ts"
);

const outDir = resolve(root, "artifacts/game-forge/public/builtin/templates");
mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const t of SCENE_TEMPLATES) {
  const scene = t.build();
  const json = JSON.stringify(scene);
  writeFileSync(resolve(outDir, t.key), json);
  writeFileSync(resolve(outDir, `${t.key}.json`), json);
  manifest.push({
    key: t.key,
    label: t.label,
    description: t.description,
    entityCount: scene.entities.length,
    byteSize: Buffer.byteLength(json),
    storagePath: `templates/${TEMPLATES_VERSION}/${t.key}.gfscene.json`,
    version: TEMPLATES_VERSION,
  });
  console.log(
    `${t.key}: ${scene.entities.length} entities, ${Buffer.byteLength(json)} bytes`,
  );
}

writeFileSync(
  resolve(root, "artifacts/game-forge/public/builtin/template-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`TEMPLATES_VERSION=${TEMPLATES_VERSION}`);
console.log(`Wrote ${manifest.length} templates + manifest`);

const rts = SCENE_TEMPLATES.find((t) => t.key === "rts-fort-royale");
if (rts) {
  const s = rts.build();
  const bld = s.entities
    .filter((e) => e.behavior === "rts-building" || e.behavior === "rts-tower")
    .map((e) => e.name);
  console.log("RTS buildings:", bld.join(", "));
  console.log(
    "RTS units:",
    s.entities.filter((e) =>
      ["rts-peon", "rts-footman", "rts-archer", "rts-creep"].includes(
        e.behavior || "",
      ),
    ).length,
  );
}
