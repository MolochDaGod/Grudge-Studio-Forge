#!/usr/bin/env node
/**
 * Merge per-clip GLB animations onto a mesh GLB by matching node names.
 *
 * Used to bake the Mutant character's Mixamo FBX clip pack into a single
 * runtime-friendly `creature-mutant.glb`. The source FBX files live in
 * `attached_assets/Creature_NPC_Pack_*.zip`; this script is the
 * reproducibility record of how `artifacts/game-forge/public/builtin/
 * creature-mutant.glb` was produced.
 *
 * Pipeline (run manually — not part of the dev workflow because the
 * source FBXs are not committed and the output is checked in):
 *   1. unzip the FBX pack to a working dir
 *   2. FBX2glTF --binary -i rac.fbx                -o tmp/mesh
 *   3. FBX2glTF --binary -i "<clip>.fbx"           -o tmp/clip_<name>
 *   4. node merge_creature_animations.mjs tmp/mesh.glb tmp/ out.glb \
 *        clip_mutant_idle=idle clip_mutant_walking=walk ...
 *   5. gltf-transform draco out.glb out_draco.glb
 *
 * Bone names must match between the mesh skeleton and each clip GLB
 * (Mixamo's `mixamorig:Hips/…` naming makes this trivial — every clip
 * targets the same rig).
 */
import { NodeIO } from "@gltf-transform/core";
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";

const [meshPath, clipsDir, outPath, ...renames] = process.argv.slice(2);
if (!meshPath || !clipsDir || !outPath) {
  console.error("usage: merge_creature_animations.mjs <mesh.glb> <clipsDir> <out.glb> [stem=newName ...]");
  process.exit(2);
}
const renameMap = Object.fromEntries(renames.map((r) => r.split("=")));

const io = new NodeIO();
const meshDoc = await io.read(meshPath);
const meshRoot = meshDoc.getRoot();
for (const a of meshRoot.listAnimations()) a.dispose();

const meshNodesByName = new Map();
for (const n of meshRoot.listNodes()) meshNodesByName.set(n.getName(), n);

const clipFiles = readdirSync(clipsDir)
  .filter((f) => f.endsWith(".glb") && f !== basename(meshPath));

for (const file of clipFiles) {
  const stem = file.replace(/\.glb$/, "");
  const newName = renameMap[stem] ?? stem;
  const clipDoc = await io.read(join(clipsDir, file));
  for (const anim of clipDoc.getRoot().listAnimations()) {
    const merged = meshDoc.createAnimation(newName);
    let kept = 0;
    for (const ch of anim.listChannels()) {
      const srcNode = ch.getTargetNode();
      const dstNode = srcNode && meshNodesByName.get(srcNode.getName());
      const srcSampler = ch.getSampler();
      if (!dstNode || !srcSampler) continue;
      const newInput = meshDoc.createAccessor()
        .setArray(srcSampler.getInput().getArray().slice())
        .setType(srcSampler.getInput().getType())
        .setBuffer(meshRoot.listBuffers()[0]);
      const newOutput = meshDoc.createAccessor()
        .setArray(srcSampler.getOutput().getArray().slice())
        .setType(srcSampler.getOutput().getType())
        .setBuffer(meshRoot.listBuffers()[0]);
      const sampler = meshDoc.createAnimationSampler()
        .setInput(newInput).setOutput(newOutput).setInterpolation(srcSampler.getInterpolation());
      merged.addSampler(sampler);
      merged.addChannel(meshDoc.createAnimationChannel()
        .setTargetNode(dstNode).setTargetPath(ch.getTargetPath()).setSampler(sampler));
      kept++;
    }
    console.log(`  + ${newName} (${kept} channels)`);
  }
}

await io.write(outPath, meshDoc);
console.log(`wrote ${outPath}`);
